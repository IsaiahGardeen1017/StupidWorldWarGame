import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createGame,
  step,
  aiOrders,
  applyCommand,
  checksum,
  requirements,
  reachableZone,
  distance,
  atWar,
} from "../src/engine/engine";
import type { World, State } from "../src/engine/types";
import { GameSave, initStorage } from "../src/persistence/save";
import { compileMap, palette } from "../src/map/compiler";
const world: World = JSON.parse(fs.readFileSync("public/world.json", "utf8"));
const quiet = () => {
  const s = createGame(world, 0);
  s.nations.forEach((n) => (n.ai = false));
  return s;
};
const own = (s: State, n = 0) =>
  world.provinces.find((p) => s.owners[p.id] === n && p.kind === "land")!.id;
test("all-AI campaigns are deterministic and produce substantive events", () => {
  const a = createGame(world, null, 42),
    b = createGame(world, null, 42);
  for (let i = 0; i < 360; i++) {
    step(a, aiOrders(a));
    step(b, aiOrders(b));
  }
  assert.equal(checksum(a), checksum(b));
  for (const type of [
    "factory",
    "recruited",
    "research",
    "war",
    "capture",
    "wing",
    "fleet",
  ])
    assert.ok(
      a.events.some((e) => e.type === type),
      `missing ${type}`,
    );
});
test("a nation is never at war with itself", () => {
  const s = quiet();
  s.wars = [[0, 1]];
  assert.equal(atWar(s, 0, 0), false);
  assert.equal(atWar(s, 0, 1), true);
});
test("industry consumes civ capacity and equipment allocations cannot exceed mils", () => {
  const s = quiet();
  assert.equal(applyCommand(s, 0, { type: "build", kind: "civ" }), null);
  for (let i = 0; i < 45; i++) step(s);
  assert.equal(s.nations[0].civs, 7);
  assert.ok(s.nations[0].stock.gun > 2200);
  assert.match(
    applyCommand(s, 0, {
      type: "production",
      equipment: "gun",
      factories: 50,
    })!,
    /factories/,
  );
});
test("designer and recruitment reserve exact equipment and deploy after training", () => {
  const s = quiet(),
    base = own(s);
  applyCommand(s, 0, {
    type: "template",
    name: "Test combined",
    battalions: ["infantry", "armored", "artillery"],
  });
  const t = s.nations[0].templates.at(-1)!;
  assert.deepEqual(requirements(t), { gun: 150, tank: 40, artillery: 30 });
  const before = s.nations[0].stock.gun,
    count = s.units.length;
  assert.equal(
    applyCommand(s, 0, { type: "recruit", template: t.id, province: base }),
    null,
  );
  assert.equal(s.nations[0].stock.gun, before - 150);
  for (let i = 0; i < 35; i++) step(s);
  assert.equal(s.units.length, count);
  step(s);
  assert.equal(s.units.length, count + 1);
  assert.ok(s.units.some((u) => u.name === "Test combined" && u.attack === 48));
  s.nations[0].stock.gun = 0;
  assert.match(
    applyCommand(s, 0, { type: "recruit", template: t.id, province: base })!,
    /equipment/,
  );
});
test("airbase capacity, range, missions and research prerequisites", () => {
  const s = quiet(),
    base = own(s);
  s.nations[0].stock.fighter = 1000;
  for (let i = 0; i < 5; i++)
    assert.equal(applyCommand(s, 0, { type: "wing", province: base }), null);
  assert.match(applyCommand(s, 0, { type: "wing", province: base })!, /500/);
  const w = s.wings[0],
    z = world.airZones.find((z) => reachableZone(s, base, z.id, w.range))!;
  assert.equal(
    applyCommand(s, 0, {
      type: "mission",
      wing: w.id,
      zone: z.id,
      mission: "support",
    }),
    null,
  );
  assert.match(
    applyCommand(s, 0, { type: "research", tech: "armor" })!,
    /prerequisite/,
  );
  applyCommand(s, 0, { type: "research", tech: "aviation" });
  for (let i = 0; i < 120; i++) step(s);
  assert.equal(w.range, 150);
});
test("politics validates targets and surrender transfers ownership", () => {
  const s = quiet();
  assert.ok(applyCommand(s, 0, { type: "war", target: 0 }));
  applyCommand(s, 0, { type: "war", target: 1 });
  applyCommand(s, 0, { type: "surrender" });
  assert.ok(s.nations[0].surrendered);
  assert.ok(!s.units.some((u) => u.owner === 0));
  assert.ok(!Object.values(s.owners).includes(0));
});
function encounter(encircled: boolean) {
  const s = quiet();
  s.units = s.units.filter((u) => u.kind === "division");
  const p = world.provinces.find(
    (p) =>
      p.kind === "land" &&
      p.neighbors.some((id) => world.provinces[id].kind === "land"),
  )!;
  const from = p.neighbors.find((id) => world.provinces[id].kind === "land")!;
  const u = s.units[0],
    d = s.units[3];
  s.units = [u, d];
  u.owner = 0;
  u.province = from;
  u.target = p.id;
  u.attack = 100;
  d.owner = 1;
  d.province = p.id;
  d.org = 1;
  s.owners[from] = 0;
  s.owners[p.id] = 1;
  for (const id of p.neighbors)
    if (id !== from) s.owners[id] = encircled ? 0 : 1;
  s.wars = [[0, 1]];
  s.tick = 2;
  step(s);
  return { s, u, d, p };
}
test("combat causes equipment losses and retreats, not immediate deletion", () => {
  const { s, d, p } = encounter(false);
  assert.ok(s.units.includes(d));
  assert.notEqual(d.province, p.id);
  assert.ok(s.nations[d.owner].metrics.equipmentLost > 0);
  assert.ok(s.events.some((e) => e.type === "retreat"));
});
test("encircled defeated division is destroyed", () => {
  const { s, d } = encounter(true);
  assert.ok(!s.units.includes(d));
  assert.ok(s.events.some((e) => e.type === "destroyed"));
});
test("fleets commission from equipment and obey sea movement restrictions", () => {
  const s = quiet(),
    p = world.provinces.find(
      (p) => p.kind === "sea" && p.neighbors.some((id) => s.owners[id] === 0),
    )!;
  const before = s.nations[0].stock.destroyer;
  assert.equal(
    applyCommand(s, 0, { type: "fleet", province: p.id, ships: 3 }),
    null,
  );
  assert.equal(s.nations[0].stock.destroyer, before - 3);
  const u = s.units.at(-1)!;
  assert.ok(
    applyCommand(s, 0, { type: "move", units: [u.id], province: own(s) }),
  );
  const dest = p.neighbors.find((id) => world.provinces[id].kind === "sea")!;
  applyCommand(s, 0, { type: "move", units: [u.id], province: dest });
  for (let i = 0; i < 3; i++) step(s);
  assert.equal(u.province, dest);
});
test("horizontal distance and pixel adjacency wrap, vertical edges do not", () => {
  assert.equal(distance(world, [1, 20], [359, 20]), 2);
  const raster = (colors: string[]) => ({
    width: 4,
    height: 1,
    data: Uint8Array.from(
      colors.flatMap((c) => [
        ...c
          .slice(1)
          .match(/../g)!
          .map((x) => parseInt(x, 16)),
        255,
      ]),
    ),
  });
  const tile = raster(["#ff0000", "#00ff00", "#00ff00", "#0000ff"]);
  const map = compileMap(
    tile,
    {
      kind: raster(Array(4).fill(palette.land)),
      air: raster(Array(4).fill("#010203")),
    },
    [{ id: 0, name: "Test", color: "#ffffff", capital: 0, description: "" }],
    "test",
  );
  assert.ok(map.provinces[0].neighbors.includes(2));
  assert.ok(map.provinces[2].neighbors.includes(0));
  assert.deepEqual(map.provinces[1].neighbors, [0, 2]);
});
test("categorical overlap, disconnected polygons and mismatched layers", () => {
  const raster = (colors: string[]) => ({
    width: 3,
    height: 1,
    data: Uint8Array.from(
      colors.flatMap((c) => [
        ...c
          .slice(1)
          .match(/../g)!
          .map((x) => parseInt(x, 16)),
        255,
      ]),
    ),
  });
  const tiles = raster(["#ff0000", "#00ff00", "#ff0000"]);
  const s = compileMap(
    tiles,
    {
      kind: raster([palette.land, palette.sea, palette.land]),
      air: raster(["#ff0000", "#00ff00", "#ff0000"]),
    },
    [],
    "test",
  );
  assert.equal(s.provinces[0].polygons.length, 2);
  assert.equal(s.provinces[0].kind, "land");
  assert.throws(
    () =>
      compileMap(
        tiles,
        { kind: { ...tiles, width: 2 }, air: tiles },
        [],
        "test",
      ),
    /dimensions/,
  );
});
test("lightweight SQLite restores exact current state and deterministic continuation", async () => {
  await initStorage(path.resolve("node_modules/sql.js/dist/sql-wasm.wasm"));
  const a = createGame(world, null, 123),
    db = new GameSave();
  db.record(a);
  for (let i = 0; i < 120; i++) {
    step(a, aiOrders(a));
    db.record(a);
  }
  assert.equal(
    Number(db.query("SELECT COUNT(*) FROM current_state")[0].values[0][0]),
    0,
    "no per-tick state serialization",
  );
  assert.equal(
    Number(db.query("SELECT COUNT(*) FROM national_stats")[0].values[0][0]),
    41 * a.nations.length,
  );
  assert.ok(
    !db.query(
      "SELECT name FROM sqlite_master WHERE name IN ('ticks','commands','snapshots')",
    ).length,
  );
  const loaded = new GameSave(db.bytes()),
    b = loaded.load();
  assert.equal(checksum(a), checksum(b));
  assert.deepEqual(
    loaded.history(0).owners,
    Object.fromEntries(world.provinces.map((p) => [p.id, p.owner])),
  );
  assert.equal(
    loaded.history(5).units.length,
    0,
    "history does not pretend to restore unit positions",
  );
  for (let i = 0; i < 20; i++) {
    step(a, aiOrders(a));
    step(b, aiOrders(b));
  }
  assert.equal(checksum(a), checksum(b));
  loaded.db.run("UPDATE current_state SET checksum='bad'");
  assert.throws(() => loaded.load(), /corrupted/);
  db.record(a);
  assert.throws(() => db.record(a), /already recorded/);
  db.close();
  loaded.close();
});

test("ownership change events alone reconstruct territorial history including surrender", () => {
  const s = quiet(),
    owners = { ...s.owners };
  applyCommand(s, 0, { type: "war", target: 1 });
  applyCommand(s, 0, { type: "surrender" });
  for (const e of s.events)
    if (
      (e.type === "capture" || e.type === "ownership") &&
      e.province !== undefined
    )
      owners[e.province] = e.nation!;
  assert.deepEqual(owners, s.owners);
});
