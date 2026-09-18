// Metres, right-handed enclosure coordinates. Matches the Python vector model.
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const mul = (a, s) => a.map((v) => v * s);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const norm = (a) => Math.hypot(...a);
export const unit = (a) => mul(a, 1 / norm(a));
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const angle = (a, b) =>
  (Math.atan2(norm(cross(a, b)), dot(a, b)) * 180) / Math.PI;
export const mv = (m, v) => m.map((row) => dot(row, v));
export const transpose = (m) => m[0].map((_, i) => m.map((row) => row[i]));
export const identity = () => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
export function rotation(roll = 0, pitch = 0, yaw = 0) {
  const [a, b, c] = [roll, pitch, yaw].map((v) => (v * Math.PI) / 180);
  const [ca, sa, cb, sb, cc, sc] = [
    Math.cos(a),
    Math.sin(a),
    Math.cos(b),
    Math.sin(b),
    Math.cos(c),
    Math.sin(c),
  ];
  return [
    [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa],
    [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa],
    [-sb, cb * sa, cb * ca],
  ];
}
export function validate(c) {
  for (const k of ["radius", "thickness", "nInside", "nWall", "nOutside"])
    if (!Number.isFinite(c[k]) || c[k] <= 0)
      throw Error(`${k} must be positive and finite.`);
  if (
    !Number.isFinite(c.radius + c.thickness) ||
    c.radius + c.thickness <= c.radius
  )
    throw Error(
      "The outer radius must be finite and larger than the inner radius.",
    );
  for (const k of ["origin", "center"])
    if (
      !Array.isArray(c[k]) ||
      c[k].length !== 3 ||
      !c[k].every(Number.isFinite)
    )
      throw Error(`${k} must have three finite coordinates.`);
  if (norm(sub(c.origin, c.center)) >= c.radius)
    throw Error(
      "The LiDAR source must be inside the inner dome. Reduce its offset or increase the radius.",
    );
  const q = c.rotation;
  if (
    !q ||
    q.length !== 3 ||
    q.some(
      (r) => !Array.isArray(r) || r.length !== 3 || !r.every(Number.isFinite),
    )
  )
    throw Error("Invalid sensor rotation.");
  if (
    q.some((r, i) =>
      q.some((s, j) => Math.abs(dot(r, s) - (i === j ? 1 : 0)) > 1e-8),
    ) ||
    dot(q[0], cross(q[1], q[2])) < 0.99999999
  )
    throw Error("Sensor rotation must be right-handed and orthonormal.");
  if (typeof c.upperOnly !== "boolean")
    throw Error("upperOnly must be true or false.");
  return c;
}
export const baseline = () => ({
  radius: 0.074,
  thickness: 0.004,
  center: [0, 0, 0],
  origin: [-0.02, 0, 0.02445],
  nInside: 1.000293,
  nWall: 1.52,
  nOutside: 1.000293,
  upperOnly: true,
  rotation: identity(),
});
function sphere(o, d, c, r) {
  const q = sub(o, c),
    p = dot(q, d),
    l = norm(q),
    gap = (r - l) * (r + l),
    disc = p * p + gap;
  if (disc < -1e-14) return null;
  const root = Math.sqrt(Math.max(0, disc)),
    t = p > 0 ? gap / (root + p) : root - p;
  return t > 0 ? { p: add(o, mul(d, t)), t } : null;
}
function refract(d, n, n1, n2) {
  const cos = dot(d, n),
    t = mul(sub(d, mul(n, cos)), n1 / n2),
    s = dot(t, t);
  if (cos <= 0 || s > 1 + 1e-12) return null;
  return add(t, mul(n, Math.sqrt(Math.max(0, 1 - s))));
}
export function trace(direction, c) {
  const result = { valid: false, status: "invalid_direction" };
  if (!direction.every(Number.isFinite) || norm(direction) === 0) return result;
  const d = unit(direction);
  result.incident = d;
  const a = sphere(c.origin, d, c.center, c.radius);
  if (!a) return { ...result, status: "no_inner_hit" };
  Object.assign(result, {
    inner: a.p,
    lInside: a.t,
    innerNormal: unit(sub(a.p, c.center)),
  });
  if (c.upperOnly && a.p[2] < c.center[2] - 1e-12)
    return { ...result, status: "outside_aperture" };
  const wall = refract(d, result.innerNormal, c.nInside, c.nWall);
  if (!wall) return { ...result, status: "inner_total_reflection" };
  result.wall = wall;
  const b = sphere(a.p, wall, c.center, c.radius + c.thickness);
  if (!b) return { ...result, status: "no_outer_hit" };
  Object.assign(result, {
    outer: b.p,
    lWall: b.t,
    outerNormal: unit(sub(b.p, c.center)),
  });
  if (c.upperOnly && b.p[2] < c.center[2] - 1e-12)
    return { ...result, status: "outside_aperture" };
  const exit = refract(wall, result.outerNormal, c.nWall, c.nOutside);
  if (!exit) return { ...result, status: "outer_total_reflection" };
  return {
    ...result,
    valid: true,
    status: "ok",
    exit,
    deflection: angle(d, exit),
  };
}
export function planeDirection(deg, plane) {
  const a = (deg * Math.PI) / 180,
    cs = Math.cos(a),
    sn = Math.sin(a);
  return plane === "XZ"
    ? [cs, 0, sn]
    : plane === "YZ"
      ? [0, cs, sn]
      : [cs, sn, 0];
}
export function beamDirection(azimuth, polar) {
  const a = (azimuth * Math.PI) / 180,
    t = (polar * Math.PI) / 180;
  return [Math.sin(t) * Math.cos(a), Math.sin(t) * Math.sin(a), Math.cos(t)];
}
export function correct(
  point,
  c,
  mode = "direction_only",
  reference = c.nInside,
) {
  const r = norm(point),
    t = trace(mv(c.rotation, point), c);
  if (!t.valid || !Number.isFinite(r))
    return { point: [NaN, NaN, NaN], status: t.status, valid: false };
  let p;
  if (mode === "direction_only") p = mul(t.exit, r);
  else {
    if (!["geometric_path", "optical_path"].includes(mode))
      throw Error("Unknown range model.");
    if (
      mode === "optical_path" &&
      (!Number.isFinite(reference) || reference <= 0)
    )
      throw Error("Range reference index must be positive.");
    const remaining =
      mode === "geometric_path"
        ? r - t.lInside - t.lWall
        : (reference * r - c.nInside * t.lInside - c.nWall * t.lWall) /
          c.nOutside;
    if (!Number.isFinite(remaining) || remaining < 0)
      return {
        point: [NaN, NaN, NaN],
        valid: false,
        status: "range_before_outer_surface",
      };
    p = sub(add(t.outer, mul(t.exit, remaining)), c.origin);
  }
  return {
    point: mv(transpose(c.rotation), p),
    valid: true,
    status: "ok",
    deflection: t.deflection,
  };
}
export function fromPython(data) {
  const d = data.dome;
  if (!d) throw Error("Expected a Python configuration with a dome object.");
  return validate({
    radius: d.inner_radius_m,
    thickness: d.thickness_m,
    center: d.center_m ?? [0, 0, 0],
    origin: data.origin_m,
    nInside: d.n_inside ?? 1.000293,
    nWall: d.n_wall ?? 1.52,
    nOutside: d.n_outside ?? 1.000293,
    upperOnly: d.upper_only ?? true,
    rotation: data.sensor_to_dome_rotation,
  });
}
export function toPython(c) {
  return {
    dome: {
      inner_radius_m: c.radius,
      thickness_m: c.thickness,
      center_m: c.center,
      n_inside: c.nInside,
      n_wall: c.nWall,
      n_outside: c.nOutside,
      upper_only: c.upperOnly,
    },
    origin_m: c.origin,
    sensor_to_dome_rotation: c.rotation,
  };
}
