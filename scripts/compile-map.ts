import fs from "node:fs";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { compileMap } from "../src/map/compiler";
const dir = process.argv[2] || "assets/source";
const hash = createHash("sha256");
const read = (name: string) => {
  const b = fs.readFileSync(`${dir}/${name}.png`);
  hash.update(b);
  return PNG.sync.read(b);
};
const tiles = read("provinces");
const layers: Record<string, ReturnType<typeof read>> = {
  kind: read("kind"),
  air: read("air"),
};
for (const f of fs.readdirSync(dir).sort())
  if (
    f.endsWith(".png") &&
    !["provinces.png", "kind.png", "air.png"].includes(f)
  )
    layers[f.slice(0, -4)] = read(f.slice(0, -4));
const nations = JSON.parse(fs.readFileSync(`${dir}/nations.json`, "utf8"));
hash.update(JSON.stringify(nations));
const world = compileMap(tiles, layers, nations, hash.digest("hex"));
for (const n of world.nations)
  if (!world.provinces.some((p) => p.id === n.capital && p.owner === n.id))
    n.capital = world.provinces.find((p) => p.owner === n.id)!.id;
fs.mkdirSync("public", { recursive: true });
fs.writeFileSync("public/world.json", JSON.stringify(world));
console.log(
  `Compiled ${world.provinces.length} provinces, ${world.airZones.length} air zones, ${world.seaZones.length} sea zones; ${world.sourceHash.slice(0, 12)}`,
);
fs.copyFileSync(
  "node_modules/sql.js/dist/sql-wasm.wasm",
  "public/sql-wasm.wasm",
);
