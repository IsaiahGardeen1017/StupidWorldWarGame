export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export function readColor(p: Pixels, x: number, y: number) {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return null;
  const i = (y * p.width + x) * 4;
  return (
    "#" +
    [p.data[i], p.data[i + 1], p.data[i + 2]]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}
const rgb = (color: string) =>
  color
    .slice(1)
    .match(/../g)!
    .map((s) => parseInt(s, 16));
export function brush(
  p: Pixels,
  x: number,
  y: number,
  size: number,
  shape: "circle" | "square",
  color: string,
  wrap: boolean,
) {
  const c = rgb(color),
    r = size / 2,
    startX = x - Math.floor((size - 1) / 2),
    endX = startX + size - 1,
    startY = y - Math.floor((size - 1) / 2),
    endY = startY + size - 1,
    centerX = (startX + endX) / 2,
    centerY = (startY + endY) / 2;
  let changed = false;
  for (let py = startY; py <= endY; py++)
    for (let px = startX; px <= endX; px++) {
      if (
        py < 0 ||
        py >= p.height ||
        (!wrap && (px < 0 || px >= p.width)) ||
        (shape === "circle" &&
          Math.hypot(px - centerX, py - centerY) > Math.max(0.5, r))
      )
        continue;
      const mx = ((px % p.width) + p.width) % p.width,
        i = (py * p.width + mx) * 4;
      if (
        p.data[i] === c[0] &&
        p.data[i + 1] === c[1] &&
        p.data[i + 2] === c[2] &&
        p.data[i + 3] === 255
      )
        continue;
      p.data.set([...c, 255], i);
      changed = true;
    }
  return changed;
}
export function stroke(
  p: Pixels,
  from: [number, number],
  to: [number, number],
  size: number,
  shape: "circle" | "square",
  color: string,
  wrap: boolean,
) {
  const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  let changed = false;
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i / steps : 0;
    changed =
      brush(
        p,
        Math.round(from[0] + (to[0] - from[0]) * t),
        Math.round(from[1] + (to[1] - from[1]) * t),
        size,
        shape,
        color,
        wrap,
      ) || changed;
  }
  return changed;
}
export function fill(
  p: Pixels,
  x: number,
  y: number,
  color: string,
  wrap: boolean,
) {
  const before = readColor(p, x, y);
  if (!before || before === color) return false;
  const old = rgb(before),
    c = rgb(color),
    stack = [y * p.width + x];
  while (stack.length) {
    const k = stack.pop()!,
      px = k % p.width,
      py = Math.floor(k / p.width),
      i = k * 4;
    if (
      p.data[i] !== old[0] ||
      p.data[i + 1] !== old[1] ||
      p.data[i + 2] !== old[2]
    )
      continue;
    p.data.set([...c, 255], i);
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      let nx = px + dx;
      const ny = py + dy;
      if (ny < 0 || ny >= p.height) continue;
      if (wrap) nx = (nx + p.width) % p.width;
      if (nx < 0 || nx >= p.width) continue;
      stack.push(ny * p.width + nx);
    }
  }
  return true;
}
export function unusedColor(p: Pixels, random: () => number = Math.random) {
  const used = new Set<number>();
  for (let i = 0; i < p.data.length; i += 4)
    used.add((p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2]);
  let c = Math.floor(random() * 0x1000000);
  for (let i = 0; i < 0x1000000; i++, c = (c + 1) % 0x1000000)
    if (!used.has(c)) return "#" + c.toString(16).padStart(6, "0");
  throw Error("Every RGB color is already used");
}
