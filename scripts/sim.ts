import fs from "node:fs";
import path from "node:path";
import { createGame, step, aiOrders, checksum } from "../src/engine/engine";
import { calendar, SIMULATION_END_TICK } from "../src/engine/calendar";
import { GameSave, initStorage } from "../src/persistence/save";
await initStorage(path.resolve("node_modules/sql.js/dist/sql-wasm.wasm"));
const ticks =
    process.argv[2] === undefined
      ? SIMULATION_END_TICK
      : Number(process.argv[2]),
  output = process.argv[3] || "/tmp/world-at-war.sqlite",
  seed = Number(process.argv[4] || 12345);
if (!Number.isSafeInteger(ticks) || ticks < 0)
  throw Error("Tick limit must be a non-negative safe integer");
const game = createGame(
    JSON.parse(fs.readFileSync("public/world.json", "utf8")),
    null,
    seed,
  ),
  save = new GameSave();
save.record(game);
for (let i = 0; i < ticks && game.winner === null; i++) {
  const orders = aiOrders(game);
  step(game, orders);
  save.record(game);
  if (game.tick % 900 === 0)
    console.log(
      `${calendar(game.tick).date}: ${game.nations.filter((n) => !n.surrendered).length} nations, ${game.units.length} units`,
    );
}
fs.writeFileSync(output, save.bytes());
console.log(
  JSON.stringify(
    {
      tick: game.tick,
      date: calendar(game.tick).date,
      phase: calendar(game.tick).phase,
      seed,
      checksum: checksum(game),
      winner:
        game.winner === null ? null : game.world.nations[game.winner].name,
      units: game.units.length,
      events: game.events.length,
      save: output,
      bytes: fs.statSync(output).size,
    },
    null,
    2,
  ),
);
save.close();
