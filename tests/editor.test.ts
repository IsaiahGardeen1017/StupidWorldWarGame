import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { PNG } from "pngjs";
import {
  brush,
  stroke,
  fill,
  readColor,
  unusedColor,
  type Pixels,
} from "../src/editor/pixels";
import { assetHandler } from "../server/map-assets";
function pixels(w = 7, h = 7): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width: w, height: h, data };
}
test("brush diameter, shape, interpolation, and cylindrical seam", () => {
  const p = pixels();
  brush(p, 3, 3, 2, "square", "#ff0000", false);
  assert.equal(
    Array.from({ length: 49 }, (_, i) =>
      readColor(p, i % 7, Math.floor(i / 7)),
    ).filter((c) => c === "#ff0000").length,
    4,
  );
  const q = pixels();
  brush(q, 3, 3, 3, "circle", "#00ff00", false);
  assert.equal(readColor(q, 2, 2), "#00ff00");
  assert.equal(readColor(q, 1, 3), "#000000");
  stroke(q, [0, 0], [6, 0], 1, "square", "#ffffff", false);
  for (let x = 0; x < 7; x++) assert.equal(readColor(q, x, 0), "#ffffff");
  brush(q, 0, 3, 3, "square", "#ff0000", true);
  assert.equal(readColor(q, 6, 3), "#ff0000");
  assert.equal(readColor(q, 5, 3), "#000000");
});
test("fill is contiguous, optionally crosses horizontal seam, and does not cross vertical seam", () => {
  const p = pixels(5, 3);
  stroke(p, [2, 0], [2, 2], 1, "square", "#ffffff", false);
  fill(p, 0, 0, "#ff0000", false);
  assert.equal(readColor(p, 4, 0), "#000000");
  assert.equal(readColor(p, 1, 2), "#ff0000");
  const q = pixels(5, 3);
  stroke(q, [2, 0], [2, 2], 1, "square", "#ffffff", false);
  fill(q, 0, 0, "#ff0000", true);
  assert.equal(readColor(q, 4, 0), "#ff0000");
  assert.equal(readColor(q, 2, 0), "#ffffff");
  assert.equal(fill(q, 0, 0, "#ff0000", true), false);
  const r = pixels(3, 3);
  stroke(r, [0, 1], [2, 1], 1, "square", "#ffffff", false);
  fill(r, 0, 0, "#ff0000", true);
  assert.equal(readColor(r, 0, 2), "#000000");
});
test("new color skips every color already in the image", () => {
  const p = pixels();
  assert.equal(
    unusedColor(p, () => 0),
    "#000001",
  );
  brush(p, 0, 0, 1, "square", "#000001", false);
  assert.equal(
    unusedColor(p, () => 0),
    "#000002",
  );
});
test("editor saves existing PNG atomically and enforces palettes, dimensions, revision and asset boundary", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "map-editor-test-"));
  const png = new PNG({ width: 3, height: 2 });
  for (let i = 0; i < png.data.length; i += 4)
    png.data.set([50, 168, 82, 255], i);
  const original = PNG.sync.write(png);
  await fs.writeFile(path.join(dir, "kind.png"), original);
  const handler = assetHandler(dir),
    server = http.createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number },
    base = `http://127.0.0.1:${address.port}`;
  try {
    const list = (await (await fetch(base + "/api/assets")).json()) as {
      assets: { palette: unknown[]; revision: string }[];
    };
    assert.equal(list.assets[0].palette.length, 4);
    const revision = list.assets[0].revision;
    const save = (
      body: Buffer,
      rev = revision,
      extra: Record<string, string> = {},
    ) =>
      fetch(base + "/api/asset?name=kind.png", {
        method: "PUT",
        headers: {
          Origin: base,
          "X-Map-Editor": "1",
          "If-Match": rev,
          ...extra,
        },
        body: new Uint8Array(body),
      });
    png.data.set([255, 0, 0, 255], 0);
    assert.equal((await save(PNG.sync.write(png))).status, 400);
    assert.deepEqual(await fs.readFile(path.join(dir, "kind.png")), original);
    png.data.set([36, 116, 181, 255], 0);
    const valid = PNG.sync.write(png);
    assert.equal((await save(valid, "outdated")).status, 409);
    assert.equal(
      (await save(valid, revision, { Origin: "http://elsewhere" })).status,
      403,
    );
    const small = PNG.sync.write(new PNG({ width: 1, height: 1 }));
    assert.equal((await save(small)).status, 400);
    const result = await save(valid);
    assert.equal(result.status, 200);
    assert.deepEqual(await fs.readFile(path.join(dir, "kind.png")), valid);
    assert.equal((await save(original)).status, 409);
    assert.equal(
      (await fetch(base + "/api/asset?name=../kind.png")).status,
      400,
    );
    const outside = path.join(dir, "..", "editor-outside.png");
    await fs.writeFile(outside, original);
    await fs.symlink(outside, path.join(dir, "escape.png"));
    assert.equal(
      (await fetch(base + "/api/asset?name=escape.png")).status,
      400,
    );
    await fs.rm(outside);
    assert.equal(
      (await fs.readdir(dir)).some((f) => f.endsWith(".saving")),
      false,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
