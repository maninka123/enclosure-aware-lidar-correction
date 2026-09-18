import {
  add,
  sub,
  mul,
  mv,
  rotation,
  trace,
  beamDirection,
  planeDirection,
  norm,
  angle,
} from "./physics.js";
const P = () => window.Plotly;
export const colors = {
  teal: "#087f83",
  amber: "#d89c27",
  coral: "#dc7358",
  blue: "#466bb0",
  gray: "#9aaab0",
};
const colorscale = [
  [0, "#0f737b"],
  [0.3, "#51b9b0"],
  [0.6, "#ebd574"],
  [0.8, "#e99b4c"],
  [1, "#ce554b"],
];
const common = {
  paper_bgcolor: "#fff",
  plot_bgcolor: "#fff",
  font: { family: "Segoe UI, Arial, sans-serif", size: 11, color: "#405b67" },
  margin: { l: 64, r: 26, t: 20, b: 55 },
  hoverlabel: { bgcolor: "#102d39", font: { color: "#fff" } },
  uirevision: "keep-view",
};
const options = {
  responsive: true,
  scrollZoom: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["select2d", "lasso2d"],
  toImageButtonOptions: { format: "png", scale: 2, filename: "enclosure-lab" },
};
export function plot(id, data, layout = {}) {
  return P().react(id, data, { ...common, ...layout }, options);
}
export function line3(points, name, color, width = 4, dash) {
  return {
    type: "scatter3d",
    mode: "lines",
    x: points.map((p) => p[0]),
    y: points.map((p) => p[1]),
    z: points.map((p) => p[2]),
    name,
    line: { color, width, dash },
    hoverinfo: "name",
  };
}
export function points3(points, name, color = colors.teal, size = 2, bar) {
  return {
    type: "scatter3d",
    mode: "markers",
    name,
    x: points.map((p) => p[0]),
    y: points.map((p) => p[1]),
    z: points.map((p) => p[2]),
    marker: {
      size,
      color,
      opacity: 0.85,
      ...(Array.isArray(color)
        ? {
            colorscale,
            cmin: 0,
            cmax: color.reduce((m, v) => Math.max(m, v), 0.001),
            colorbar: {
              title: { text: bar || "mm" },
              thickness: 10,
              len: 0.7,
              tickformat: ".3g",
            },
            showscale: true,
          }
        : {}),
    },
    hovertemplate: `${name}<br>X %{x:.4f}<br>Y %{y:.4f}<br>Z %{z:.4f}${Array.isArray(color) ? "<br>Value %{marker.color:.6g}" : ""}<extra></extra>`,
  };
}
export function sceneLayout(unit = "m") {
  return {
    xaxis: {
      title: { text: `X (${unit})` },
      gridcolor: "#e4ecef",
      zerolinecolor: "#a4b8c1",
    },
    yaxis: {
      title: { text: `Y (${unit})` },
      gridcolor: "#e4ecef",
      zerolinecolor: "#a4b8c1",
    },
    zaxis: {
      title: { text: `Z (${unit})` },
      gridcolor: "#e4ecef",
      zerolinecolor: "#a4b8c1",
    },
    aspectmode: "data",
    camera: { eye: { x: 1.5, y: -1.7, z: 1.25 }, up: { x: 0, y: 0, z: 1 } },
  };
}
function shellSurface(c, r, opacity, color) {
  const x = [],
    y = [],
    z = [];
  for (let i = 0; i <= 20; i++) {
    const t = (i / 20) * (c.upperOnly ? Math.PI / 2 : Math.PI);
    x.push([]);
    y.push([]);
    z.push([]);
    for (let j = 0; j <= 40; j++) {
      const a = (j / 40) * 2 * Math.PI;
      x[i].push((c.center[0] + r * Math.sin(t) * Math.cos(a)) * 1000);
      y[i].push((c.center[1] + r * Math.sin(t) * Math.sin(a)) * 1000);
      z[i].push((c.center[2] + r * Math.cos(t)) * 1000);
    }
  }
  return {
    type: "surface",
    x,
    y,
    z,
    opacity,
    colorscale: [
      [0, color],
      [1, color],
    ],
    showscale: false,
    hoverinfo: "skip",
    name: "Dome",
    contours: { x: { show: false }, y: { show: false }, z: { show: false } },
  };
}
export function raySegments(c, t, length) {
  const list = [];
  if (t.inner)
    list.push({ p: [c.origin, t.inner], name: "Incident", color: colors.teal });
  if (t.outer)
    list.push({ p: [t.inner, t.outer], name: "Wall", color: colors.amber });
  if (t.valid)
    list.push({
      p: [t.outer, add(t.outer, mul(t.exit, length))],
      name: "Exit",
      color: colors.coral,
    });
  if (t.incident)
    list.push({
      p: [c.origin, add(c.origin, mul(t.incident, c.radius + length))],
      name: "Unrefracted",
      color: colors.gray,
      dash: "dash",
    });
  for (const [point, normal, name] of [
    [t.inner, t.innerNormal, "Inner normal"],
    [t.outer, t.outerNormal, "Outer normal"],
  ])
    if (point && normal)
      list.push({
        p: [
          sub(point, mul(normal, c.radius * 0.18)),
          add(point, mul(normal, c.radius * 0.18)),
        ],
        name,
        color: "#798892",
        dash: "dot",
      });
  return list;
}
export function geometry(id, c, t, length, withFan = true) {
  const data = [
    shellSurface(c, c.radius, 0.09, "#80b9b8"),
    shellSurface(c, c.radius + c.thickness, 0.14, "#80b9b8"),
  ];
  const origin = mul(c.origin, 1000),
    extent = c.radius * 1000 * 0.6;
  data.push({
    ...points3([origin], "LiDAR source", "#123d50", 7),
    mode: "markers+text",
    text: ["LiDAR"],
    textposition: "top center",
  });
  const axisColors = ["#d66b60", "#62a782", "#4c83b3"];
  for (let i = 0; i < 3; i++) {
    const d = [0, 0, 0];
    d[i] = 1;
    const end = add(origin, mul(mv(c.rotation, d), extent));
    data.push({
      ...line3(
        [origin, end],
        `Sensor ${"XYZ"[i]}${i === 2 ? " (forward)" : ""}`,
        axisColors[i],
        5,
      ),
      mode: "lines+text",
      text: ["", i === 2 ? "+Z / forward" : `+${"XY"[i]}`],
      textposition: "top center",
    });
    data.push({
      type: "cone",
      x: [end[0]],
      y: [end[1]],
      z: [end[2]],
      u: [end[0] - origin[0]],
      v: [end[1] - origin[1]],
      w: [end[2] - origin[2]],
      sizemode: "absolute",
      sizeref: extent * 0.14,
      anchor: "tip",
      colorscale: [
        [0, axisColors[i]],
        [1, axisColors[i]],
      ],
      showscale: false,
      hoverinfo: "skip",
      showlegend: false,
    });
  }
  if (withFan)
    for (let a = 0; a < 360; a += 45) {
      const d = mv(c.rotation, beamDirection(a, 30)),
        r = trace(d, c);
      if (r.valid)
        data.push({
          ...line3(
            [
              c.origin,
              r.inner,
              r.outer,
              add(r.outer, mul(r.exit, length * 0.4)),
            ].map((p) => mul(p, 1000)),
            "Sample field",
            "#b7cdd0",
            1,
          ),
          showlegend: false,
        });
    }
  for (const s of raySegments(c, t, length))
    data.push(
      line3(
        s.p.map((p) => mul(p, 1000)),
        s.name,
        s.color,
        5,
        s.dash,
      ),
    );
  if (t.inner)
    data.push(points3([mul(t.inner, 1000)], "Inner hit", colors.amber, 4));
  if (t.outer)
    data.push(points3([mul(t.outer, 1000)], "Outer hit", colors.coral, 4));
  return plot(id, data, {
    scene: sceneLayout("mm"),
    margin: { l: 5, r: 5, t: 8, b: 8 },
    showlegend: false,
  });
}
const axes = (plane) =>
  plane === "XZ" ? [0, 2] : plane === "YZ" ? [1, 2] : [0, 1];
export function beam2d(id, c, t, length, plane) {
  const [a, b] = axes(plane),
    data = [];
  for (const r of [c.radius, c.radius + c.thickness]) {
    const points = Array.from({ length: 241 }, (_, i) => {
      const theta =
        (i / 240) * (c.upperOnly && plane !== "XY" ? Math.PI : 2 * Math.PI);
      return [
        1000 * (c.center[a] + r * Math.cos(theta)),
        1000 * (c.center[b] + r * Math.sin(theta)),
      ];
    });
    data.push({
      x: points.map((p) => p[0]),
      y: points.map((p) => p[1]),
      mode: "lines",
      line: { color: "#abc6c9", width: 1.5 },
      hoverinfo: "skip",
      showlegend: false,
    });
  }
  for (const s of raySegments(c, t, length))
    data.push({
      type: "scatter",
      mode: "lines+markers",
      name: s.name,
      x: s.p.map((p) => p[a] * 1000),
      y: s.p.map((p) => p[b] * 1000),
      line: { color: s.color, width: 2.5, dash: s.dash },
      marker: { size: s.dash ? 0 : 4 },
      hovertemplate: `${s.name}<br>%{x:.4f}, %{y:.4f} mm<extra></extra>`,
    });
  return plot(id, data, {
    xaxis: {
      title: { text: `${plane[0]} (mm)` },
      gridcolor: "#e5ecef",
      zeroline: false,
    },
    yaxis: {
      title: { text: `${plane[1]} (mm)` },
      scaleanchor: "x",
      scaleratio: 1,
      gridcolor: "#e5ecef",
      zeroline: false,
    },
    showlegend: false,
  });
}
export function sweep(c, plane, range, frame) {
  return Array.from({ length: range + 1 }, (_, deg) => {
    let d = planeDirection(deg, plane);
    if (frame === "sensor") d = mv(c.rotation, d);
    const t = trace(d, c);
    return {
      angle: deg,
      value: t.valid ? t.deflection : null,
      status: t.status,
    };
  });
}
export function curves(id, rows, comparison, plane) {
  const data = [
    {
      x: rows.map((r) => r.angle),
      y: rows.map((r) => r.value),
      type: "scatter",
      mode: "lines",
      name: "Current",
      line: { color: colors.blue, width: 2.5 },
      connectgaps: false,
      hovertemplate:
        "%{x:.1f}° input<br>%{y:.5f}° total deviation<extra></extra>",
    },
  ];
  if (comparison)
    data.push({
      x: comparison.map((r) => r.angle),
      y: comparison.map((r) => r.value),
      mode: "lines",
      name: "Pinned",
      line: { color: colors.coral, width: 2, dash: "dot" },
      connectgaps: false,
    });
  return plot(id, data, {
    xaxis: {
      title: { text: `Beam angle in ${plane} (deg)` },
      range: [0, rows.at(-1).angle],
      gridcolor: "#e7edf0",
      dtick: rows.length > 200 ? 60 : 30,
      minor: { showgrid: true, gridcolor: "#f3f5f6" },
    },
    yaxis: {
      title: { text: "Total angular deviation (deg)" },
      rangemode: "tozero",
      gridcolor: "#e7edf0",
      minor: { showgrid: true, gridcolor: "#f3f5f6" },
    },
    shapes: [
      {
        type: "rect",
        xref: "x",
        yref: "paper",
        x0: 50,
        x1: 130,
        y0: 0,
        y1: 1,
        fillcolor: "#e9ce75",
        opacity: 0.2,
        line: { width: 0 },
        layer: "below",
      },
    ],
    legend: { orientation: "h", x: 0, y: 1.16 },
    showlegend: !!comparison,
  });
}
export function atlas(c) {
  const rows = [],
    z = [],
    points = [],
    values = [];
  const az = Array.from({ length: 73 }, (_, i) => i * 5),
    polar = Array.from({ length: 37 }, (_, i) => i * 5);
  polar.forEach((p, i) => {
    z.push([]);
    az.forEach((a) => {
      const d = mv(c.rotation, beamDirection(a, p)),
        t = trace(d, c);
      rows.push([a, p, t.valid ? t.deflection : null, t.status]);
      z[i].push(t.valid ? t.deflection : null);
      if (t.valid) {
        points.push(d);
        values.push(t.deflection);
      }
    });
  });
  return { rows, z, points, values, az, polar };
}
export function drawAtlas(data) {
  plot(
    "atlas3d",
    [points3(data.points, "Direction", data.values, 3, "Deviation (°)")],
    {
      scene: sceneLayout("unit"),
      showlegend: false,
      margin: { l: 0, r: 0, t: 5, b: 0 },
    },
  );
  return plot(
    "heatmap",
    [
      {
        type: "heatmap",
        x: data.az,
        y: data.polar,
        z: data.z,
        colorscale,
        hoverongaps: false,
        colorbar: { title: { text: "°" }, thickness: 10 },
        hovertemplate:
          "Azimuth %{x}°<br>Polar %{y}°<br>Deviation %{z:.5f}°<extra></extra>",
      },
    ],
    {
      xaxis: { title: { text: "Sensor azimuth (deg)" } },
      yaxis: {
        title: { text: "Sensor polar angle (deg)" },
        autorange: "reversed",
      },
    },
  );
}
export function histogram(id, values, title = "Displacement (mm)") {
  return plot(
    id,
    [
      {
        x: values,
        type: "histogram",
        nbinsx: 40,
        marker: { color: colors.teal },
      },
    ],
    {
      xaxis: { title: { text: title } },
      yaxis: { title: { text: "Preview point count" } },
    },
  );
}
export function objectMesh(obj) {
  const q = rotation(...obj.rpy),
    transform = (p) => add(obj.position, mv(q, p));
  if (obj.type === "sphere") {
    const x = [],
      y = [],
      z = [];
    for (let i = 0; i <= 18; i++) {
      x.push([]);
      y.push([]);
      z.push([]);
      for (let j = 0; j <= 28; j++) {
        const t = (i * Math.PI) / 18,
          a = (j * 2 * Math.PI) / 28,
          p = transform([
            obj.size[0] * Math.sin(t) * Math.cos(a),
            obj.size[0] * Math.sin(t) * Math.sin(a),
            obj.size[0] * Math.cos(t),
          ]);
        x[i].push(p[0]);
        y[i].push(p[1]);
        z[i].push(p[2]);
      }
    }
    return {
      type: "surface",
      x,
      y,
      z,
      opacity: 0.18,
      colorscale: [
        [0, "#9bb5bb"],
        [1, "#9bb5bb"],
      ],
      showscale: false,
      name: obj.name,
      hovertemplate: "Scene surface<extra></extra>",
    };
  }
  const [w, h, d] = obj.size.map((v) => v / 2),
    points = (
      obj.type === "plane"
        ? [
            [-w, -h, 0],
            [w, -h, 0],
            [w, h, 0],
            [-w, h, 0],
          ]
        : [
            [-w, -h, -d],
            [w, -h, -d],
            [w, h, -d],
            [-w, h, -d],
            [-w, -h, d],
            [w, -h, d],
            [w, h, d],
            [-w, h, d],
          ]
    ).map(transform);
  const faces =
    obj.type === "plane"
      ? [
          [0, 1, 2],
          [0, 2, 3],
        ]
      : [
          [0, 1, 2],
          [0, 2, 3],
          [4, 5, 6],
          [4, 6, 7],
          [0, 1, 5],
          [0, 5, 4],
          [1, 2, 6],
          [1, 6, 5],
          [2, 3, 7],
          [2, 7, 6],
          [3, 0, 4],
          [3, 4, 7],
        ];
  return {
    type: "mesh3d",
    x: points.map((p) => p[0]),
    y: points.map((p) => p[1]),
    z: points.map((p) => p[2]),
    i: faces.map((f) => f[0]),
    j: faces.map((f) => f[1]),
    k: faces.map((f) => f[2]),
    color: "#9bb5bb",
    opacity: 0.18,
    name: obj.name,
    hovertemplate: "Scene surface<extra></extra>",
  };
}
export function focusPlot(id, hit, c, t, plane) {
  const p = t[hit];
  if (hit !== "all" && !p) return;
  if (id === "beam3d") {
    const range = hit === "all" ? null : c.thickness * 1000 * 4;
    const updates = {};
    ["x", "y", "z"].forEach((key, i) => {
      updates[`scene.${key}axis.autorange`] = !range;
      if (range)
        updates[`scene.${key}axis.range`] = [
          p[i] * 1000 - range,
          p[i] * 1000 + range,
        ];
    });
    updates["scene.camera"] = {
      eye: { x: 1.5, y: -1.5, z: 1.2 },
      up: { x: 0, y: 0, z: 1 },
    };
    P().relayout(id, updates);
  } else {
    const [a, b] = axes(plane),
      width = Math.max(c.thickness * 1000 * 4, 0.1);
    P().relayout(
      id,
      hit === "all"
        ? { "xaxis.autorange": true, "yaxis.autorange": true }
        : {
            "xaxis.autorange": false,
            "yaxis.autorange": false,
            "xaxis.range": [p[a] * 1000 - width, p[a] * 1000 + width],
            "yaxis.range": [p[b] * 1000 - width, p[b] * 1000 + width],
          },
    );
  }
}
