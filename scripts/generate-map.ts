import { PNG } from "pngjs";
import fs from "node:fs";
import { palette } from "../src/map/compiler";
const nations = [
  {
    id: 0,
    name: "Albion",
    color: "#d4b461",
    capital: 0,
    description:
      "An island kingdom guarding the Channel and Atlantic approaches.",
  },
  {
    id: 1,
    name: "Gaullia",
    color: "#648fc0",
    capital: 0,
    description:
      "A western republic with a large army and industrial heartland.",
  },
  {
    id: 2,
    name: "Reichmark",
    color: "#b67e72",
    capital: 0,
    description:
      "A central industrial power seeking influence across the continent.",
  },
  {
    id: 3,
    name: "Italica",
    color: "#85a86d",
    capital: 0,
    description:
      "A southern kingdom projecting naval power into the Mediterranean.",
  },
  {
    id: 4,
    name: "Iberia",
    color: "#cf965c",
    capital: 0,
    description:
      "A peninsula republic at the meeting of the Atlantic and Mediterranean.",
  },
  {
    id: 5,
    name: "Nordland",
    color: "#89bdbe",
    capital: 0,
    description:
      "A northern federation protecting the Baltic and rugged coasts.",
  },
  {
    id: 6,
    name: "Volgrad Union",
    color: "#b26069",
    capital: 0,
    description:
      "An eastern union with broad frontiers and deep manpower reserves.",
  },
  {
    id: 7,
    name: "Danubia",
    color: "#a193c5",
    capital: 0,
    description:
      "A central federation at the crossroads of rival continental powers.",
  },
];
const w = 360,
  h = 240;
const maps = Object.fromEntries(
  ["provinces", "kind", "air", "owner"].map((k) => [
    k,
    new PNG({ width: w, height: h }),
  ]),
) as Record<string, PNG>;
function owner(c: number, r: number) {
  if ((c >= 2 && c <= 3 && r >= 3 && r <= 6) || (c === 1 && r === 4)) return 0;
  if (c >= 3 && c <= 6 && r >= 9 && r <= 11) return 4;
  if (c >= 5 && c <= 8 && r >= 5 && r <= 8) return 1;
  if ((c >= 9 && c <= 11 && r >= 8 && r <= 10) || (c === 12 && r === 11))
    return 3;
  if ((c >= 8 && c <= 10 && r <= 3) || (c === 11 && r <= 1)) return 5;
  if ((c >= 14 && r <= 9) || (c >= 12 && r <= 2)) return 6;
  if (c >= 9 && c <= 12 && r >= 4 && r <= 6) return 2;
  if (
    (c >= 11 && c <= 13 && r >= 7 && r <= 9) ||
    (c === 13 && r >= 3 && r <= 6)
  )
    return 7;
  return -1;
}
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const c = Math.max(
        0,
        Math.min(17, Math.floor((x + Math.sin(y * 0.045) * 5) / 20)),
      ),
      r = Math.max(
        0,
        Math.min(11, Math.floor((y + Math.sin(x * 0.06) * 4) / 20)),
      );
    let id = r * 18 + c + 1;
    const nation = owner(c, r);
    if ((c === 1 && r === 4) || (c === 2 && r === 3)) id = 217;
    const kind =
      r === 11 && c >= 15
        ? palette["impassable-sea"]
        : c === 10 && r === 7
          ? palette["impassable-land"]
          : nation < 0
            ? palette.sea
            : palette.land;
    const nc = nation >= 0 ? nations[nation].color : "#000000";
    const cs = {
      provinces: [id % 256, Math.floor(id / 256) * 90 + 30, (id * 73) % 256],
      kind: kind
        .slice(1)
        .match(/../g)!
        .map((c) => parseInt(c, 16)),
      air: [30 + Math.floor(c / 4) * 40, 40 + Math.floor(r / 4) * 65, 120],
      owner: nc
        .slice(1)
        .match(/../g)!
        .map((c) => parseInt(c, 16)),
    };
    for (const k of Object.keys(maps)) {
      const i = (y * w + x) * 4;
      maps[k].data.set([...cs[k as keyof typeof cs], 255], i);
    }
  }
fs.mkdirSync("assets/source", { recursive: true });
for (const [k, p] of Object.entries(maps))
  fs.writeFileSync(`assets/source/${k}.png`, PNG.sync.write(p));
fs.writeFileSync(
  "assets/source/nations.json",
  JSON.stringify(nations, null, 2),
);
console.log("Generated original Europe-inspired demo PNGs (360 × 240).");
