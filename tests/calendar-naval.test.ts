import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendar,
  tickForDate,
  SIMULATION_END_TICK,
} from "../src/engine/calendar";
import { compileMap, palette } from "../src/map/compiler";
import {
  createGame,
  applyCommand,
  step,
  EMBARK_TICKS,
  DISEMBARK_TICKS,
  LANDING_ATTACK_MULTIPLIER,
  aiOrders,
  checksum,
} from "../src/engine/engine";
import type { State } from "../src/engine/types";
const raster = (colors: string[]) => ({
  width: colors.length,
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
function scenario() {
  const kinds = [
    palette["impassable-sea"],
    palette.land,
    palette.land,
    palette.sea,
    palette.sea,
    palette.land,
    palette.land,
    palette.sea,
    palette["impassable-sea"],
  ];
  const nations = [
    { id: 0, name: "West", color: "#aaaaaa", capital: 2, description: "" },
    { id: 1, name: "East", color: "#bbbbbb", capital: 5, description: "" },
  ];
  const world = compileMap(
    raster(kinds.map((_, i) => "#" + (i + 1).toString(16).padStart(6, "0"))),
    {
      kind: raster(kinds),
      air: raster(kinds.map(() => "#112233")),
      owner: raster([
        "#000000",
        "#aaaaaa",
        "#aaaaaa",
        "#000000",
        "#000000",
        "#bbbbbb",
        "#bbbbbb",
        "#000000",
        "#000000",
      ]),
    },
    nations,
    "fixture",
  );
  const s = createGame(world, 0);
  s.nations.forEach((n) => (n.ai = false));
  s.wars = [[0, 1]];
  s.ports = { 2: true };
  return s;
}
const advance = (s: State, ticks: number) => {
  for (let i = 0; i < ticks; i++) step(s);
};
test("Gregorian calendar has two daylight ticks, one night and all leap days", () => {
  assert.equal(calendar(0).date, "1936-01-01");
  assert.equal(calendar(1).phase, "Day · late");
  assert.equal(calendar(2).phase, "Night");
  assert.equal(calendar(3).date, "1936-01-02");
  for (const y of [1936, 1940, 1944])
    assert.equal(calendar(tickForDate(`${y}-02-28`) + 3).date, `${y}-02-29`);
  assert.equal(calendar(tickForDate("1937-02-28") + 3).date, "1937-03-01");
  assert.equal(SIMULATION_END_TICK, 10959);
  assert.equal(calendar(SIMULATION_END_TICK).date, "1946-01-01");
  assert.throws(() => tickForDate("1937-02-29"), /Invalid/);
  const s = scenario();
  s.tick = SIMULATION_END_TICK;
  step(s);
  assert.equal(s.tick, SIMULATION_END_TICK + 1, "live games have no end date");
});
test("one shared source color creates linked land air, sea air and sea zones", () => {
  const s = scenario(),
    w = s.world;
  assert.equal(w.airZones.length, 2);
  assert.equal(w.seaZones.length, 1);
  const land = w.airZones[w.provinces[2].airZone],
    sea = w.airZones[w.provinces[3].airZone];
  assert.equal(land.medium, "land");
  assert.equal(sea.medium, "sea");
  assert.deepEqual(land.linkedAirZones, [sea.id]);
  assert.equal(land.seaZone, sea.seaZone);
  assert.deepEqual(w.seaZones[0].airZones.sort(), [land.id, sea.id].sort());
  assert.equal(w.provinces[2].seaZone, null);
  assert.equal(w.provinces[3].seaZone, 0);
});
test("ports require owned coast and consume civilian construction work", () => {
  const s = scenario();
  s.ports = {};
  assert.equal(
    applyCommand(s, 0, { type: "build", kind: "port", province: 2 }),
    null,
  );
  assert.match(
    applyCommand(s, 0, { type: "build", kind: "port", province: 2 })!,
    /queued/,
  );
  assert.ok(applyCommand(s, 0, { type: "build", kind: "port", province: 5 }));
  assert.ok(applyCommand(s, 0, { type: "build", kind: "port", province: 1 }));
  advance(s, 68);
  assert.ok(!s.ports[2]);
  step(s);
  assert.ok(s.ports[2]);
  assert.equal(s.nations[0].mils, 8);
  assert.equal(s.nations[0].civs, 6);
});
test("transport requires a port, traverses sea faster, and never fights at sea", () => {
  const s = scenario(),
    u = s.units.find((u) => u.owner === 0 && u.kind === "division")!;
  u.province = 2;
  s.units = s.units.filter((x) => x.kind === "fleet" || x.id === u.id);
  s.ports = {};
  assert.match(
    applyCommand(s, 0, { type: "move", units: [u.id], province: 4 })!,
    /port/,
  );
  s.ports = { 2: true };
  const fleet = s.units.find((u) => u.owner === 1 && u.kind === "fleet")!;
  fleet.province = 3;
  assert.equal(
    applyCommand(s, 0, { type: "move", units: [u.id], province: 4 }),
    null,
  );
  advance(s, 3);
  assert.equal(u.transition?.ready, 3 + EMBARK_TICKS);
  advance(s, EMBARK_TICKS - 1);
  assert.equal(u.province, 2);
  step(s);
  assert.equal(u.province, 3);
  step(s);
  assert.equal(u.province, 4);
  assert.equal(u.strength, 100);
  assert.equal(fleet.strength, 100);
  assert.equal(s.owners[3], null);
  assert.equal(
    applyCommand(s, 0, { type: "move", units: [u.id], province: 5 }),
    null,
  );
  step(s);
  const ready = s.tick + DISEMBARK_TICKS;
  assert.equal(u.transition?.ready, ready);
  advance(s, DISEMBARK_TICKS - 1);
  assert.equal(u.province, 4);
  step(s);
  assert.equal(u.province, 5);
  assert.equal(s.owners[5], 0);
  assert.ok(!u.transition);
});
test("opposing division transports coexist without sea combat", () => {
  const s = scenario(),
    a = s.units.find((u) => u.owner === 0 && u.kind === "division")!,
    b = s.units.find((u) => u.owner === 1 && u.kind === "division")!;
  s.units = [a, b];
  a.province = 3;
  b.province = 4;
  applyCommand(s, 0, { type: "move", units: [a.id], province: 4 });
  step(s);
  assert.equal(a.province, 4);
  assert.equal(a.strength, 100);
  assert.equal(b.strength, 100);
  assert.equal(s.nations[0].metrics.equipmentLost, 0);
});
test("hostile landing has 75% attack penalty and doubled incoming casualties", () => {
  function battle(landing: boolean) {
    const s = scenario(),
      u = s.units.find((u) => u.owner === 0 && u.kind === "division")!,
      d = s.units.find((u) => u.owner === 1 && u.kind === "division")!;
    s.units = [u, d];
    u.province = landing ? 4 : 6;
    s.owners[6] = 0;
    u.target = 5;
    u.route = [5];
    u.attack = 100;
    u.defense = 10;
    u.moveReady = 0;
    if (landing) u.transition = { from: 4, to: 5, ready: 0, kind: "disembark" };
    d.province = 5;
    d.org = 100;
    d.maxOrg = 100;
    d.attack = 20;
    d.defense = 10;
    d.moveReady = 99;
    step(s);
    return { u, d, s };
  }
  const land = battle(false),
    naval = battle(true);
  assert.equal(LANDING_ATTACK_MULTIPLIER, 0.25);
  assert.ok(naval.d.org > land.d.org);
  assert.ok(naval.u.org < land.u.org);
  assert.ok(naval.u.strength < land.u.strength);
  assert.equal(
    naval.u.province,
    4,
    "attacker stays at sea until defenders retreat",
  );
});
test("AI uses the same transport command API to reach an island nation deterministically", () => {
  const a = scenario(),
    b = scenario();
  a.nations[0].ai = true;
  b.nations[0].ai = true;
  for (let i = 0; i < 90; i++) {
    step(a, aiOrders(a));
    step(b, aiOrders(b));
  }
  assert.equal(checksum(a), checksum(b));
  assert.ok(a.events.some((e) => e.type === "embark" && e.nation === 0));
  assert.ok(a.events.some((e) => e.type === "disembark" && e.nation === 0));
});

test("failed landings can retreat through enemy fleets without naval interception", () => {
  const s = scenario(),
    u = s.units.find((u) => u.owner === 0 && u.kind === "division")!,
    d = s.units.find((u) => u.owner === 1 && u.kind === "division")!,
    fleet = s.units.find((u) => u.owner === 1 && u.kind === "fleet")!;
  s.units = [u, d, fleet];
  u.province = 4;
  u.org = 1;
  u.target = 5;
  u.route = [5];
  u.transition = { from: 4, to: 5, ready: 0, kind: "disembark" };
  u.moveReady = 0;
  d.province = 5;
  d.org = 100;
  d.maxOrg = 100;
  d.moveReady = 99;
  fleet.province = 3;
  step(s);
  assert.ok(s.units.includes(u));
  assert.equal(u.province, 3);
  assert.equal(fleet.strength, 100);
  assert.equal(s.nations[0].metrics.unitsLost, 0);
});
