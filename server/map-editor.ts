import http from "node:http";
import path from "node:path";
import { createServer } from "vite";
import { assetHandler } from "./map-assets";
const handle = assetHandler(process.env.MAP_ASSET_DIR || "assets/source");
const port = Number(process.env.MAP_PORT || 3001);
const vite = await createServer({
  root: path.resolve("editor"),
  cacheDir: path.resolve(`node_modules/.vite-map-editor-${port}`),
  server: {
    middlewareMode: true,
    hmr: { port: port + 21678 },
    fs: { allow: [path.resolve(".")] },
  },
  appType: "spa",
});
const server = http.createServer(async (req, res) => {
  if (await handle(req, res)) return;
  if (req.url?.startsWith("/../src/") || req.url?.startsWith("/src/"))
    req.url =
      "/@fs/" +
      path.resolve(".") +
      "/src/" +
      req.url.replace(/^\/(?:\.\.\/)?src\//, "");
  vite.middlewares(req, res);
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Map workshop running on port ${port} (local source PNG editing)`,
  ),
);
