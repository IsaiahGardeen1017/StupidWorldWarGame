// Run against npm run dev/start: node tests/multiplayer.mjs
import { WebSocket } from "ws";
import assert from "node:assert/strict";
const url = process.env.TEST_SERVER || "ws://127.0.0.1:3000/ws";
function client() {
  const ws = new WebSocket(url),
    messages = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  return {
    ws,
    messages,
    send(m) {
      ws.send(JSON.stringify(m));
    },
    async wait(predicate) {
      const start = Date.now();
      while (Date.now() - start < 8000) {
        const m = messages.find(predicate);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw Error("Timed out waiting for message");
    },
  };
}
const a = client(),
  b = client();
try {
  const ha = await a.wait((m) => m.type === "hello"),
    hb = await b.wait((m) => m.type === "hello");
  a.send({ type: "create", name: "Integration test" });
  const room = await a.wait((m) => m.type === "lobby");
  b.send({ type: "join", id: room.lobby.id });
  await b.wait((m) => m.type === "lobby");
  a.send({ type: "nation", nation: 1 });
  b.send({ type: "nation", nation: 2 });
  await a.wait(
    (m) =>
      m.type === "lobby" &&
      m.lobby.members.some((x) => x.id === hb.id && x.nation === 2),
  );
  b.send({ type: "start" });
  assert.match((await b.wait((m) => m.type === "error")).message, /host/);
  a.send({ type: "start" });
  const initial = await a.wait((m) => m.type === "state");
  assert.equal(initial.state.nations[1].ai, false);
  assert.equal(initial.state.nations[2].ai, false);
  assert.equal(initial.state.nations[0].ai, true);
  a.send({ type: "command", command: { type: "build", kind: "civ" } });
  a.send({ type: "command", command: { type: "war", target: 2 } });
  b.send({
    type: "command",
    command: {
      type: "move",
      units: [initial.state.units.find((u) => u.owner === 1).id],
      province: initial.state.world.nations[2].capital,
    },
  });
  await b.wait((m) => m.type === "error" && /owned units/.test(m.message));
  const sa = await a.wait((m) => m.type === "state" && m.state.tick >= 3),
    sb = await b.wait(
      (m) => m.type === "state" && m.state.tick === sa.state.tick,
    );
  assert.deepEqual(sa.state, sb.state);
  assert.ok(sa.state.nations[1].construction.length > 0);
  assert.ok(sa.state.wars.some((w) => w.includes(1) && w.includes(2)));
  a.send({ type: "pause" });
  const later = await a.wait(
    (m) => m.type === "state" && m.state.tick > sa.state.tick,
  );
  assert.ok(later.state.tick > sa.state.tick);
  a.send({ type: "save" });
  const saved = await a.wait((m) => m.type === "save");
  assert.equal(
    Buffer.from(saved.bytes, "base64").subarray(0, 15).toString(),
    "SQLite format 3",
  );
  console.log(
    "PASS: two-client lobby, host authority, ownership, shared ticks, no pause, SQLite download",
  );
} finally {
  a.ws.close();
  b.ws.close();
}
