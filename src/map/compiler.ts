import type { Point, World, Province } from "../engine/types";
export interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}
export const palette = {
  land: "#32a852",
  sea: "#2474b5",
  "impassable-land": "#185b2b",
  "impassable-sea": "#102c61",
} as const;
const colorAt = (r: Raster, i: number) =>
  "#" +
  [r.data[i * 4], r.data[i * 4 + 1], r.data[i * 4 + 2]]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
// Every categorical raster uses the same overlap vote. Ties resolve lexically.
export function majority(votes: Map<string, number>): string {
  return [...votes].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"),
  )[0][0];
}
export function compileMap(
  tiles: Raster,
  layers: Record<string, Raster>,
  nations: World["nations"],
  sourceHash: string,
): World {
  if (!layers.kind || !layers.air)
    throw Error("kind and air rasters are required");
  for (const [name, r] of Object.entries(layers))
    if (r.width !== tiles.width || r.height !== tiles.height)
      throw Error(`${name}: raster dimensions differ`);
  const { width: w, height: h } = tiles;
  const colors = new Map<string, number>();
  const pixels: number[] = [];
  const ps: {
    p: Province;
    count: number;
    sx: number;
    sy: number;
    cx: number;
    cy: number;
    votes: Record<string, Map<string, number>>;
    edges: Map<string, Point[]>;
  }[] = [];
  for (let i = 0; i < w * h; i++) {
    const c = colorAt(tiles, i);
    if (!colors.has(c)) {
      const id = colors.size;
      colors.set(c, id);
      ps.push({
        p: {
          id,
          color: c,
          kind: "land",
          center: [0, 0],
          polygons: [],
          neighbors: [],
          airZone: 0,
          seaZone: null,
          owner: null,
          layers: {},
        },
        count: 0,
        sx: 0,
        sy: 0,
        cx: 0,
        cy: 0,
        votes: Object.fromEntries(
          Object.keys(layers).map((k) => [k, new Map()]),
        ),
        edges: new Map(),
      });
    }
    const id = colors.get(c)!;
    pixels.push(id);
    const t = ps[id];
    t.count++;
    t.sx += (i % w) + 0.5;
    t.sy += Math.floor(i / w) + 0.5;
    t.cx += Math.cos((((i % w) + 0.5) / w) * Math.PI * 2);
    t.cy += Math.sin((((i % w) + 0.5) / w) * Math.PI * 2);
    for (const [name, r] of Object.entries(layers)) {
      const c = colorAt(r, i);
      t.votes[name].set(c, (t.votes[name].get(c) || 0) + 1);
    }
  }
  // Split each source color by the compiled province medium, preserving the same
  // majority-vote semantics used for every categorical map layer.
  for (const t of ps) {
    for (const [name, v] of Object.entries(t.votes))
      t.p.layers[name] = majority(v);
    const kind = Object.entries(palette).find(
      ([, c]) => c === t.p.layers.kind,
    )?.[0];
    if (!kind)
      throw Error(
        `Unknown kind color ${t.p.layers.kind} in province ${t.p.id}`,
      );
    t.p.kind = kind as Province["kind"];
  }
  const zones = new Map<
    string,
    {
      id: number;
      color: string;
      medium: "land" | "sea";
      cx: number;
      cy: number;
      sy: number;
      count: number;
    }
  >();
  for (let i = 0; i < w * h; i++) {
    const color = colorAt(layers.air, i),
      medium = ps[pixels[i]].p.kind.endsWith("land") ? "land" : "sea",
      key = `${color}:${medium}`;
    if (!zones.has(key))
      zones.set(key, {
        id: zones.size,
        color,
        medium,
        cx: 0,
        cy: 0,
        sy: 0,
        count: 0,
      });
    const z = zones.get(key)!;
    z.cx += Math.cos((((i % w) + 0.5) / w) * Math.PI * 2);
    z.cy += Math.sin((((i % w) + 0.5) / w) * Math.PI * 2);
    z.sy += Math.floor(i / w) + 0.5;
    z.count++;
  }
  const airZones = [...zones.values()].map((z) => ({
    id: z.id,
    color: z.color,
    sourceColor: z.color,
    medium: z.medium,
    center: [
      ((((Math.atan2(z.cy, z.cx) / Math.PI / 2) * w) % w) + w) % w,
      z.sy / z.count,
    ] as Point,
    name: `Air region ${z.id + 1} · ${z.medium}`,
    linkedAirZones: [] as number[],
    seaZone: null as number | null,
  }));
  const seaZones = airZones
    .filter((z) => z.medium === "sea")
    .map((z, id) => ({
      id,
      color: z.color,
      center: z.center,
      name: `Sea region ${id + 1}`,
      airZones: airZones
        .filter((a) => a.sourceColor === z.sourceColor)
        .map((a) => a.id),
    }));
  for (const z of airZones) {
    z.linkedAirZones = airZones
      .filter((a) => a.sourceColor === z.sourceColor && a.id !== z.id)
      .map((a) => a.id);
    z.seaZone = seaZones.find((a) => a.color === z.sourceColor)?.id ?? null;
  }
  const key = (p: Point) => p.join(",");
  const edge = (id: number, a: Point, b: Point) => {
    const es = ps[id].edges;
    es.set(key(a), [...(es.get(key(a)) || []), b]);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const id = pixels[y * w + x];
      for (const [dx, dy, a, b] of [
        [0, -1, [x, y], [x + 1, y]],
        [1, 0, [x + 1, y], [x + 1, y + 1]],
        [0, 1, [x + 1, y + 1], [x, y + 1]],
        [-1, 0, [x, y + 1], [x, y]],
      ] as [number, number, Point, Point][]) {
        const nx = x + dx,
          ny = y + dy,
          other = ny < 0 || ny >= h ? -1 : pixels[ny * w + ((nx + w) % w)];
        if (other !== id || nx < 0 || nx >= w) {
          edge(id, a, b);
          if (other >= 0 && other !== id && !ps[id].p.neighbors.includes(other))
            ps[id].p.neighbors.push(other);
        }
      }
    }
  for (const t of ps) {
    t.p.center = [
      ((((Math.atan2(t.cy, t.cx) / Math.PI / 2) * w) % w) + w) % w,
      t.sy / t.count,
    ];
    for (const [name, v] of Object.entries(t.votes))
      t.p.layers[name] = majority(v);
    const kind = Object.entries(palette).find(
      ([, c]) => c === t.p.layers.kind,
    )?.[0];
    if (!kind)
      throw Error(
        `Unknown kind color ${t.p.layers.kind} in province ${t.p.id}`,
      );
    t.p.kind = kind as Province["kind"];
    t.p.airZone = zones.get(
      `${t.p.layers.air}:${t.p.kind.endsWith("land") ? "land" : "sea"}`,
    )!.id;
    t.p.seaZone = t.p.kind.endsWith("sea")
      ? airZones[t.p.airZone].seaZone
      : null;
    t.p.neighbors.sort((a, b) => a - b);
    // Pixel boundary loops preserve holes and disconnected components. Collinear points are removed.
    while (t.edges.size) {
      const start = t.edges.keys().next().value!;
      let cur: Point = start.split(",").map(Number) as Point;
      const loop: Point[] = [];
      do {
        loop.push(cur);
        const k = key(cur),
          options = t.edges.get(k);
        if (!options?.length) throw Error("Open polygon");
        cur = options.shift()!;
        if (!options.length) t.edges.delete(k);
      } while (key(cur) !== start);
      t.p.polygons.push(
        loop.filter((p, i) => {
          const a = loop[(i + loop.length - 1) % loop.length],
            b = loop[(i + 1) % loop.length];
          return (
            (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0])
          );
        }),
      );
    }
    if (t.p.kind === "land") {
      t.p.owner = layers.owner
        ? (nations.find((n) => n.color.toLowerCase() === t.p.layers.owner)
            ?.id ?? null)
        : (nations[
            Math.min(
              nations.length - 1,
              Math.floor((t.p.center[0] / w) * nations.length),
            )
          ]?.id ?? null);
    }
  }
  return {
    width: w,
    height: h,
    provinces: ps.map((t) => t.p),
    airZones,
    seaZones,
    nations,
    sourceHash,
  };
}
