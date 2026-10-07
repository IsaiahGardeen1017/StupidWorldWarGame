import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { State, World } from "../engine/types";
interface Props {
  world: World;
  state: State | null;
  nation: number | null;
  selected: number | null;
  units: number[];
  air: boolean;
  sea?: boolean;
  onProvince: (id: number) => void;
  onUnits: (ids: number[]) => void;
  onMove: (id: number) => void;
}
export function MapView(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    current = useRef(props);
  current.current = props;
  const [box, setBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const runtime = useRef<{
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.OrthographicCamera;
    meshes: THREE.Mesh[];
    units: THREE.Group;
    labels: THREE.Group;
  } | null>(null);
  useEffect(() => {
    const el = host.current!;
    const world = props.world;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111f2c");
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const camera = new THREE.OrthographicCamera(
      0,
      world.width,
      world.height,
      0,
      -100,
      100,
    );
    camera.position.z = 50;
    const meshes: THREE.Mesh[] = [];
    for (const p of world.provinces) {
      const shapes: THREE.Shape[] = [];
      const holes: THREE.Path[] = [];
      for (const loop of p.polygons) {
        const points = loop.map(
          ([x, y]) => new THREE.Vector2(x, world.height - y),
        );
        let area = 0;
        for (let i = 0; i < loop.length; i++) {
          const a = loop[i],
            b = loop[(i + 1) % loop.length];
          area += a[0] * b[1] - b[0] * a[1];
        }
        if (area > 0) shapes.push(new THREE.Shape(points));
        else holes.push(new THREE.Path(points));
      }
      for (const hole of holes) {
        const point = hole.getPoints()[0];
        const outer = shapes.find((shape) =>
          pointInPolygon(point, shape.getPoints()),
        );
        outer?.holes.push(hole);
      }
      const geometry = new THREE.ShapeGeometry(shapes);
      const mat = new THREE.MeshBasicMaterial({ color: "#516773" });
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.userData.province = p.id;
      meshes.push(mesh);
      scene.add(mesh);
      for (const loop of p.polygons) {
        const points = [...loop, loop[0]].map(
          ([x, y]) => new THREE.Vector3(x, world.height - y, 0.1),
        );
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({
            color: "#172b33",
            transparent: true,
            opacity: 0.75,
          }),
        );
        scene.add(line);
      }
    }
    const units = new THREE.Group(),
      labels = new THREE.Group();
    scene.add(units, labels);
    for (const n of world.nations) {
      const ps = world.provinces.filter((p) => p.owner === n.id);
      if (!ps.length) continue;
      const x = ps.reduce((a, p) => a + p.center[0], 0) / ps.length,
        y = ps.reduce((a, p) => a + p.center[1], 0) / ps.length;
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.font = "600 26px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "#10202a";
      ctx.shadowBlur = 5;
      ctx.fillText(n.name.toUpperCase(), 256, 40);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(canvas),
          depthTest: false,
          transparent: true,
        }),
      );
      sprite.position.set(x, world.height - y, 4);
      sprite.scale.set(70, 9, 1);
      labels.add(sprite);
    }
    // Repeat the atlas on each side; all copies retain the same province and unit identities.
    for (const mesh of [...meshes])
      for (const dx of [-world.width, world.width]) {
        const copy = mesh.clone();
        copy.material = (mesh.material as THREE.MeshBasicMaterial).clone();
        copy.position.x = dx;
        scene.add(copy);
        meshes.push(copy);
      }
    for (const obj of [...scene.children])
      if (obj instanceof THREE.Line)
        for (const dx of [-world.width, world.width]) {
          const copy = obj.clone();
          copy.position.x = dx;
          scene.add(copy);
        }
    for (const obj of [...labels.children])
      for (const dx of [-world.width, world.width]) {
        const copy = obj.clone();
        copy.position.x += dx;
        labels.add(copy);
      }
    const rt = { scene, renderer, camera, meshes, units, labels };
    runtime.current = rt;
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight,
        aspect = w / h;
      const vh = world.height + 24,
        vw = Math.min(
          world.width * 2.5,
          Math.max(world.width + 24, vh * aspect),
        );
      camera.left = world.width / 2 - vw / 2;
      camera.right = world.width / 2 + vw / 2;
      camera.top = world.height / 2 + vw / aspect / 2;
      camera.bottom = world.height / 2 - vw / aspect / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let frame = 0;
    const draw = () => {
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();
    const raycaster = new THREE.Raycaster();
    const pick = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((x - r.left) / r.width) * 2 - 1,
          (-(y - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      return raycaster
        .intersectObjects([...units.children, ...meshes], false)
        .map((h) => h.object)
        .find(
          (o) =>
            o.userData.unit !== undefined || o.userData.province !== undefined,
        );
    };
    let down: { x: number; y: number; button: number } | null = null;
    const start = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, button: e.button };
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!down) return;
      const r = el.getBoundingClientRect();
      if (down.button === 1) {
        camera.position.x -=
          ((e.clientX - down.x) * (camera.right - camera.left)) /
          camera.zoom /
          r.width;
        camera.position.x =
          ((((camera.position.x + world.width / 2) % world.width) +
            world.width) %
            world.width) -
          world.width / 2;
        down.x = e.clientX;
        down.y = e.clientY;
        return;
      }
      if (down.button !== 0) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5)
        setBox({
          x: Math.min(down.x, e.clientX) - r.left,
          y: Math.min(down.y, e.clientY) - r.top,
          w: Math.abs(e.clientX - down.x),
          h: Math.abs(e.clientY - down.y),
        });
    };
    const end = (e: PointerEvent) => {
      if (!down) return;
      const p = current.current;
      if (down.button === 1) {
        down = null;
        return;
      }
      if (down.button === 2) {
        const hit = pick(e.clientX, e.clientY);
        if (hit?.userData.province !== undefined)
          p.onMove(hit.userData.province);
      } else if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
        const r = el.getBoundingClientRect();
        const ids: number[] = [];
        for (const unit of units.children) {
          const pos = unit.position.clone().project(camera),
            x = ((pos.x + 1) * r.width) / 2 + r.left,
            y = ((1 - pos.y) * r.height) / 2 + r.top;
          if (
            x >= Math.min(down.x, e.clientX) &&
            x <= Math.max(down.x, e.clientX) &&
            y >= Math.min(down.y, e.clientY) &&
            y <= Math.max(down.y, e.clientY) &&
            unit.userData.owner === p.nation
          )
            ids.push(unit.userData.unit);
        }
        p.onUnits([...new Set(e.shiftKey ? [...p.units, ...ids] : ids)]);
      } else {
        const hit = pick(e.clientX, e.clientY);
        if (hit?.userData.unit !== undefined && hit.userData.owner === p.nation)
          p.onUnits(
            e.shiftKey
              ? [...new Set([...p.units, hit.userData.unit])]
              : [hit.userData.unit],
          );
        else if (hit?.userData.province !== undefined)
          p.onProvince(hit.userData.province);
      }
      down = null;
      setBox(null);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.zoom = Math.max(
        0.65,
        Math.min(4, camera.zoom * (e.deltaY > 0 ? 0.9 : 1.1)),
      );
      camera.updateProjectionMatrix();
    };
    const context = (e: Event) => e.preventDefault();
    renderer.domElement.addEventListener("pointerdown", start);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", end);
    renderer.domElement.addEventListener("wheel", wheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", context);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
        if (o instanceof THREE.Sprite) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
      runtime.current = null;
    };
  }, [props.world]);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    const { world, state, selected, nation, air } = props;
    for (const mesh of r.meshes) {
      const id = mesh.userData.province,
        p = world.provinces[id],
        owner = state ? state.owners[id] : p.owner;
      let color =
        p.kind === "sea"
          ? "#243f55"
          : p.kind === "impassable-sea"
            ? "#122230"
            : p.kind === "impassable-land"
              ? "#59615b"
              : owner === null
                ? "#687a71"
                : world.nations[owner].color;
      if (air && !p.kind.startsWith("impassable"))
        color = world.airZones[p.airZone].color;
      if (props.sea && p.seaZone !== null)
        color = world.seaZones[p.seaZone].color;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(color);
      if (id === selected) mat.color.lerp(new THREE.Color("#fff4ba"), 0.55);
      else if (nation !== null && owner !== nation && p.kind === "land")
        mat.color.multiplyScalar(0.76);
    }
    while (r.units.children.length) {
      const u = r.units.children[0] as THREE.Mesh;
      r.units.remove(u);
      u.geometry.dispose();
      (u.material as THREE.Material).dispose();
    }
    for (const id of Object.keys(state?.ports || {})) {
      if (!state?.ports[Number(id)]) continue;
      const p = world.provinces[Number(id)];
      for (const dx of [-world.width, 0, world.width]) {
        const marker = new THREE.Mesh(
          new THREE.RingGeometry(1.6, 2.4, 12),
          new THREE.MeshBasicMaterial({
            color: "#f7d48a",
            side: THREE.DoubleSide,
          }),
        );
        marker.position.set(
          p.center[0] + dx + 6,
          world.height - p.center[1] - 6,
          3,
        );
        marker.userData = { province: p.id };
        r.units.add(marker);
      }
    }
    const count: Record<number, number> = {};
    for (const u of state?.units || []) {
      const p = world.provinces[u.province],
        offset = count[u.province] || 0;
      count[u.province] = offset + 1;
      const geometry =
        u.kind === "fleet"
          ? new THREE.CircleGeometry(2.7, 3)
          : p.kind === "sea"
            ? new THREE.CircleGeometry(2.5, 4)
            : new THREE.PlaneGeometry(4.8, 3.5);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: props.units.includes(u.id)
            ? "#ffffff"
            : u.owner === nation
              ? "#f9df85"
              : "#e1a69a",
        }),
      );
      mesh.position.set(
        p.center[0] + ((offset % 3) - 1) * 5.5,
        world.height - p.center[1] - Math.floor(offset / 3) * 4,
        3,
      );
      mesh.userData = { unit: u.id, owner: u.owner };
      r.units.add(mesh);
      for (const dx of [-world.width, world.width]) {
        const copy = mesh.clone();
        copy.geometry = geometry.clone();
        copy.material = (mesh.material as THREE.MeshBasicMaterial).clone();
        copy.position.x += dx;
        r.units.add(copy);
      }
    }
  }, [
    props.state,
    props.selected,
    props.units,
    props.nation,
    props.air,
    props.sea,
  ]);
  return (
    <div className="map-view" ref={host}>
      {box && (
        <div
          className="selection-box"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      )}
      <div className="map-hint">
        DRAG SELECT · RIGHT CLICK MOVE · MIDDLE DRAG PAN · SCROLL ZOOM ·
        HORIZONTAL WRAP
      </div>
    </div>
  );
}
function pointInPolygon(p: THREE.Vector2, poly: THREE.Vector2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
