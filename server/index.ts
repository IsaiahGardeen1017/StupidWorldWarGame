import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { createGame, step, aiOrders, applyCommand } from "../src/engine/engine";
import type { Command, Order, State, World } from "../src/engine/types";
import { GameSave, initStorage } from "../src/persistence/save";
await initStorage(path.resolve("node_modules/sql.js/dist/sql-wasm.wasm"));
const world: World = JSON.parse(fs.readFileSync("public/world.json", "utf8"));
const production = process.env.NODE_ENV === "production";
const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({ server: { middlewareMode: true }, appType: "spa" });
const server = http.createServer((req, res) => {
  if (vite) {
    vite.middlewares(req, res);
    return;
  }
  const pathname = new URL(req.url || "/", "http://local").pathname;
  let file = path.resolve("dist", "." + pathname);
  if (
    !file.startsWith(path.resolve("dist") + path.sep) &&
    file !== path.resolve("dist")
  ) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.resolve("dist/index.html");
  res.setHeader(
    "Content-Type",
    (
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".wasm": "application/wasm",
      } as Record<string, string>
    )[path.extname(file)] || "application/octet-stream",
  );
  fs.createReadStream(file).pipe(res);
});
interface Client {
  socket: WebSocket;
  id: string;
  lobby: string | null;
  nation: number | null;
}
interface Lobby {
  id: string;
  name: string;
  host: string;
  members: Client[];
  state: State | null;
  queue: Order[];
  save: GameSave | null;
}
const clients = new Set<Client>(),
  lobbies = new Map<string, Lobby>();
let serial = 1;
const send = (c: Client, m: unknown) => {
  if (c.socket.readyState === WebSocket.OPEN) c.socket.send(JSON.stringify(m));
};
const info = (l: Lobby) => ({
  id: l.id,
  name: l.name,
  host: l.host,
  started: !!l.state,
  members: l.members.map((c) => ({ id: c.id, nation: c.nation })),
  tick: l.state?.tick || 0,
});
const listing = () => [...lobbies.values()].map(info);
function broadcast() {
  for (const c of clients) send(c, { type: "lobbies", lobbies: listing() });
  for (const l of lobbies.values())
    for (const c of l.members) send(c, { type: "lobby", lobby: info(l) });
}
function leave(c: Client) {
  const l = c.lobby ? lobbies.get(c.lobby) : null;
  if (l) {
    l.members = l.members.filter((x) => x !== c);
    if (l.state && c.nation !== null) l.state.nations[c.nation].ai = true;
    if (!l.members.length) {
      l.save?.close();
      lobbies.delete(l.id);
    } else if (l.host === c.id) l.host = l.members[0].id;
  }
  c.lobby = null;
  c.nation = null;
  broadcast();
}
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16384 });
wss.on("connection", (socket) => {
  const c: Client = {
    socket,
    id: `player-${serial++}`,
    lobby: null,
    nation: null,
  };
  clients.add(c);
  send(c, { type: "hello", id: c.id, lobbies: listing() });
  socket.on("message", (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.type === "create") {
        leave(c);
        const l: Lobby = {
          id: `lobby-${serial++}`,
          name: String(m.name || "New campaign").slice(0, 40),
          host: c.id,
          members: [c],
          state: null,
          queue: [],
          save: null,
        };
        lobbies.set(l.id, l);
        c.lobby = l.id;
        broadcast();
      } else if (m.type === "join") {
        const l = lobbies.get(m.id);
        if (!l || l.state || l.members.length >= world.nations.length)
          throw Error("Lobby unavailable");
        leave(c);
        l.members.push(c);
        c.lobby = l.id;
        broadcast();
      } else if (m.type === "leave") leave(c);
      else {
        const l = c.lobby ? lobbies.get(c.lobby) : null;
        if (!l) throw Error("Join a lobby first");
        if (m.type === "nation") {
          if (
            l.state ||
            !world.nations.some((n) => n.id === m.nation) ||
            l.members.some((x) => x !== c && x.nation === m.nation)
          )
            throw Error("Nation unavailable");
          c.nation = m.nation;
          broadcast();
        } else if (m.type === "start") {
          if (
            l.host !== c.id ||
            l.state ||
            l.members.some((x) => x.nation === null)
          )
            throw Error("Only host can start after everyone selects a nation");
          l.state = createGame(world, null);
          for (const member of l.members)
            l.state.nations[member.nation!].ai = false;
          l.save = new GameSave();
          l.save.record(l.state);
          broadcast();
          for (const member of l.members)
            send(member, { type: "state", state: l.state });
        } else if (m.type === "command") {
          if (!l.state || c.nation === null || l.queue.length > 200)
            throw Error("Game not accepting commands");
          if (!validCommand(m.command)) throw Error("Malformed command");
          const test = structuredClone(l.state);
          const err = applyCommand(test, c.nation, m.command);
          if (err) throw Error(err);
          l.queue.push({ nation: c.nation, command: m.command });
        } else if (m.type === "save") {
          if (!l.save) throw Error("No active game");
          send(c, {
            type: "save",
            bytes: Buffer.from(l.save.bytes()).toString("base64"),
          });
        }
      }
    } catch (e) {
      send(c, {
        type: "error",
        message: e instanceof Error ? e.message : "Invalid request",
      });
    }
  });
  socket.on("close", () => {
    leave(c);
    clients.delete(c);
  });
});
export function validCommand(c: unknown): c is Command {
  if (!c || typeof c !== "object") return false;
  const x = c as Record<string, unknown>,
    int = (k: string) => Number.isInteger(x[k]) && Number(x[k]) >= 0;
  switch (x.type) {
    case "surrender":
      return true;
    case "war":
      return int("target");
    case "build":
      return (
        (x.kind === "civ" || x.kind === "mil" || x.kind === "port") &&
        (x.province === undefined || int("province"))
      );
    case "production":
      return (
        ["gun", "tank", "fighter", "destroyer", "artillery"].includes(
          String(x.equipment),
        ) && int("factories")
      );
    case "template":
      return (
        typeof x.name === "string" &&
        Array.isArray(x.battalions) &&
        x.battalions.every((b) =>
          ["infantry", "armored", "artillery"].includes(b),
        ) &&
        (x.id === undefined || int("id"))
      );
    case "recruit":
      return int("template") && int("province");
    case "fleet":
      return int("ships") && int("province");
    case "move":
      return (
        int("province") &&
        Array.isArray(x.units) &&
        x.units.length <= 1000 &&
        x.units.every(Number.isInteger)
      );
    case "research":
      return typeof x.tech === "string";
    case "wing":
      return int("province");
    case "mission":
      return (
        int("wing") &&
        int("zone") &&
        ["superiority", "support"].includes(String(x.mission))
      );
    default:
      return false;
  }
}
setInterval(() => {
  for (const l of lobbies.values()) {
    if (!l.state || l.state.winner !== null) continue;
    const orders = [...l.queue, ...aiOrders(l.state)];
    l.queue = [];
    step(l.state, orders);
    l.save!.record(l.state, orders);
    for (const c of l.members)
      send(c, { type: "state", state: l.state, orders });
  }
}, 500);
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(
    `World at War: port ${process.env.PORT || 3000} (${production ? "production" : "development"})`,
  ),
);
