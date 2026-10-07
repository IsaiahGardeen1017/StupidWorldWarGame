import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { palette } from "../src/map/compiler";
export interface Swatch {
  color: string;
  label: string;
}
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function parsePng(b: Buffer) {
  if (
    b.length < 24 ||
    !b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw Error("Invalid PNG");
  const w = b.readUInt32BE(16),
    h = b.readUInt32BE(20);
  if (!w || !h || w * h > 16000000)
    throw Error("PNG must contain 1–16 million pixels");
  return PNG.sync.read(b);
}
export function assetHandler(sourceDir: string) {
  const root = path.resolve(sourceDir);
  const locate = async (name: string) => {
    if (name !== path.basename(name) || !name.toLowerCase().endsWith(".png"))
      throw Error("Invalid asset filename");
    const real = await fs.realpath(path.join(root, name));
    if (path.dirname(real) !== (await fs.realpath(root)))
      throw Error("Asset must be inside the source folder");
    return real;
  };
  const swatches = async (name: string): Promise<Swatch[] | null> => {
    if (name === "kind.png")
      return Object.entries(palette).map(([label, color]) => ({
        label: label.replaceAll("-", " "),
        color,
      }));
    if (name === "owner.png") {
      const nations = JSON.parse(
        await fs.readFile(path.join(root, "nations.json"), "utf8"),
      );
      return [
        { color: "#000000", label: "Unowned" },
        ...nations.map((n: { name: string; color: string }) => ({
          color: n.color.toLowerCase(),
          label: n.name,
        })),
      ];
    }
    try {
      const custom = JSON.parse(
        await fs.readFile(path.join(root, "palettes.json"), "utf8"),
      );
      return custom[name] ?? null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  return async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> => {
    const url = new URL(req.url || "/", "http://local");
    if (!url.pathname.startsWith("/api/")) return false;
    try {
      if (req.method === "GET" && url.pathname === "/api/assets") {
        const files = (await fs.readdir(root, { withFileTypes: true }))
          .filter((f) => f.isFile() && f.name.toLowerCase().endsWith(".png"))
          .sort((a, b) => a.name.localeCompare(b.name));
        const assets = [];
        for (const f of files) {
          const b = await fs.readFile(await locate(f.name)),
            png = parsePng(b),
            colors = new Set<string>();
          for (let i = 0; i < png.data.length; i += 4)
            colors.add("#" + png.data.subarray(i, i + 3).toString("hex"));
          assets.push({
            name: f.name,
            width: png.width,
            height: png.height,
            revision: hash(b),
            palette: await swatches(f.name),
            colorCount: colors.size,
            colors: [...colors].sort().slice(0, 512),
          });
        }
        json(res, 200, { assets });
        return true;
      }
      if (url.pathname === "/api/asset" && req.method === "GET") {
        const b = await fs.readFile(
          await locate(url.searchParams.get("name") || ""),
        );
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "no-store",
          "X-Asset-Revision": hash(b),
        });
        res.end(b);
        return true;
      }
      if (url.pathname === "/api/asset" && req.method === "PUT") {
        const origin = req.headers.origin;
        if (
          req.headers["x-map-editor"] !== "1" ||
          !origin ||
          new URL(origin).host !== req.headers.host
        ) {
          json(res, 403, { error: "Save must come from the local editor" });
          return true;
        }
        const name = url.searchParams.get("name") || "",
          file = await locate(name),
          before = await fs.readFile(file),
          revision = req.headers["if-match"];
        if (revision !== hash(before)) {
          json(res, 409, {
            error:
              "This file changed on disk. Reload it before saving; your edits have been kept in the editor.",
          });
          return true;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32 * 1024 * 1024) throw Error("PNG exceeds 32 MB");
          chunks.push(Buffer.from(chunk));
        }
        const b = Buffer.concat(chunks),
          png = parsePng(b),
          original = parsePng(before);
        if (png.width !== original.width || png.height !== original.height)
          throw Error("Canvas dimensions must match the source asset");
        const rules = await swatches(name),
          allowed = rules
            ? new Set(rules.map((s) => s.color.toLowerCase()))
            : null;
        for (let i = 0; i < png.data.length; i += 4) {
          if (png.data[i + 3] !== 255)
            throw Error("Map PNGs must be fully opaque");
          if (
            allowed &&
            !allowed.has("#" + png.data.subarray(i, i + 3).toString("hex"))
          )
            throw Error("This layer contains a color outside its palette");
        }
        // Write fully before the atomic replacement; a failed request leaves the source intact.
        const temporary = path.join(root, `.${name}.${randomUUID()}.saving`);
        try {
          await fs.writeFile(temporary, b);
          if (hash(await fs.readFile(file)) !== revision) {
            json(res, 409, {
              error: "File changed during save; reload before saving",
            });
            return true;
          }
          await fs.rename(temporary, file);
        } finally {
          await fs.rm(temporary, { force: true });
        }
        json(res, 200, { revision: hash(b), bytes: b.length });
        return true;
      }
      json(res, 404, { error: "Unknown editor API route" });
      return true;
    } catch (e) {
      json(res, 400, {
        error: e instanceof Error ? e.message : "Asset request failed",
      });
      return true;
    }
  };
}
