import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { toolbar, saveImage } from "./rendering.js";
const vec = (a) => new THREE.Vector3(...a);
const fmt = (n) => Number(n.toPrecision(4)).toString();
function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) for (const m of [].concat(o.material)) m.dispose();
  });
  group.clear();
}
function ramp(v, lo, hi, stops) {
  const f = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
  let i = 1;
  while (i < stops.length - 1 && stops[i][0] < f) i++;
  const a = stops[i - 1],
    b = stops[i];
  const left = new THREE.Color(a[1]).getRGB({}, THREE.SRGBColorSpace);
  const right = new THREE.Color(b[1]).getRGB({}, THREE.SRGBColorSpace);
  const t = (f - a[0]) / (b[0] - a[0]);
  return new THREE.Color().setRGB(
    left.r + (right.r - left.r) * t,
    left.g + (right.g - left.g) * t,
    left.b + (right.b - left.b) * t,
    THREE.SRGBColorSpace,
  );
}
export class Viewer3D {
  constructor(host) {
    this.host = host;
    host.classList.add("research-view", "spatial-view");
    this.scene = new THREE.Scene();
    const dotCanvas = document.createElement("canvas");
    dotCanvas.width = dotCanvas.height = 32;
    const dc = dotCanvas.getContext("2d");
    dc.fillStyle = "white";
    dc.beginPath();
    dc.arc(16, 16, 15, 0, Math.PI * 2);
    dc.fill();
    this.dotTexture = new THREE.CanvasTexture(dotCanvas);
    const ringCanvas = document.createElement("canvas");
    ringCanvas.width = ringCanvas.height = 32;
    const rc = ringCanvas.getContext("2d");
    rc.strokeStyle = "white";
    rc.lineWidth = 6;
    rc.beginPath();
    rc.arc(16, 16, 12, 0, Math.PI * 2);
    rc.stroke();
    this.ringTexture = new THREE.CanvasTexture(ringCanvas);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.001, 10000);
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0xf5f8f9, 0);
    this.renderer.domElement.className = "spatial-canvas";
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D view. Drag to orbit, right-drag to pan, scroll to zoom.",
    );
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.rotateSpeed = 0.72;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.82;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener("change", () => {
      this.draw();
      this.onCameraChange?.(this);
    });
    this.content = new THREE.Group();
    this.grid = new THREE.Group();
    this.scene.add(this.content, this.grid);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x7d959e, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(1, -2, 4);
    this.scene.add(key);
    this.labels = [];
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "view-labels";
    host.append(this.labelLayer);
    this.legend = document.createElement("div");
    this.legend.className = "view-legend";
    host.append(this.legend);
    this.tip = document.createElement("div");
    this.tip.className = "view-tooltip";
    this.tip.hidden = true;
    host.append(this.tip);
    this.axes = document.createElement("div");
    this.axes.className = "view-orientation";
    this.axes.textContent = "Z up \u00b7 enclosure coordinates";
    host.append(this.axes);
    toolbar(
      host,
      () => this.focus(null),
      () => this.export(),
    );
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.renderer.domElement.ondblclick = () => this.focus(null);
    let start;
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      start = [e.clientX, e.clientY];
    });
    this.renderer.domElement.addEventListener("pointerup", (e) => {
      if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) < 4) {
        const hit = this.pick(e);
        if (hit)
          this.onPick?.({
            points: [
              {
                x: hit.p.x,
                y: hit.p.y,
                z: hit.p.z,
                pointIndex: hit.index,
                name: hit.name,
              },
            ],
          });
      }
      start = null;
    });
    this.renderer.domElement.addEventListener("pointermove", (e) => {
      if (e.buttons) {
        this.tip.hidden = true;
        return;
      }
      const hit = this.pick(e);
      this.tip.hidden = !hit;
      if (hit) {
        this.tip.textContent = `${hit.name}\nX ${fmt(hit.p.x)}   Y ${fmt(hit.p.y)}   Z ${fmt(hit.p.z)} ${this.units}${hit.value === undefined ? "" : `\nValue ${fmt(hit.value)}`}`;
        const rect = host.getBoundingClientRect();
        this.tip.style.left = `${Math.min(Math.max(8, e.clientX - rect.left + 12), Math.max(8, rect.width - 235))}px`;
        this.tip.style.top = `${Math.max(8, Math.min(e.clientY - rect.top + 12, rect.height - 80))}px`;
      }
    });
    this.renderer.domElement.addEventListener("pointerleave", () => {
      this.tip.hidden = true;
    });
    this.renderer.domElement.addEventListener("keydown", (e) => {
      if (
        [
          "+",
          "=",
          "-",
          "0",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
        ].includes(e.key)
      ) {
        e.preventDefault();
        if (e.key === "0") this.focus(null);
        else if (["+", "=", "-"].includes(e.key)) {
          this.camera.position
            .sub(this.controls.target)
            .multiplyScalar(e.key === "-" ? 1.2 : 1 / 1.2)
            .add(this.controls.target);
          this.controls.update();
          this.draw();
        } else {
          const delta = this.camera.position.clone().sub(this.controls.target);
          delta.applyAxisAngle(
            e.key.includes("Left") || e.key.includes("Right")
              ? vec([0, 0, 1])
              : vec([1, 0, 0]),
            e.key.includes("Left") || e.key.includes("Up") ? 0.12 : -0.12,
          );
          this.camera.position.copy(this.controls.target).add(delta);
          this.controls.update();
          this.draw();
        }
      }
    });
  }
  label(p, text, color = "#586d79") {
    if (!text) return;
    const el = document.createElement("span");
    el.textContent = text;
    el.style.color = color;
    this.labelLayer.append(el);
    this.labels.push({ p: p.clone(), el, color });
  }
  update(data, layout) {
    disposeGroup(this.content);
    disposeGroup(this.grid);
    this.labels = [];
    this.labelLayer.replaceChildren();
    this.legend.replaceChildren();
    this.showTraceLegend = layout.showlegend !== false;
    this.units =
      layout.scene?.xaxis?.title?.text?.match(/\((.*?)\)/)?.[1] || "m";
    this.axes.textContent = `Z up \u00b7 ${this.units === "unit" ? "unit directions" : `coordinates in ${this.units}`}`;
    const box = new THREE.Box3();
    for (const d of data) {
      if (d.type === "surface")
        d.x.forEach((row, i) =>
          row.forEach((x, j) => {
            if ([x, d.y[i][j], d.z[i][j]].every(Number.isFinite))
              box.expandByPoint(vec([x, d.y[i][j], d.z[i][j]]));
          }),
        );
      else
        d.x?.forEach((x, i) => {
          if ([x, d.y[i], d.z[i]].every(Number.isFinite))
            box.expandByPoint(vec([x, d.y[i], d.z[i]]));
        });
    }
    if (box.isEmpty()) {
      box.min.set(-1, -1, -1);
      box.max.set(1, 1, 1);
    }
    this.box = box;
    this.center = box.getCenter(new THREE.Vector3());
    this.span = Math.max(...box.getSize(new THREE.Vector3()).toArray(), 0.001);
    this.pickables = [];
    for (const d of data) this.addTrace(d);
    this.addGrid();
    this.resize();
    if (!this.initialized) {
      this.initialized = true;
      this.focus(null);
    }
    this.resize();
    this.draw();
    this.host.dataset.points = String(
      data.reduce((n, d) => n + (d.type === "scatter3d" ? d.x.length : 0), 0),
    );
  }
  addTrace(d) {
    if (d.type === "cone") {
      const dir = vec([d.u[0], d.v[0], d.w[0]]).normalize();
      const size = d.sizeref || this.span * 0.025;
      const o = new THREE.Mesh(
        new THREE.ConeGeometry(size * 0.4, size, 12),
        new THREE.MeshBasicMaterial({ color: d.colorscale[0][1] }),
      );
      o.quaternion.setFromUnitVectors(vec([0, 1, 0]), dir);
      o.position
        .copy(vec([d.x[0], d.y[0], d.z[0]]))
        .addScaledVector(dir, -size / 2);
      this.content.add(o);
      return;
    }
    if (d.type === "surface" || d.type === "mesh3d") {
      let positions = [],
        indices = [];
      if (d.type === "surface") {
        const cols = d.x[0].length;
        d.x.forEach((row, i) =>
          row.forEach((x, j) => positions.push(x, d.y[i][j], d.z[i][j])),
        );
        for (let i = 0; i < d.x.length - 1; i++)
          for (let j = 0; j < cols - 1; j++) {
            const a = i * cols + j,
              b = a + cols;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
          }
      } else {
        d.x.forEach((x, i) => positions.push(x, d.y[i], d.z[i]));
        d.i.forEach((a, i) => indices.push(a, d.j[i], d.k[i]));
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: d.color || d.colorscale?.[0][1] || "#98b9c0",
          transparent: true,
          opacity: d.opacity || 0.16,
          roughness: 0.2,
          metalness: 0.1,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      mesh.userData = { name: d.name, trace: d };
      this.content.add(mesh);
      if (d.hoverinfo !== "skip") this.pickables.push(mesh);
      // A fine rim makes the enclosure silhouette readable without a chart box.
      if (d.type === "surface" && d.name === "Dome") {
        const i = d.x.length - 1,
          pts = d.x[i].map((x, j) => vec([x, d.y[i][j], d.z[i][j]]));
        this.content.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({
              color: "#84afb3",
              transparent: true,
              opacity: 0.7,
            }),
          ),
        );
      } else if (d.type === "mesh3d")
        this.content.add(
          new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({
              color: "#88a7b2",
              transparent: true,
              opacity: 0.65,
            }),
          ),
        );
      return;
    }
    const pts = d.x.map((x, i) => vec([x, d.y[i], d.z[i]]));
    if (d.mode?.includes("lines") && pts.length > 1) {
      let geometry = new THREE.BufferGeometry().setFromPoints(pts);
      let material = d.line?.dash
        ? new THREE.LineDashedMaterial({
            color: d.line.color,
            dashSize: this.span * 0.015,
            gapSize: this.span * 0.012,
            transparent: true,
            opacity: 0.75,
          })
        : new THREE.LineBasicMaterial({ color: d.line?.color || "#087f83" });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      this.content.add(line);
      if (!d.line?.dash && d.line?.width >= 4) {
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1],
            b = pts[i],
            len = a.distanceTo(b);
          if (!len) continue;
          const beam = new THREE.Mesh(
            new THREE.CylinderGeometry(
              this.span * 0.0015,
              this.span * 0.0015,
              len,
              8,
            ),
            new THREE.MeshBasicMaterial({ color: d.line.color }),
          );
          beam.position.copy(a).add(b).multiplyScalar(0.5);
          beam.quaternion.setFromUnitVectors(
            vec([0, 1, 0]),
            b.clone().sub(a).normalize(),
          );
          this.content.add(beam);
        }
      }
    }
    if (d.mode?.includes("markers")) {
      const marker = d.marker || {},
        geometry = new THREE.BufferGeometry().setFromPoints(pts);
      let vertexColors = false;
      if (Array.isArray(marker.color)) {
        const colors = marker.color.flatMap((v) =>
          ramp(v, marker.cmin, marker.cmax, marker.colorscale).toArray(),
        );
        geometry.setAttribute(
          "color",
          new THREE.Float32BufferAttribute(colors, 3),
        );
        vertexColors = true;
        this.colorLegend(marker);
      }
      const cloud = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: vertexColors ? "white" : marker.color || "#087f83",
          vertexColors,
          map: marker.style === "ring" ? this.ringTexture : this.dotTexture,
          alphaTest: 0.2,
          size: Math.max(3, (marker.size || 3) * 1.5),
          sizeAttenuation: false,
          transparent: true,
          opacity: marker.opacity || 1,
          depthWrite: false,
          depthTest: marker.overlay !== true,
        }),
      );
      cloud.userData = { name: d.name, trace: d };
      this.content.add(cloud);
      this.pickables.push(cloud);
      if (
        this.showTraceLegend &&
        layoutLegend(d) &&
        this.host.id === "scene3d"
      ) {
        const item = document.createElement("span");
        item.textContent = d.name;
        item.dataset.marker = marker.style || "dot";
        item.style.setProperty(
          "--layer-color",
          vertexColors ? "#087f83" : marker.color,
        );
        this.legend.append(item);
      }
    }
    if (d.text)
      d.text.forEach((text, i) =>
        this.label(pts[i], text, d.line?.color || "#405665"),
      );
  }
  colorLegend(m) {
    const el = document.createElement("div");
    el.className = "color-scale";
    const label = document.createElement("span");
    label.textContent = `${m.colorbar?.title?.text || "Value"} \u00b7 ${fmt(m.cmin)} to ${fmt(m.cmax)}`;
    const rampEl = document.createElement("i");
    rampEl.style.background = `linear-gradient(90deg, ${m.colorscale.map((s) => s[1]).join(",")})`;
    el.append(label, rampEl);
    this.legend.append(el);
  }
  addGrid() {
    const step = 10 ** Math.floor(Math.log10(this.span / 4));
    const spacing = this.span / step > 10 ? step * 2 : step;
    const size = Math.ceil(this.span / spacing) * spacing;
    const floor = this.box.min.z;
    const points = [];
    for (let i = -5; i <= 5; i++) {
      const p = (i * size) / 10;
      points.push(
        vec([this.center.x - size / 2, this.center.y + p, floor]),
        vec([this.center.x + size / 2, this.center.y + p, floor]),
      );
      points.push(
        vec([this.center.x + p, this.center.y - size / 2, floor]),
        vec([this.center.x + p, this.center.y + size / 2, floor]),
      );
    }
    this.grid.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: "#d7e3e7",
          transparent: true,
          opacity: 0.65,
        }),
      ),
    );
    const base = vec([this.box.min.x, this.box.min.y, floor]);
    for (let i = 0; i < 3; i++) {
      const end = base.clone();
      end.setComponent(i, this.box.max.getComponent(i));
      this.grid.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([base, end]),
          new THREE.LineBasicMaterial({ color: "#a7bbc4" }),
        ),
      );
      this.label(end, `${"XYZ"[i]} (${this.units})`);
      for (let j = 1; j < 3; j++) {
        const p = base.clone().lerp(end, j / 3);
        this.label(p, fmt(p.getComponent(i)), "#899aa4");
      }
    }
  }
  pick(e) {
    if (!this.span) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.params.Points.threshold =
      this.camera.position.distanceTo(this.controls.target) * 0.008;
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const hit = ray.intersectObjects(this.pickables, false)[0];
    if (!hit) return null;
    const d = hit.object.userData.trace,
      p = hit.object.isPoints
        ? vec([d.x[hit.index], d.y[hit.index], d.z[hit.index]])
        : hit.point;
    return {
      p,
      index: hit.index,
      name: hit.object.userData.name,
      value: Array.isArray(d.marker?.color)
        ? d.marker.color[hit.index]
        : undefined,
    };
  }
  focus(bounds) {
    const center = bounds?.center ? vec(bounds.center) : this.center;
    if (!center) return;
    const span = bounds?.span || this.span;
    this.controls.target.copy(center);
    const direction = this.camera.position.clone().sub(center);
    if (!this.hadCamera || direction.length() < 0.001)
      direction.set(1.3, -1.7, 1.2);
    direction.normalize();
    const right = new THREE.Vector3()
      .crossVectors(this.camera.up, direction)
      .normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const frame = bounds
      ? new THREE.Box3(
          center.clone().addScalar(-span / 2),
          center.clone().addScalar(span / 2),
        )
      : this.box;
    let distance = 0;
    for (const x of [frame.min.x, frame.max.x])
      for (const y of [frame.min.y, frame.max.y])
        for (const z of [frame.min.z, frame.max.z]) {
          const p = vec([x, y, z]).sub(center);
          distance = Math.max(
            distance,
            p.dot(direction) + Math.abs(p.dot(up)) / half,
            p.dot(direction) +
              Math.abs(p.dot(right)) / (half * (this.camera.aspect || 1)),
          );
        }
    distance *= 1.15;
    this.camera.position
      .copy(center)
      .addScaledVector(direction.normalize(), distance);
    this.camera.near = Math.max(span * 0.00001, 1e-7);
    this.camera.far = Math.max(this.span * 100, distance * 100);
    this.camera.updateProjectionMatrix();
    this.hadCamera = true;
    this.controls.update();
    this.draw();
  }
  cameraView(direction) {
    const distance = this.camera.position.distanceTo(this.controls.target);
    const d = direction === "top" ? vec([0, -0.0001, 1]) : vec([0, -1, 0.0001]);
    this.camera.position
      .copy(this.controls.target)
      .addScaledVector(d, distance);
    this.controls.update();
    this.draw();
  }
  syncCamera(source) {
    this.camera.position.copy(source.camera.position);
    this.camera.quaternion.copy(source.camera.quaternion);
    this.camera.up.copy(source.camera.up);
    this.controls.target.copy(source.controls.target);
    this.camera.near = source.camera.near;
    this.camera.far = source.camera.far;
    this.camera.updateProjectionMatrix();
    this.draw();
  }
  draw() {
    if (!this.host.clientWidth || !this.host.clientHeight) return;
    this.renderer.render(this.scene, this.camera);
    this.host.dataset.camera = JSON.stringify(this.camera.position.toArray());
    this.host.dataset.target = JSON.stringify(this.controls.target.toArray());
    for (const label of this.labels) {
      const p = label.p.clone().project(this.camera);
      label.el.hidden =
        p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1;
      label.x = ((p.x + 1) * this.host.clientWidth) / 2;
      label.y = ((1 - p.y) * this.host.clientHeight) / 2;
      label.el.style.transform = `translate(${label.x}px, ${label.y}px) translate(-50%, -110%)`;
    }
  }
  resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.draw();
  }
  export() {
    this.draw();
    const canvas = document.createElement("canvas"),
      w = this.host.clientWidth,
      h = this.host.clientHeight;
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    ctx.fillStyle = "#f5f8f9";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.renderer.domElement, 0, 0, w, h);
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    for (const l of this.labels)
      if (!l.el.hidden) {
        ctx.fillStyle = l.color;
        ctx.fillText(l.el.textContent, l.x, l.y - 5);
      }
    ctx.textAlign = "left";
    ctx.fillStyle = "#405665";
    ctx.fillText(this.axes.textContent, 12, h - 12);
    for (const el of this.legend.children) {
      const r = el.getBoundingClientRect(),
        base = this.host.getBoundingClientRect();
      ctx.fillText(el.textContent, r.left - base.left, r.top - base.top + 12);
      if (el.classList.contains("color-scale")) {
        const gradient = ctx.createLinearGradient(
          r.left - base.left,
          0,
          r.right - base.left,
          0,
        );
        ["#0f737b", "#51b9b0", "#ebd574", "#e99b4c", "#ce554b"].forEach(
          (c, i) => gradient.addColorStop(i / 4, c),
        );
        ctx.fillStyle = gradient;
        ctx.fillRect(r.left - base.left, r.top - base.top + 18, r.width, 6);
        ctx.fillStyle = "#405665";
      }
    }
    saveImage(canvas.toDataURL("image/png"), `${this.host.id}.png`);
  }
  dispose() {
    this.observer.disconnect();
    this.controls.dispose();
    disposeGroup(this.content);
    disposeGroup(this.grid);
    this.dotTexture.dispose();
    this.ringTexture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.host.replaceChildren();
  }
}
function layoutLegend(d) {
  return d.name && d.x?.length > 1;
}
