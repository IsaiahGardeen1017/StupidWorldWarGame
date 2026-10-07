import { useEffect, useRef, useState, useMemo } from "react";
import { Icon } from "../ui/Icons";
import {
  brush,
  fill,
  readColor,
  stroke,
  unusedColor,
  type Pixels,
} from "./pixels";
interface Asset {
  name: string;
  width: number;
  height: number;
  revision: string;
  palette: { color: string; label: string }[] | null;
  colors: string[];
  colorCount: number;
}
export function Editor() {
  const [assets, setAssets] = useState<Asset[]>([]),
    [asset, setAsset] = useState<Asset | null>(null),
    [color, setColor] = useState("#ffffff"),
    [size, setSize] = useState(8),
    [shape, setShape] = useState<"circle" | "square">("circle"),
    [wrap, setWrap] = useState(true),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [status, setStatus] = useState("Opening source atlas…"),
    [hover, setHover] = useState<[number, number] | null>(null),
    [zoom, setZoom] = useState(1),
    [version, setVersion] = useState(0),
    [space, setSpace] = useState(false),
    [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    pixels = useRef<Pixels | null>(null),
    image = useRef<HTMLCanvasElement | null>(null),
    view = useRef({ x: 0, y: 0, zoom: 1 }),
    history = useRef<Uint8ClampedArray[]>([]),
    future = useRef<Uint8ClampedArray[]>([]),
    editVersion = useRef(0),
    savedVersion = useRef(0),
    drawRef = useRef<() => void>(() => {}),
    saveRef = useRef<() => void>(() => {}),
    drag = useRef<{
      kind: "brush" | "pan";
      last: [number, number];
      before: Uint8ClampedArray | null;
      changed: boolean;
    } | null>(null),
    params = useRef({ color, size, shape, wrap, space, asset });
  params.current = { color, size, shape, wrap, space, asset };
  const mark = () => {
    editVersion.current++;
    setDirty(true);
    setVersion((v) => v + 1);
  };
  const sync = () => {
    const p = pixels.current;
    if (!p || !image.current) return;
    image.current
      .getContext("2d")!
      .putImageData(
        new ImageData(new Uint8ClampedArray(p.data), p.width, p.height),
        0,
        0,
      );
    drawRef.current();
  };
  const checkpoint = (before: Uint8ClampedArray) => {
    history.current.push(before);
    while (
      history.current.length > 1 &&
      (history.current.length > 30 ||
        history.current.reduce((bytes, entry) => bytes + entry.byteLength, 0) >
          64 * 1024 * 1024)
    )
      history.current.shift();
    future.current = [];
    mark();
  };
  const fit = () => {
    const p = pixels.current,
      el = viewport.current;
    if (!p || !el) return;
    const z = Math.max(
      0.1,
      Math.min(
        (el.clientWidth - 90) / p.width,
        (el.clientHeight - 90) / p.height,
      ),
    );
    view.current = {
      x: (el.clientWidth - p.width * z) / 2,
      y: (el.clientHeight - p.height * z) / 2,
      zoom: z,
    };
    setZoom(z);
    drawRef.current();
  };
  async function open(next: Asset, force = false) {
    if (saving) return;
    if (
      !force &&
      dirty &&
      !window.confirm("Discard unsaved changes and open another layer?")
    )
      return;
    try {
      setStatus(`Opening ${next.name}…`);
      setError("");
      const response = await fetch(
        `/api/asset?name=${encodeURIComponent(next.name)}`,
      );
      if (!response.ok) throw Error("Could not open source PNG");
      const bitmap = await createImageBitmap(await response.blob());
      const off = document.createElement("canvas");
      off.width = bitmap.width;
      off.height = bitmap.height;
      const ctx = off.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      pixels.current = {
        width: off.width,
        height: off.height,
        data: ctx.getImageData(0, 0, off.width, off.height).data,
      };
      image.current = off;
      const updated = {
        ...next,
        revision: response.headers.get("X-Asset-Revision") || next.revision,
      };
      setAsset(updated);
      setColor(next.palette?.[0]?.color || next.colors[0] || "#ffffff");
      history.current = [];
      future.current = [];
      editVersion.current = 0;
      savedVersion.current = 0;
      setDirty(false);
      setVersion((v) => v + 1);
      setStatus(`${next.name} opened · paint directly into the source image`);
      requestAnimationFrame(fit);
    } catch (e) {
      setError(String(e));
      setStatus("Could not open asset");
    }
  }
  useEffect(() => {
    fetch("/api/assets")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw Error(data.error);
        setAssets(data.assets);
        if (data.assets.length)
          void open(
            data.assets.find((a: Asset) => a.name === "provinces.png") ||
              data.assets[0],
          );
        else setStatus("No source PNGs found");
      })
      .catch((e) => setError(String(e)));
  }, []);
  async function save() {
    const current = params.current.asset,
      p = pixels.current;
    if (!current || !p || saving) return;
    setSaving(true);
    setError("");
    const capture = editVersion.current;
    setStatus(`Saving ${current.name}…`);
    try {
      sync();
      const png = await new Promise<Blob>((resolve, reject) =>
        image.current!.toBlob(
          (b) => (b ? resolve(b) : reject(Error("Could not encode PNG"))),
          "image/png",
        ),
      );
      const r = await fetch(
        `/api/asset?name=${encodeURIComponent(current.name)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "image/png",
            "X-Map-Editor": "1",
            "If-Match": current.revision,
          },
          body: png,
        },
      );
      const data = await r.json();
      if (!r.ok) throw Error(data.error || "Save failed");
      setAsset((a) =>
        a?.name === current.name ? { ...a, revision: data.revision } : a,
      );
      setAssets((as) =>
        as.map((a) =>
          a.name === current.name ? { ...a, revision: data.revision } : a,
        ),
      );
      savedVersion.current = capture;
      setDirty(editVersion.current !== capture);
      setStatus(
        `${current.name} saved to assets/source · ${new Date().toLocaleTimeString()}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("Save failed · your edits remain in the editor");
    } finally {
      setSaving(false);
    }
  }
  saveRef.current = () => void save();
  function undo(redo = false) {
    const p = pixels.current;
    if (!p) return;
    const source = redo ? future.current : history.current,
      target = redo ? history.current : future.current,
      previous = source.pop();
    if (!previous) return;
    target.push(new Uint8ClampedArray(p.data));
    p.data = previous;
    mark();
    sync();
    setStatus(redo ? "Change reapplied" : "Last change undone");
  }
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(
        (e.target as HTMLElement)?.tagName,
      );
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        ["z", "y"].includes(e.key.toLowerCase()) &&
        !typing
      ) {
        e.preventDefault();
        undo(e.key.toLowerCase() === "y" || e.shiftKey);
        return;
      }
      if (e.code === "Space" && !typing) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    const blur = () => setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    const leave = (e: BeforeUnloadEvent) => {
      if (editVersion.current !== savedVersion.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("beforeunload", leave);
    };
  }, []);
  useEffect(() => {
    const el = viewport.current!,
      c = canvas.current!,
      ctx = c.getContext("2d")!;
    const render = () => {
      const w = el.clientWidth,
        h = el.clientHeight,
        dpr = Math.min(devicePixelRatio, 2);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#171e24";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#ffffff04";
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      if (!image.current) return;
      const { x, y, zoom: z } = view.current;
      ctx.shadowColor = "#0008";
      ctx.shadowBlur = 22;
      ctx.fillStyle = "#111";
      ctx.fillRect(x, y, image.current.width * z, image.current.height * z);
      ctx.shadowBlur = 0;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        image.current,
        x,
        y,
        image.current.width * z,
        image.current.height * z,
      );
      ctx.strokeStyle = "#adb8c055";
      ctx.strokeRect(
        x - 0.5,
        y - 0.5,
        image.current.width * z + 1,
        image.current.height * z + 1,
      );
      if (z >= 12) {
        ctx.strokeStyle = "#0004";
        for (let px = 0; px <= image.current.width; px++) {
          ctx.beginPath();
          ctx.moveTo(x + px * z, y);
          ctx.lineTo(x + px * z, y + image.current.height * z);
          ctx.stroke();
        }
        for (let py = 0; py <= image.current.height; py++) {
          ctx.beginPath();
          ctx.moveTo(x, y + py * z);
          ctx.lineTo(x + image.current.width * z, y + py * z);
          ctx.stroke();
        }
      }
    };
    drawRef.current = render;
    const ro = new ResizeObserver(render);
    ro.observe(el);
    render();
    const coords = (e: {
      clientX: number;
      clientY: number;
    }): [number, number] => {
      const r = c.getBoundingClientRect();
      return [
        Math.floor((e.clientX - r.left - view.current.x) / view.current.zoom),
        Math.floor((e.clientY - r.top - view.current.y) / view.current.zoom),
      ];
    };
    const pointerDown = (e: PointerEvent) => {
      e.preventDefault();
      const point = coords(e),
        p = pixels.current;
      if (!p) return;
      c.setPointerCapture(e.pointerId);
      if (params.current.space && e.button === 0) {
        drag.current = {
          kind: "pan",
          last: [e.clientX, e.clientY],
          before: null,
          changed: false,
        };
        return;
      }
      const sample = readColor(p, ...point);
      if (!sample) return;
      if (e.button === 1) {
        if (
          !params.current.asset?.palette ||
          params.current.asset.palette.some((s) => s.color === sample)
        ) {
          setColor(sample);
          setStatus(`Picked ${sample.toUpperCase()} at ${point.join(", ")}`);
        }
        return;
      }
      if (e.button === 0) {
        const before = new Uint8ClampedArray(p.data);
        if (fill(p, ...point, params.current.color, params.current.wrap)) {
          checkpoint(before);
          sync();
          setStatus("Contiguous region filled");
        }
        return;
      }
      if (e.button === 2) {
        drag.current = {
          kind: "brush",
          last: point,
          before: new Uint8ClampedArray(p.data),
          changed: brush(
            p,
            ...point,
            params.current.size,
            params.current.shape,
            params.current.color,
            params.current.wrap,
          ),
        };
        if (drag.current.changed) {
          editVersion.current++;
          setDirty(true);
        }
        sync();
      }
    };
    const pointerMove = (e: PointerEvent) => {
      const point = coords(e),
        p = pixels.current;
      setHover(p && readColor(p, ...point) ? point : null);
      const active = drag.current;
      if (!active || !p) return;
      if (active.kind === "pan") {
        view.current.x += e.clientX - active.last[0];
        view.current.y += e.clientY - active.last[1];
        active.last = [e.clientX, e.clientY];
        render();
        return;
      }
      if (!readColor(p, ...point)) return;
      const changed = stroke(
        p,
        active.last,
        point,
        params.current.size,
        params.current.shape,
        params.current.color,
        params.current.wrap,
      );
      active.changed = changed || active.changed;
      if (changed) {
        editVersion.current++;
        setDirty(true);
      }
      active.last = point;
      sync();
    };
    const pointerUp = () => {
      const active = drag.current;
      if (active?.kind === "brush" && active.changed && active.before) {
        checkpoint(active.before);
        setStatus("Brush stroke applied");
      }
      drag.current = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.shiftKey) {
        setSize((s) => Math.max(1, Math.min(128, s + (e.deltaY < 0 ? 1 : -1))));
        return;
      }
      const rect = c.getBoundingClientRect(),
        mx = e.clientX - rect.left,
        my = e.clientY - rect.top,
        old = view.current.zoom,
        next = Math.max(0.1, Math.min(64, old * Math.exp(-e.deltaY * 0.0015)));
      view.current.x = mx - ((mx - view.current.x) * next) / old;
      view.current.y = my - ((my - view.current.y) * next) / old;
      view.current.zoom = next;
      setZoom(next);
      render();
    };
    const context = (e: Event) => e.preventDefault();
    const leave = () => setHover(null);
    c.addEventListener("pointerdown", pointerDown);
    c.addEventListener("pointermove", pointerMove);
    c.addEventListener("pointerup", pointerUp);
    c.addEventListener("pointercancel", pointerUp);
    c.addEventListener("pointerleave", leave);
    c.addEventListener("wheel", wheel, { passive: false });
    c.addEventListener("contextmenu", context);
    return () => {
      ro.disconnect();
      c.removeEventListener("pointerdown", pointerDown);
      c.removeEventListener("pointermove", pointerMove);
      c.removeEventListener("pointerup", pointerUp);
      c.removeEventListener("pointercancel", pointerUp);
      c.removeEventListener("pointerleave", leave);
      c.removeEventListener("wheel", wheel);
      c.removeEventListener("contextmenu", context);
    };
  }, []);
  const sourceColors = useMemo(
    () =>
      asset?.palette?.map((s) => s.color) ||
      [
        ...new Set(
          pixels.current
            ? Array.from(
                { length: pixels.current.width * pixels.current.height },
                (_, i) =>
                  readColor(
                    pixels.current!,
                    i % pixels.current!.width,
                    Math.floor(i / pixels.current!.width),
                  )!,
              )
            : [],
        ),
      ].sort(),
    [asset, version],
  );
  const outline = hover
    ? {
        left: view.current.x + (hover[0] + 0.5) * zoom,
        top: view.current.y + (hover[1] + 0.5) * zoom,
        width: size * zoom,
        height: size * zoom,
        borderRadius: shape === "circle" ? "50%" : "0",
      }
    : null;
  return (
    <div className="editor-app">
      <header className="editor-header">
        <div className="workshop-brand">
          <Icon name="map" size={27} />
          <span>
            MAP WORKSHOP<small>WORLD AT WAR · SOURCE ATLAS</small>
          </span>
        </div>
        <div className="editor-document">
          <Icon name="folder" size={17} />
          <b>
            {asset?.name || "Loading…"}
            {dirty && <span className="dirty-mark"> ●</span>}
          </b>
          <small>{asset ? `${asset.width} × ${asset.height} px` : ""}</small>
        </div>
        <div className="editor-actions">
          <button
            aria-label="Undo"
            title="Undo · Ctrl Z"
            disabled={!history.current.length}
            onClick={() => undo()}
          >
            <Icon name="undo" />
          </button>
          <button
            aria-label="Redo"
            title="Redo · Ctrl Shift Z"
            disabled={!future.current.length}
            onClick={() => undo(true)}
          >
            <Icon name="redo" />
          </button>
          <button
            className="editor-save"
            onClick={() => saveRef.current()}
            disabled={!asset || saving}
          >
            <Icon name="save" size={17} />
            {saving ? "Saving…" : "Save asset"}
            <kbd>Ctrl S</kbd>
          </button>
        </div>
      </header>
      <div className="editor-workspace">
        <aside className="editor-sidebar">
          <div className="editor-section">
            <h2>Source layer</h2>
            <select
              aria-label="Source PNG"
              value={asset?.name || ""}
              disabled={saving}
              onChange={(e) => {
                const next = assets.find((a) => a.name === e.target.value);
                if (next) void open(next);
              }}
            >
              {assets.map((a) => (
                <option key={a.name}>{a.name}</option>
              ))}
            </select>
            <p>
              {asset?.name === "kind.png"
                ? "Land, sea, and impassable areas. Only the four classification colors can be painted."
                : asset?.name === "owner.png"
                  ? "Initial country ownership. Colors follow the nations defined in this atlas."
                  : asset?.name === "air.png"
                    ? "Shared region source. Each color defines linked air and sea regions."
                    : "Each unique color identifies a province or categorical region."}
            </p>
          </div>
          <div className="editor-section">
            <h2>Paint tools</h2>
            <div className="editor-tools">
              <div>
                <Icon name="brush" />
                <b>Brush</b>
                <kbd>RIGHT CLICK</kbd>
              </div>
              <div>
                <Icon name="bucket" />
                <b>Flood fill</b>
                <kbd>LEFT CLICK</kbd>
              </div>
            </div>
            <label className="brush-label">
              Brush diameter <span>{size} px</span>
            </label>
            <input
              aria-label="Brush size"
              type="range"
              min={1}
              max={128}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
            <div className="brush-shapes">
              <button
                aria-label="Circle brush"
                className={shape === "circle" ? "active" : ""}
                onClick={() => setShape("circle")}
              >
                <i className="circle" />
                Circle
              </button>
              <button
                aria-label="Square brush"
                className={shape === "square" ? "active" : ""}
                onClick={() => setShape("square")}
              >
                <i />
                Square
              </button>
            </div>
            <label className="wrap-option">
              <input
                type="checkbox"
                checked={wrap}
                onChange={(e) => setWrap(e.target.checked)}
              />
              Wrap paint across left/right seam
            </label>
          </div>
          <div className="editor-section color-section">
            <h2>
              {asset?.palette ? "Layer palette" : "Region colors"}
              <small>
                {asset?.palette
                  ? "RESTRICTED"
                  : `${sourceColors.length} IN USE`}
              </small>
            </h2>
            <div className="current-color">
              <div style={{ background: color }} />
              <span>
                <b>{color.toUpperCase()}</b>
                <small>CURRENT PAINT COLOR</small>
              </span>
              {!asset?.palette && (
                <input
                  aria-label="Paint color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              )}
            </div>
            {!asset?.palette && (
              <button
                className="new-color"
                onClick={() => {
                  if (pixels.current) {
                    const c = unusedColor(pixels.current);
                    setColor(c);
                    setStatus(`New unused region color ${c.toUpperCase()}`);
                  }
                }}
              >
                <Icon name="dice" size={17} />
                New unused color
              </button>
            )}
            <div
              className={asset?.palette ? "fixed-palette" : "unique-palette"}
            >
              {asset?.palette
                ? asset.palette.map((s) => (
                    <button
                      key={s.color}
                      className={color === s.color ? "active" : ""}
                      onClick={() => setColor(s.color)}
                    >
                      <i style={{ background: s.color }} />
                      <span>
                        {s.label}
                        <small>{s.color.toUpperCase()}</small>
                      </span>
                      {color === s.color && <Icon name="check" size={14} />}
                    </button>
                  ))
                : sourceColors
                    .slice(0, 512)
                    .map((c) => (
                      <button
                        key={c}
                        aria-label={`Use ${c}`}
                        title={c.toUpperCase()}
                        className={color === c ? "active" : ""}
                        style={{ background: c }}
                        onClick={() => setColor(c)}
                      />
                    ))}
            </div>
          </div>
          <div className="editor-help">
            <h2>Workshop controls</h2>
            <p>
              <kbd>SCROLL</kbd> Zoom around cursor
            </p>
            <p>
              <kbd>SHIFT + SCROLL</kbd> Change brush size
            </p>
            <p>
              <kbd>MIDDLE CLICK</kbd> Pick hovered color
            </p>
            <p>
              <kbd>SPACE + DRAG</kbd> Pan the canvas
            </p>
            <p>
              <kbd>CTRL Z / Y</kbd> Undo / redo
            </p>
            <small>
              Save overwrites the selected source PNG. Compile separately with{" "}
              <code>npm run map:build</code>.
            </small>
            <button onClick={() => asset && void open(asset)} disabled={saving}>
              Reload from disk
            </button>
          </div>
        </aside>
        <main
          className={`editor-canvas-area ${space ? "panning" : ""}`}
          ref={viewport}
        >
          <canvas aria-label="Source image editing canvas" ref={canvas} />
          {outline && <div className="brush-cursor" style={outline} />}
          <div className="canvas-label">
            {asset?.name === "kind.png"
              ? "CLASSIFICATION LAYER"
              : asset?.palette
                ? "OWNERSHIP LAYER"
                : "COLOR-ID LAYER"}
            <span>{asset?.name || "SOURCE PNG"}</span>
          </div>
          <div className="zoom-tools">
            <button
              onClick={() => {
                view.current.zoom = Math.max(0.1, view.current.zoom / 1.25);
                setZoom(view.current.zoom);
                drawRef.current();
              }}
              aria-label="Zoom out"
            >
              −
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => {
                view.current.zoom = Math.min(64, view.current.zoom * 1.25);
                setZoom(view.current.zoom);
                drawRef.current();
              }}
              aria-label="Zoom in"
            >
              +
            </button>
            <button onClick={fit}>Fit</button>
            <button
              onClick={() => {
                view.current.zoom = 1;
                setZoom(1);
                drawRef.current();
              }}
            >
              1:1
            </button>
          </div>
          {error && (
            <div className="editor-error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
        </main>
      </div>
      <footer className="editor-status">
        <span className={dirty ? "unsaved" : "saved"}>
          {dirty ? "● UNSAVED CHANGES" : "● SOURCE UP TO DATE"}
        </span>
        <span role="status">{status}</span>
        <span>
          {hover
            ? `X ${hover[0]} · Y ${hover[1]} · ${readColor(pixels.current!, ...hover)?.toUpperCase()}`
            : "NO PIXEL SELECTED"}
        </span>
      </footer>
    </div>
  );
}
