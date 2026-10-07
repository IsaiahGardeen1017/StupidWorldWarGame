import { TICKS_PER_DAY } from "./calendar";
import {
  equipmentTypes,
  type Battalion,
  type Command,
  type Equipment,
  type GameEvent,
  type Nation,
  type Order,
  type State,
  type Template,
  type Unit,
  type World,
} from "./types";
export const battalions: Record<
  Battalion,
  {
    attack: number;
    defense: number;
    org: number;
    equipment: Partial<Record<Equipment, number>>;
  }
> = {
  infantry: { attack: 8, defense: 12, org: 60, equipment: { gun: 100 } },
  armored: {
    attack: 22,
    defense: 16,
    org: 35,
    equipment: { tank: 40, gun: 30 },
  },
  artillery: {
    attack: 18,
    defense: 5,
    org: 25,
    equipment: { artillery: 30, gun: 20 },
  },
};
export const technologies = [
  {
    id: "industry",
    name: "Machine tools",
    cost: 35,
    requires: null,
    description: "+25% equipment output",
  },
  {
    id: "weapons",
    name: "Improved weapons",
    cost: 30,
    requires: null,
    description: "+20% division attack",
  },
  {
    id: "armor",
    name: "Mobile warfare",
    cost: 45,
    requires: "weapons",
    description: "+20% division defense",
  },
  {
    id: "aviation",
    name: "Long-range fighters",
    cost: 40,
    requires: null,
    description: "Fighter range 90 → 150",
  },
  {
    id: "naval",
    name: "Naval doctrine",
    cost: 40,
    requires: "weapons",
    description: "+25% fleet attack",
  },
];
const round = (n: number) => Math.round(n * 100) / 100;
export function requirements(t: Template) {
  const e: Partial<Record<Equipment, number>> = {};
  for (const b of t.battalions)
    for (const [k, v] of Object.entries(battalions[b].equipment))
      e[k as Equipment] = (e[k as Equipment] || 0) + v!;
  return e;
}
export function stats(bs: Battalion[]) {
  return {
    attack: bs.reduce((n, b) => n + battalions[b].attack, 0),
    defense: bs.reduce((n, b) => n + battalions[b].defense, 0),
    maxOrg: Math.round(
      bs.reduce((n, b) => n + battalions[b].org, 0) / Math.max(1, bs.length),
    ),
  };
}
export const atWar = (s: State, a: number, b: number) =>
  a !== b && s.wars.some((w) => w.includes(a) && w.includes(b));
export function event(
  s: State,
  type: string,
  message: string,
  extra: Partial<GameEvent> = {},
) {
  if (["command", "combat", "equipment-loss", "air-loss"].includes(type))
    return;
  s.events.push({ tick: s.tick, type, message, ...extra });
}
export function createGame(
  world: World,
  human: number | null = 0,
  seed = 12345,
): State {
  const s: State = {
    version: 2,
    world,
    seed: seed >>> 0,
    tick: 0,
    nextId: 1,
    nations: world.nations.map((n) => ({
      id: n.id,
      stock: {
        gun: 2200,
        tank: 300,
        fighter: 300,
        destroyer: 12,
        artillery: 300,
      },
      civs: 6,
      mils: 8,
      consumer: 2,
      production: { gun: 3, tank: 1, fighter: 2, destroyer: 1, artillery: 1 },
      construction: [],
      metrics: { kills: 0, unitsLost: 0, equipmentLost: 0, aircraftLost: 0 },
      templates: [
        {
          id: 1,
          name: "Infantry brigade",
          battalions: ["infantry", "infantry", "artillery"],
        },
        { id: 2, name: "Armored brigade", battalions: ["armored", "infantry"] },
      ],
      recruits: [],
      research: null,
      researchProgress: 0,
      techs: [],
      surrendered: false,
      ai: n.id !== human,
    })),
    units: [],
    wings: [],
    owners: Object.fromEntries(world.provinces.map((p) => [p.id, p.owner])),
    ports: {},
    wars: [],
    events: [],
    winner: null,
  };
  for (const n of s.nations) {
    const owned = world.provinces.filter(
      (p) => p.owner === n.id && p.kind === "land",
    );
    for (const p of owned.slice(0, 3))
      spawnDivision(s, n, n.templates[0], p.id);
    const homePort = owned.find((p) =>
      p.neighbors.some((id) => world.provinces[id].kind === "sea"),
    );
    if (homePort) s.ports[homePort.id] = true;
    const port = world.provinces.find(
      (p) =>
        p.kind === "sea" && p.neighbors.some((id) => s.owners[id] === n.id),
    );
    if (port) spawnFleet(s, n, port.id, 2);
  }
  event(s, "start", "Campaign initialized");
  return s;
}
function spend(n: Nation, e: Partial<Record<Equipment, number>>) {
  for (const [k, v] of Object.entries(e))
    if (n.stock[k as Equipment] < v!) return false;
  for (const [k, v] of Object.entries(e)) n.stock[k as Equipment] -= v!;
  return true;
}
function spawnDivision(s: State, n: Nation, t: Template, province: number) {
  const equipment = requirements(t);
  s.units.push({
    id: s.nextId++,
    owner: n.id,
    kind: "division",
    name: t.name,
    province,
    target: null,
    ...stats(t.battalions),
    org: stats(t.battalions).maxOrg,
    strength: 100,
    equipment,
    battalions: [...t.battalions],
  });
  event(s, "recruited", `${s.world.nations[n.id].name}: ${t.name} deployed`, {
    nation: n.id,
    province,
  });
}
function spawnFleet(s: State, n: Nation, province: number, ships: number) {
  s.units.push({
    id: s.nextId++,
    owner: n.id,
    kind: "fleet",
    name: `${ships} destroyers`,
    province,
    target: null,
    attack: ships * 14,
    defense: ships * 12,
    maxOrg: 60,
    org: 60,
    strength: 100,
    equipment: { destroyer: ships },
    battalions: [],
  });
}
export function distance(
  world: World,
  a: [number, number],
  b: [number, number],
) {
  const dx = Math.abs(a[0] - b[0]) % world.width;
  return Math.hypot(Math.min(dx, world.width - dx), a[1] - b[1]);
}
export function reachableZone(
  s: State,
  base: number,
  zone: number,
  range: number,
) {
  const p = s.world.provinces[base],
    z = s.world.airZones[zone];
  return !!p && !!z && distance(s.world, p.center, z.center) <= range;
}
export function applyCommand(
  s: State,
  nation: number,
  c: Command,
): string | null {
  const n = s.nations.find((n) => n.id === nation);
  if (!n || n.surrendered) return "Nation is unavailable";
  const p =
    "province" in c && c.province !== undefined
      ? s.world.provinces[c.province]
      : null;
  switch (c.type) {
    case "war":
      if (
        !s.nations[c.target] ||
        c.target === nation ||
        s.nations[c.target].surrendered ||
        atWar(s, nation, c.target)
      )
        return "Invalid war target";
      s.wars.push([nation, c.target].sort((a, b) => a - b) as [number, number]);
      event(
        s,
        "war",
        `${s.world.nations[nation].name} declared war on ${s.world.nations[c.target].name}`,
        { nation },
      );
      break;
    case "surrender":
      if (!s.wars.some((w) => w.includes(nation)))
        return "No war opponent to surrender to";
      surrender(s, nation);
      break;
    case "production":
      if (
        !equipmentTypes.includes(c.equipment) ||
        !Number.isInteger(c.factories) ||
        c.factories < 0 ||
        Object.entries(n.production)
          .filter(([k]) => k !== c.equipment)
          .reduce((a, [, v]) => a + v, 0) +
          c.factories >
          n.mils
      )
        return "Not enough unassigned military factories";
      n.production[c.equipment] = c.factories;
      break;
    case "build":
      if (
        !["civ", "mil", "port"].includes(c.kind) ||
        n.construction.length >= 20
      )
        return "Invalid or full construction queue";
      if (c.kind === "port") {
        const site =
          c.province === undefined ? null : s.world.provinces[c.province];
        if (
          !site ||
          site.kind !== "land" ||
          s.owners[site.id] !== nation ||
          !site.neighbors.some((id) => s.world.provinces[id].kind === "sea")
        )
          return "Build a port in an owned coastal land province";
        if (
          s.ports[site.id] ||
          n.construction.some(
            (q) => q.kind === "port" && q.province === site.id,
          )
        )
          return "Port already exists or is queued";
      }
      n.construction.push({
        kind: c.kind,
        province: c.kind === "port" ? c.province : undefined,
        progress: 0,
      });
      break;
    case "template":
      if (
        !c.name.trim() ||
        c.name.length > 60 ||
        !c.battalions.length ||
        c.battalions.length > 12 ||
        c.battalions.some((b) => !battalions[b])
      )
        return "Template needs 1–12 valid battalions";
      {
        const old = n.templates.find((t) => t.id === c.id);
        const t = {
          id: old?.id ?? Math.max(0, ...n.templates.map((t) => t.id)) + 1,
          name: c.name,
          battalions: [...c.battalions],
        };
        if (old) Object.assign(old, t);
        else n.templates.push(t);
      }
      break;
    case "recruit": {
      const t = n.templates.find((t) => t.id === c.template);
      if (!t || !p || p.kind !== "land" || s.owners[p.id] !== nation)
        return "Choose an owned land province and template";
      if (!spend(n, requirements(t))) return "Insufficient equipment";
      n.recruits.push({
        template: structuredClone(t),
        province: p.id,
        ready: s.tick + 12 * TICKS_PER_DAY,
      });
      event(s, "training", "Division training started", {
        nation,
        province: p.id,
      });
      break;
    }
    case "fleet":
      if (
        !p ||
        p.kind !== "sea" ||
        !p.neighbors.some((id) => s.owners[id] === nation) ||
        !Number.isInteger(c.ships) ||
        c.ships < 1 ||
        c.ships > 20
      )
        return "Choose coastal sea; 1–20 destroyers";
      if (!spend(n, { destroyer: c.ships })) return "Not enough destroyers";
      spawnFleet(s, n, p.id, c.ships);
      event(s, "fleet", "Fleet commissioned", { nation, province: p.id });
      break;
    case "move":
      if (!p || !Array.isArray(c.units) || c.units.length > 1000)
        return "Invalid movement";
      {
        const us = c.units.map((id) => s.units.find((u) => u.id === id));
        if (
          !us.length ||
          us.some(
            (u) =>
              !u ||
              u.owner !== nation ||
              !(u.kind === "division"
                ? ["land", "sea"].includes(p.kind)
                : p.kind === "sea"),
          )
        )
          return "Select owned units and a compatible destination";
        const routes = us.map((u) => planRoute(s, u!, p.id));
        if (routes.some((r) => r === null))
          return "Destination is unreachable; overseas transport must depart from an owned port";
        us.forEach((u, i) => {
          u!.target = p.id;
          u!.route = routes[i]!;
          u!.transition = undefined;
          u!.moveReady =
            s.tick + (s.world.provinces[u!.province].kind === "sea" ? 1 : 3);
        });
      }
      break;
    case "research": {
      const t = technologies.find((t) => t.id === c.tech);
      if (
        !t ||
        n.techs.includes(t.id) ||
        (t.requires && !n.techs.includes(t.requires))
      )
        return "Research prerequisite not met";
      n.research = t.id;
      n.researchProgress = 0;
      break;
    }
    case "wing":
      if (!p || p.kind !== "land" || s.owners[p.id] !== nation)
        return "Choose an owned land airbase";
      if (
        s.wings
          .filter((w) => w.base === p.id)
          .reduce((a, w) => a + w.planes, 0) +
          100 >
        500
      )
        return "Airbase capacity is 500 aircraft";
      if (!spend(n, { fighter: 100 })) return "Need 100 fighters";
      s.wings.push({
        id: s.nextId++,
        owner: nation,
        base: p.id,
        zone: null,
        mission: "superiority",
        planes: 100,
        range: n.techs.includes("aviation") ? 150 : 90,
      });
      event(s, "wing", "100 fighters deployed", { nation, province: p.id });
      break;
    case "mission": {
      const w = s.wings.find((w) => w.id === c.wing && w.owner === nation);
      if (
        !w ||
        !["superiority", "support"].includes(c.mission) ||
        !reachableZone(s, w.base, c.zone, w.range)
      )
        return "Air zone outside range";
      w.zone = c.zone;
      w.mission = c.mission;
      break;
    }
    default:
      return "Unknown command";
  }
  event(s, "command", `${s.world.nations[nation].name}: ${c.type}`, { nation });
  return null;
}
function surrender(s: State, id: number) {
  const n = s.nations[id];
  const opponents = s.wars
    .filter((w) => w.includes(id))
    .map((w) => w.find((x) => x !== id)!)
    .filter((x) => !s.nations[x].surrendered)
    .sort((a, b) => a - b);
  if (!opponents.length) return;
  n.surrendered = true;
  for (const p of s.world.provinces)
    if (s.owners[p.id] === id) {
      s.owners[p.id] = opponents[0];
      event(s, "ownership", "Province transferred by surrender", {
        nation: opponents[0],
        province: p.id,
      });
    }
  s.units = s.units.filter((u) => u.owner !== id);
  s.wings = s.wings.filter((w) => w.owner !== id);
  s.wars = s.wars.filter((w) => !w.includes(id));
  event(s, "surrender", `${s.world.nations[id].name} surrendered`, {
    nation: id,
  });
  const alive = s.nations.filter((n) => !n.surrendered);
  if (alive.length === 1) s.winner = alive[0].id;
}
function random(s: State) {
  let x = s.seed;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.seed = x >>> 0;
  return s.seed / 4294967296;
}
export const LAND_MOVE_TICKS = 3,
  SEA_MOVE_TICKS = 1,
  EMBARK_TICKS = 6,
  DISEMBARK_TICKS = 6,
  LANDING_ATTACK_MULTIPLIER = 0.25;
export function planRoute(s: State, u: Unit, target: number): number[] | null {
  if (u.province === target) return [];
  const queue = [u.province],
    prev = new Map<number, number>([[u.province, -1]]);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i],
      from = s.world.provinces[id];
    const neighbors = [...from.neighbors].sort(
      (a, b) =>
        (s.world.provinces[a].kind === "land" ? 0 : 1) -
          (s.world.provinces[b].kind === "land" ? 0 : 1) || a - b,
    );
    for (const j of neighbors) {
      const p = s.world.provinces[j],
        owner = s.owners[j];
      if (prev.has(j) || p.kind.startsWith("impassable")) continue;
      if (u.kind === "fleet" && p.kind !== "sea") continue;
      if (u.kind === "division") {
        if (
          p.kind === "land" &&
          owner !== null &&
          owner !== u.owner &&
          !atWar(s, u.owner, owner)
        )
          continue;
        if (from.kind === "land" && p.kind === "sea" && !s.ports[id]) continue;
      }
      prev.set(j, id);
      if (j === target) {
        const route: number[] = [];
        let k = j;
        while (k !== u.province) {
          route.unshift(k);
          k = prev.get(k)!;
        }
        return route;
      }
      queue.push(j);
    }
  }
  return null;
}
function nextStep(s: State, u: Unit): number | null {
  if (u.target === null || u.target === u.province) {
    u.target = null;
    return null;
  }
  if (!u.route?.length) u.route = planRoute(s, u, u.target) ?? [];
  const dest = u.route[0];
  if (dest === undefined) return null;
  const owner = s.owners[dest];
  if (
    s.world.provinces[dest].kind === "land" &&
    owner !== null &&
    owner !== u.owner &&
    !atWar(s, u.owner, owner)
  ) {
    u.route = [];
    u.transition = undefined;
    return null;
  }
  return dest;
}
function airBonus(s: State, owner: number, p: number) {
  return Math.min(
    0.4,
    s.wings
      .filter(
        (w) =>
          w.owner === owner &&
          w.zone === s.world.provinces[p].airZone &&
          w.mission === "support",
      )
      .reduce((a, w) => a + w.planes, 0) / 1000,
  );
}
function casualties(s: State, u: Unit, damage: number) {
  const before = u.strength;
  u.strength = Math.max(0, round(u.strength - damage));
  for (const [k, v] of Object.entries(u.equipment)) {
    const loss = Math.min(v!, Math.ceil((v! * damage) / Math.max(before, 1)));
    u.equipment[k as Equipment] = Math.max(0, v! - loss);
    if (loss) s.nations[u.owner].metrics.equipmentLost += loss;
    if (loss)
      event(s, "equipment-loss", `${u.name} lost ${loss} ${k}`, {
        nation: u.owner,
        unit: u.id,
        province: u.province,
        amount: loss,
      });
  }
}
function retreat(s: State, u: Unit, from: number, killer: number) {
  const dest = s.world.provinces[u.province].neighbors
    .filter(
      (id) =>
        id !== from &&
        s.world.provinces[id].kind ===
          (u.kind === "division"
            ? s.world.provinces[u.province].kind === "sea"
              ? "sea"
              : "land"
            : "sea") &&
        (u.kind === "fleet" ||
          s.world.provinces[id].kind === "sea" ||
          s.owners[id] === u.owner) &&
        ((u.kind === "division" && s.world.provinces[id].kind === "sea") ||
          !s.units.some(
            (x) =>
              x.kind === u.kind &&
              x.province === id &&
              atWar(s, u.owner, x.owner),
          )),
    )
    .sort((a, b) => a - b)[0];
  if (dest === undefined) {
    s.units = s.units.filter((x) => x.id !== u.id);
    s.nations[u.owner].metrics.unitsLost++;
    s.nations[killer].metrics.kills++;
    event(s, "destroyed", `${u.name} destroyed while encircled`, {
      nation: u.owner,
      unit: u.id,
      province: u.province,
      amount: 1,
    });
  } else {
    u.province = dest;
    u.target = null;
    u.route = [];
    u.transition = undefined;
    u.org = Math.max(8, u.maxOrg * 0.2);
    event(s, "retreat", `${u.name} retreated`, {
      nation: u.owner,
      unit: u.id,
      province: dest,
    });
  }
}
export function step(s: State, orders: Order[] = []) {
  if (s.winner !== null) return;
  s.tick++;
  for (const o of orders) {
    const err = applyCommand(s, o.nation, o.command);
    if (err) event(s, "rejected", err, { nation: o.nation });
  }
  for (const n of s.nations) {
    if (n.surrendered) continue;
    for (const r of [...n.recruits])
      if (r.ready <= s.tick) {
        const dest =
          s.owners[r.province] === n.id
            ? r.province
            : s.world.provinces.find(
                (p) => s.owners[p.id] === n.id && p.kind === "land",
              )?.id;
        if (dest !== undefined) spawnDivision(s, n, r.template, dest);
        n.recruits.splice(n.recruits.indexOf(r), 1);
      }
    if (s.tick % TICKS_PER_DAY !== 0) continue;
    for (const e of equipmentTypes) {
      const rate = {
        gun: 10,
        tank: 2,
        fighter: 3,
        destroyer: 0.1,
        artillery: 3,
      }[e];
      n.stock[e] = round(
        n.stock[e] +
          n.production[e] * rate * (n.techs.includes("industry") ? 1.25 : 1),
      );
    }
    const q = n.construction[0];
    if (q && (q.kind !== "port" || s.owners[q.province!] === n.id)) {
      q.progress += Math.max(0, n.civs - n.consumer) * 2;
      if (q.progress >= (q.kind === "port" ? 180 : 120)) {
        if (q.kind === "port") s.ports[q.province!] = true;
        else q.kind === "civ" ? n.civs++ : n.mils++;
        n.consumer = Math.ceil(n.civs * 0.25);
        n.construction.shift();
        event(
          s,
          "factory",
          `${q.kind === "port" ? "Port" : q.kind === "civ" ? "Civilian factory" : "Military factory"} completed`,
          { nation: n.id, province: q.province },
        );
      }
    }
    if (n.research) {
      n.researchProgress++;
      const t = technologies.find((t) => t.id === n.research)!;
      if (n.researchProgress >= t.cost) {
        n.techs.push(t.id);
        n.research = null;
        n.researchProgress = 0;
        for (const w of s.wings)
          if (w.owner === n.id && t.id === "aviation") w.range = 150;
        event(s, "research", `${t.name} researched`, { nation: n.id });
      }
    }
  }
  for (const id of s.units.map((u) => u.id).sort((a, b) => a - b)) {
    const u = s.units.find((u) => u.id === id);
    if (!u) continue;
    if (s.tick < (u.moveReady ?? 0)) continue;
    const dest = nextStep(s, u);
    if (dest === null) {
      u.org = Math.min(u.maxOrg, round(u.org + 3));
      u.moveReady = s.tick + 3;
      continue;
    }
    const from = s.world.provinces[u.province],
      to = s.world.provinces[dest];
    const landing =
      u.kind === "division" && from.kind === "sea" && to.kind === "land";
    if (u.kind === "division" && from.kind !== to.kind) {
      if (
        from.kind === "land" &&
        (!s.ports[from.id] || s.owners[from.id] !== u.owner)
      ) {
        u.target = null;
        u.route = [];
        event(s, "rejected", "Transport departure requires an owned port", {
          nation: u.owner,
          unit: u.id,
        });
        continue;
      }
      if (!u.transition || u.transition.to !== dest) {
        u.transition = {
          from: from.id,
          to: dest,
          kind: landing ? "disembark" : "embark",
          ready: s.tick + (landing ? DISEMBARK_TICKS : EMBARK_TICKS),
        };
        event(
          s,
          u.transition.kind,
          `${u.name} ${landing ? "preparing to land" : "embarking"}`,
          { nation: u.owner, unit: u.id, province: from.id },
        );
      }
      if (s.tick < u.transition.ready) continue;
    }
    u.moveReady =
      s.tick + (to.kind === "sea" ? SEA_MOVE_TICKS : LAND_MOVE_TICKS);
    const defenders = s.units
      .filter(
        (d) =>
          d.kind === u.kind &&
          d.province === dest &&
          atWar(s, u.owner, d.owner) &&
          !(u.kind === "division" && to.kind === "sea"),
      )
      .sort((a, b) => a.id - b.id);
    if (defenders.length) {
      const d = defenders[0],
        nu = s.nations[u.owner],
        nd = s.nations[d.owner];
      const attack =
        ((u.attack * u.strength) / 100) *
        (nu.techs.includes(u.kind === "fleet" ? "naval" : "weapons")
          ? u.kind === "fleet"
            ? 1.25
            : 1.2
          : 1) *
        (1 + airBonus(s, u.owner, dest)) *
        (landing ? LANDING_ATTACK_MULTIPLIER : 1);
      const defense =
        ((d.defense * d.strength) / 100) *
        (d.kind === "division" && nd.techs.includes("armor") ? 1.2 : 1);
      d.org = round(
        Math.max(
          0,
          d.org - Math.max(landing ? 1 : 4, attack * 0.35 - defense * 0.05),
        ),
      );
      u.org = round(
        Math.max(
          0,
          u.org -
            Math.max(3, d.attack * 0.2 - u.defense * 0.04) * (landing ? 2 : 1),
        ),
      );
      casualties(s, d, Math.max(0.5, attack / 35));
      casualties(s, u, Math.max(0.5, d.attack / 50) * (landing ? 2 : 1));
      event(s, "combat", `${u.name} engaged ${d.name}`, {
        unit: u.id,
        nation: u.owner,
        province: dest,
      });
      if (d.org === 0 || d.strength === 0) retreat(s, d, u.province, u.owner);
      if (u.org === 0 || u.strength === 0) retreat(s, u, dest, d.owner);
    } else {
      u.province = dest;
      u.route?.shift();
      u.transition = undefined;
      if (u.target === dest) u.target = null;
      if (
        u.kind === "division" &&
        to.kind === "land" &&
        s.owners[dest] !== u.owner
      ) {
        s.owners[dest] = u.owner;
        event(
          s,
          "capture",
          `${s.world.nations[u.owner].name} captured province ${dest}`,
          { nation: u.owner, province: dest },
        );
      }
    }
  }
  for (const w of [...s.wings]) {
    if (s.owners[w.base] !== w.owner) {
      s.wings = s.wings.filter((x) => x.id !== w.id);
      s.nations[w.owner].metrics.aircraftLost += w.planes;
      event(s, "airbase-lost", "Air wing lost with its airbase", {
        nation: w.owner,
        amount: w.planes,
      });
      continue;
    }
    if (w.zone !== null && s.tick % (5 * TICKS_PER_DAY) === 0) {
      const foes = s.wings.filter(
        (x) => x.zone === w.zone && atWar(s, w.owner, x.owner),
      );
      if (foes.length) {
        const loss = Math.min(
          w.planes,
          Math.max(1, Math.floor(foes.reduce((a, x) => a + x.planes, 0) / 100)),
        );
        w.planes -= loss;
        s.nations[w.owner].metrics.aircraftLost += loss;
        event(s, "air-loss", `${loss} fighters lost`, {
          nation: w.owner,
          amount: loss,
        });
        if (!w.planes) s.wings = s.wings.filter((x) => x.id !== w.id);
      }
    }
  }
  // Reinforcement consumes stock; aggregate losses are sampled in national statistics.
  for (const u of s.units) {
    if (
      s.tick % TICKS_PER_DAY !== 0 ||
      (u.kind === "division" && s.world.provinces[u.province].kind === "sea") ||
      u.target !== null ||
      u.strength >= 100
    )
      continue;
    const n = s.nations[u.owner],
      full =
        u.kind === "division"
          ? requirements({ id: 0, name: "", battalions: u.battalions })
          : { destroyer: Math.round(u.attack / 14) };
    const add: Partial<Record<Equipment, number>> = {};
    for (const [k, v] of Object.entries(full))
      add[k as Equipment] = Math.min(
        Math.max(0, v! - (u.equipment[k as Equipment] || 0)),
        Math.ceil(v! * 0.02),
      );
    if (spend(n, add)) {
      for (const [k, v] of Object.entries(add))
        u.equipment[k as Equipment] = (u.equipment[k as Equipment] || 0) + v!;
      u.strength = Math.min(100, round(u.strength + 2));
    }
  }
  for (const n of s.nations)
    if (
      !n.surrendered &&
      !s.world.provinces.some(
        (p) => p.kind === "land" && s.owners[p.id] === n.id,
      )
    )
      surrender(s, n.id);
}
// Country-independent policy: inspect capabilities and use the same public command API as players.
export function aiOrders(s: State): Order[] {
  const orders: Order[] = [];
  const push = (n: Nation, command: Command) =>
    orders.push({ nation: n.id, command });
  for (const n of s.nations) {
    if (!n.ai || n.surrendered) continue;
    const own = s.world.provinces.filter(
      (p) => s.owners[p.id] === n.id && p.kind === "land",
    );
    if (!own.length) continue;
    const base = own[Math.floor(random(s) * own.length)];
    if (s.tick % (10 * TICKS_PER_DAY) === 0) {
      if (!n.research) {
        const t = technologies.find(
          (t) =>
            !n.techs.includes(t.id) &&
            (!t.requires || n.techs.includes(t.requires)),
        );
        if (t) push(n, { type: "research", tech: t.id });
      }
      const homePort = own.find((p) => s.ports[p.id]);
      const coastSite = own.find((p) =>
        p.neighbors.some((id) => s.world.provinces[id].kind === "sea"),
      );
      if (
        !homePort &&
        coastSite &&
        !n.construction.some((q) => q.kind === "port")
      )
        push(n, { type: "build", kind: "port", province: coastSite.id });
      if (n.construction.length < 2)
        push(n, { type: "build", kind: n.civs < 8 ? "civ" : "mil" });
      if (
        n.recruits.length < 3 &&
        s.units.filter((u) => u.owner === n.id && u.kind === "division")
          .length < Math.min(60, 12 + own.length * 2)
      )
        push(n, { type: "recruit", template: 1, province: base.id });
      const allocated = Object.values(n.production).reduce((a, b) => a + b, 0);
      if (allocated < n.mils)
        push(n, {
          type: "production",
          equipment: "gun",
          factories: n.production.gun + n.mils - allocated,
        });
      if (
        n.stock.fighter >= 100 &&
        s.wings.filter((w) => w.owner === n.id).length < 3
      )
        push(n, { type: "wing", province: base.id });
      const coast = s.world.provinces.find(
        (p) =>
          p.kind === "sea" && p.neighbors.some((i) => s.owners[i] === n.id),
      );
      if (
        coast &&
        n.stock.destroyer >= 2 &&
        s.units.filter((u) => u.owner === n.id && u.kind === "fleet").length < 2
      )
        push(n, { type: "fleet", province: coast.id, ships: 2 });
      if (!n.templates.some((t) => t.name === "Combined arms"))
        push(n, {
          type: "template",
          name: "Combined arms",
          battalions: ["infantry", "armored", "artillery"],
        });
    }
    if (
      s.tick >= 20 * TICKS_PER_DAY &&
      s.tick % (20 * TICKS_PER_DAY) === 0 &&
      !s.wars.some((w) => w.includes(n.id))
    ) {
      const enemy =
        s.nations.find(
          (x) =>
            x.id !== n.id &&
            !x.surrendered &&
            own.some((p) => p.neighbors.some((i) => s.owners[i] === x.id)),
        ) ||
        (s.tick >= 40 * TICKS_PER_DAY
          ? s.nations
              .filter((x) => x.id !== n.id && !x.surrendered)
              .sort(
                (a, b) =>
                  distance(
                    s.world,
                    base.center,
                    s.world.provinces[s.world.nations[a.id].capital].center,
                  ) -
                    distance(
                      s.world,
                      base.center,
                      s.world.provinces[s.world.nations[b.id].capital].center,
                    ) || a.id - b.id,
              )[0]
          : undefined);
      if (enemy) push(n, { type: "war", target: enemy.id });
    }
    if (s.tick % 6 === 0) {
      for (const u of s.units.filter((u) => u.owner === n.id)) {
        const targets = s.world.provinces.filter(
          (p) =>
            p.kind ===
              (u.kind === "division"
                ? s.world.provinces[u.province].kind === "sea"
                  ? "sea"
                  : "land"
                : "sea") &&
            (u.kind === "fleet"
              ? s.units.some(
                  (x) => x.province === p.id && atWar(s, n.id, x.owner),
                )
              : s.owners[p.id] !== null && atWar(s, n.id, s.owners[p.id]!)),
        );
        targets.sort(
          (a, b) =>
            distance(s.world, a.center, s.world.provinces[u.province].center) -
              distance(
                s.world,
                b.center,
                s.world.provinces[u.province].center,
              ) || a.id - b.id,
        );
        // Preserve a committed journey instead of resetting embark timers every AI turn.
        if (u.target !== null && u.route?.length) continue;
        const target = targets.find((p) => planRoute(s, u, p.id) !== null);
        if (target)
          push(n, { type: "move", units: [u.id], province: target.id });
      }
      for (const w of s.wings.filter((w) => w.owner === n.id)) {
        const z = s.world.airZones
          .filter((z) => reachableZone(s, w.base, z.id, w.range))
          .sort(
            (a, b) =>
              s.world.provinces.filter(
                (p) =>
                  p.airZone === b.id &&
                  s.owners[p.id] !== null &&
                  atWar(s, n.id, s.owners[p.id]!),
              ).length -
                s.world.provinces.filter(
                  (p) =>
                    p.airZone === a.id &&
                    s.owners[p.id] !== null &&
                    atWar(s, n.id, s.owners[p.id]!),
                ).length || a.id - b.id,
          )[0];
        if (z)
          push(n, {
            type: "mission",
            wing: w.id,
            zone: z.id,
            mission: "support",
          });
      }
    }
  }
  return orders;
}
export function checksum(s: State) {
  let h = 2166136261;
  for (const c of JSON.stringify(s)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
