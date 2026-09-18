import { Viewer3D } from "./viewer3d.js";
import { Chart2D } from "./chart2d.js";
const views = new Map();
export async function render(id, data, layout) {
  const host = document.getElementById(id);
  const three = !!layout.scene;
  let view = views.get(id);
  if (view && view.three !== three) {
    view.dispose();
    views.delete(id);
    view = null;
  }
  if (!view) {
    view = three ? new Viewer3D(host) : new Chart2D(host);
    view.three = three;
    views.set(id, view);
  }
  view.update(data, layout);
  host.dataset.renderer = three ? "three" : "echarts";
}
export function resize(el) {
  views.get(typeof el === "string" ? el : el.id)?.resize();
}
export function purge(id) {
  views.get(id)?.dispose();
  views.delete(id);
}
export function camera(id, direction) {
  views.get(id)?.cameraView(direction);
}
export function focus(id, bounds) {
  views.get(id)?.focus(bounds);
}
export function onPick(id, handler) {
  const v = views.get(id);
  if (v) v.onPick = handler;
}
export function saveImage(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}
export function toolbar(host, reset, save) {
  const bar = document.createElement("div");
  bar.className = "view-tools";
  for (const [label, action] of [
    ["Reset view", reset],
    ["Save PNG", save],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.onclick = action;
    bar.append(b);
  }
  host.append(bar);
  return bar;
}
