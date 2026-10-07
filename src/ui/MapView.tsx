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
  insetLeft?: number;
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
    routes: THREE.Group;
    resize: () => void;
  } | null>(null);
  useEffect(() => {
    const el = host.current!;
    const world = props.world;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#283d43");
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
    const paper = document.createElement("canvas");
    paper.width = paper.height = 96;
    const paperContext = paper.getContext("2d")!;
    const grain = paperContext.createImageData(96, 96);
    for (let i = 0; i < 96 * 96; i++) {
      const value = 226 + ((i * 73 + (i % 96) * 19) % 29);
      grain.data.set([value, value, value, 255], i * 4);
    }
    paperContext.putImageData(grain, 0, 0);
    const texture = new THREE.CanvasTexture(paper);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.035, 0.035);
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
      const mat = new THREE.MeshBasicMaterial({
        color: "#516773",
        map: texture,
      });
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
            color: "#263129",
            transparent: true,
            opacity: 0.35,
          }),
        );
        scene.add(line);
      }
    }
    const units = new THREE.Group(),
      labels = new THREE.Group(),
      routes = new THREE.Group();
    scene.add(units, labels, routes);
    for (const n of world.nations) {
      const ps = world.provinces.filter((p) => p.owner === n.id);
      if (!ps.length) continue;
      const x = ps.reduce((a, p) => a + p.center[0], 0) / ps.length,
        y = ps.reduce((a, p) => a + p.center[1], 0) / ps.length;
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.font = "600 25px Georgia";
      ctx.textAlign = "center";
      ctx.fillStyle = "#eee5c8";
      ctx.shadowColor = "#18241b";
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
    const rt = {
      scene,
      renderer,
      camera,
      meshes,
      units,
      labels,
      routes,
      resize: () => {},
    };
    runtime.current = rt;
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      const inset =
        w > 650 ? Math.min(current.current.insetLeft || 0, w * 0.4) : 0;
      const usableW = w - inset;
      const vw = Math.max(
        world.width + 24,
        ((world.height + 24) * usableW) / h,
      );
      const fullW = (vw * w) / usableW;
      camera.left = world.width / 2 - vw / 2 - (fullW - vw);
      camera.right = world.width / 2 + vw / 2;
      camera.top = world.height / 2 + (fullW * h) / w / 2;
      camera.bottom = world.height / 2 - (fullW * h) / w / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    rt.resize = resize;
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
    const pick = (x: number, y: number, provincesOnly = false) => {
      const r = el.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((x - r.left) / r.width) * 2 - 1,
          (-(y - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      return raycaster
        .intersectObjects(
          provincesOnly ? meshes : [...units.children, ...meshes],
          false,
        )
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
        const hit = pick(e.clientX, e.clientY, true);
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
            ids.push(...(unit.userData.unitIds || []));
        }
        p.onUnits([...new Set(e.shiftKey ? [...p.units, ...ids] : ids)]);
      } else {
        const hit = pick(e.clientX, e.clientY);
        if (hit?.userData.unit !== undefined && hit.userData.owner === p.nation)
          p.onUnits(
            e.shiftKey
              ? [...new Set([...p.units, ...hit.userData.unitIds])]
              : hit.userData.unitIds,
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
      texture.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      runtime.current = null;
    };
  }, [props.world]);
  useEffect(() => {
    runtime.current?.resize();
  }, [props.insetLeft]);
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
          ? "#395762"
          : p.kind === "impassable-sea"
            ? "#24383e"
            : p.kind === "impassable-land"
              ? "#4c5445"
              : owner === null
                ? "#8d9276"
                : world.nations[owner].color;
      if (air && !p.kind.startsWith("impassable"))
        color = world.airZones[p.airZone].color;
      if (props.sea && p.seaZone !== null)
        color = world.seaZones[p.seaZone].color;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(color);
      if (p.kind === "land" && !air && !props.sea)
        mat.color.lerp(new THREE.Color("#a0a084"), 0.22);
      if (id === selected) mat.color.lerp(new THREE.Color("#fff4ba"), 0.55);
      else if (nation !== null && owner !== nation && p.kind === "land")
        mat.color.multiplyScalar(0.86);
    }
    while (r.units.children.length) {
      const u = r.units.children[0] as THREE.Mesh;
      r.units.remove(u);
      u.geometry.dispose();
      (u.material as THREE.MeshBasicMaterial).map?.dispose();
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
    const groups = new Map<string, NonNullable<typeof state>["units"]>();
    for (const unit of state?.units || []) {
      const key = `${unit.province}:${unit.owner}:${unit.kind}`;
      groups.set(key, [...(groups.get(key) || []), unit]);
    }
    const offsets = new Map<number, number>();
    for (const group of groups.values()) {
      const u = group[0],
        p = world.provinces[u.province];
      const offset = offsets.get(p.id) || 0;
      offsets.set(p.id, offset + 1);
      const chosen = group.some((u) => props.units.includes(u.id));
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 100;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = chosen
        ? "#e9d59a"
        : u.owner === nation
          ? "#c7ccab"
          : "#b8b5a2";
      ctx.fillRect(2, 2, 156, 96);
      ctx.strokeStyle = chosen ? "#fff6c3" : "#202b25";
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 154, 94);
      ctx.fillStyle = world.nations[u.owner].color;
      ctx.fillRect(9, 9, 18, 63);
      ctx.strokeStyle = "#28352b";
      ctx.lineWidth = 4;
      ctx.strokeRect(40, 17, 57, 42);
      ctx.beginPath();
      if (u.kind === "fleet") {
        ctx.moveTo(48, 41);
        ctx.lineTo(88, 41);
        ctx.lineTo(77, 52);
        ctx.lineTo(58, 52);
        ctx.closePath();
        ctx.moveTo(69, 22);
        ctx.lineTo(69, 41);
      } else if (u.battalions.includes("armored")) {
        ctx.ellipse(68, 38, 21, 12, 0, 0, Math.PI * 2);
      } else {
        ctx.moveTo(40, 17);
        ctx.lineTo(97, 59);
        ctx.moveTo(97, 17);
        ctx.lineTo(40, 59);
      }
      ctx.stroke();
      ctx.fillStyle = "#263329";
      ctx.font = "bold 30px Arial";
      ctx.textAlign = "center";
      ctx.fillText(String(group.length), 124, 49);
      const org =
        group.reduce((s, u) => s + u.org / u.maxOrg, 0) / group.length;
      const strength =
        group.reduce((s, u) => s + u.strength, 0) / group.length / 100;
      ctx.fillStyle = "#57614f";
      ctx.fillRect(35, 70, 115, 8);
      ctx.fillRect(35, 82, 115, 6);
      ctx.fillStyle = "#6f9e5b";
      ctx.fillRect(35, 70, 115 * Math.max(0, Math.min(1, org)), 8);
      ctx.fillStyle = "#c09648";
      ctx.fillRect(35, 82, 115 * Math.max(0, Math.min(1, strength)), 6);
      for (const dx of [-world.width, 0, world.width]) {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(11.5, 7.2),
          new THREE.MeshBasicMaterial({
            map: new THREE.CanvasTexture(canvas),
            transparent: true,
            depthTest: false,
          }),
        );
        mesh.position.set(
          p.center[0] + dx + offset * 6,
          world.height - p.center[1] - offset * 4,
          5,
        );
        mesh.userData = {
          unit: u.id,
          unitIds: group.map((u) => u.id),
          owner: u.owner,
          province: p.id,
        };
        r.units.add(mesh);
      }
    }
    while (r.routes.children.length) {
      const line = r.routes.children[0] as THREE.Line;
      r.routes.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    for (const unit of state?.units || []) {
      if (!props.units.includes(unit.id) || !unit.route?.length) continue;
      const points: THREE.Vector3[] = [];
      let last = world.provinces[unit.province].center[0];
      for (const id of [unit.province, ...unit.route]) {
        const p = world.provinces[id];
        let x = p.center[0];
        while (x - last > world.width / 2) x -= world.width;
        while (x - last < -world.width / 2) x += world.width;
        points.push(new THREE.Vector3(x, world.height - p.center[1], 4));
        last = x;
      }
      for (const dx of [-world.width, 0, world.width]) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineDashedMaterial({
            color: "#f2de86",
            dashSize: 2,
            gapSize: 1,
            depthTest: false,
          }),
        );
        line.computeLineDistances();
        line.position.x = dx;
        r.routes.add(line);
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
