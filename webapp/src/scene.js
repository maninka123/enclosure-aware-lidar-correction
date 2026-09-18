import {
  add,
  sub,
  mul,
  dot,
  norm,
  unit,
  mv,
  transpose,
  rotation,
  trace,
  correct,
  validate,
} from "./physics.js";
export const defaultObjects = () => [
  {
    name: "Back wall",
    type: "plane",
    position: [0, 0, 5],
    size: [7, 5, 0.1],
    rpy: [0, 0, 0],
  },
  {
    name: "Calibration sphere",
    type: "sphere",
    position: [-0.9, 0.2, 3.5],
    size: [0.45, 0.45, 0.45],
    rpy: [0, 0, 0],
  },
  {
    name: "Reference block",
    type: "box",
    position: [1, -0.1, 4],
    size: [0.8, 0.8, 0.8],
    rpy: [0, 15, 10],
  },
];
export function validateObjects(objects) {
  if (!Array.isArray(objects) || objects.length < 1 || objects.length > 30)
    throw Error("A scene needs 1–30 objects.");
  for (const o of objects) {
    if (!["plane", "sphere", "box"].includes(o.type))
      throw Error("Supported scene objects: plane, sphere, box.");
    for (const k of ["position", "size", "rpy"])
      if (
        !Array.isArray(o[k]) ||
        o[k].length !== 3 ||
        !o[k].every(Number.isFinite)
      )
        throw Error(`Invalid object ${k}.`);
    if (o.size.some((n) => n <= 0))
      throw Error("Object sizes must be positive.");
    if (typeof o.name !== "string" || o.name.length > 100)
      throw Error("Object names must be short text.");
  }
  return objects;
}
export function intersect(o, d, obj) {
  const inv = transpose(rotation(...obj.rpy)),
    q = mv(inv, sub(o, obj.position)),
    v = mv(inv, d);
  let t = Infinity;
  if (obj.type === "plane") {
    if (Math.abs(v[2]) < 1e-12) return null;
    t = -q[2] / v[2];
    const p = add(q, mul(v, t));
    if (Math.abs(p[0]) > obj.size[0] / 2 || Math.abs(p[1]) > obj.size[1] / 2)
      return null;
  } else if (obj.type === "sphere") {
    const b = dot(q, v),
      c = dot(q, q) - obj.size[0] ** 2,
      disc = b * b - c;
    if (disc < 0) return null;
    const a = -b - Math.sqrt(disc),
      b2 = -b + Math.sqrt(disc);
    t = a > 1e-9 ? a : b2;
  } else {
    let lo = -Infinity,
      hi = Infinity;
    for (let i = 0; i < 3; i++) {
      const h = obj.size[i] / 2;
      if (Math.abs(v[i]) < 1e-12) {
        if (Math.abs(q[i]) > h) return null;
        continue;
      }
      const a = (-h - q[i]) / v[i],
        b = (h - q[i]) / v[i];
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
    }
    if (hi < lo) return null;
    t = lo > 1e-9 ? lo : hi;
  }
  return Number.isFinite(t) && t > 1e-9
    ? { point: add(o, mul(d, t)), t }
    : null;
}
export function nearest(o, d, objects) {
  let hit = null;
  objects.forEach((obj, index) => {
    const h = intersect(o, d, obj);
    if (h && (!hit || h.t < hit.t)) hit = { ...h, index };
  });
  return hit;
}
export function simulate(
  c,
  objects,
  pose,
  resolution = 65,
  fov = 65,
  mode = "optical_path",
) {
  validate(c);
  validateObjects(objects);
  if (
    !Number.isInteger(resolution) ||
    resolution < 5 ||
    resolution > 151 ||
    !Number.isFinite(fov) ||
    fov <= 0 ||
    fov >= 170
  )
    throw Error("Use 5–151 samples per axis and a field of view below 170°.");
  if (
    !pose.position?.every(Number.isFinite) ||
    pose.position.length !== 3 ||
    !pose.rpy?.every(Number.isFinite) ||
    pose.rpy.length !== 3
  )
    throw Error("Invalid sensor world pose.");
  const world = rotation(...pose.rpy),
    origin = add(pose.position, mv(world, c.origin)),
    inverse = transpose(c.rotation);
  const result = {
    bare: [],
    truth: [],
    raw: [],
    corrected: [],
    rawLocal: [],
    correctedLocal: [],
    error: [],
    rawError: [],
    displacement: [],
    object: [],
    rejected: 0,
    missed: 0,
  };
  const half = Math.tan((fov * Math.PI) / 360);
  for (let i = 0; i < resolution; i++)
    for (let j = 0; j < resolution; j++) {
      const sensor = unit([
          ((2 * i) / (resolution - 1) - 1) * half,
          ((2 * j) / (resolution - 1) - 1) * half,
          1,
        ]),
        direction = mv(c.rotation, sensor);
      const bare = nearest(origin, mv(world, direction), objects);
      if (bare) result.bare.push(bare.point);
      const t = trace(direction, c);
      if (!t.valid) {
        result.rejected++;
        continue;
      }
      const h = nearest(
        add(pose.position, mv(world, t.outer)),
        mv(world, t.exit),
        objects,
      );
      if (!h) {
        result.missed++;
        continue;
      }
      const range =
        (c.nInside * t.lInside + c.nWall * t.lWall + c.nOutside * h.t) /
        c.nInside;
      const raw = mul(sensor, range),
        corrected = correct(raw, c, mode, c.nInside);
      if (!corrected.valid) {
        result.rejected++;
        continue;
      }
      const rawWorld = add(origin, mv(world, mv(c.rotation, raw))),
        correctedWorld = add(
          origin,
          mv(world, mv(c.rotation, corrected.point)),
        );
      result.truth.push(h.point);
      result.raw.push(rawWorld);
      result.corrected.push(correctedWorld);
      result.rawLocal.push(raw);
      result.correctedLocal.push(corrected.point);
      result.error.push(norm(sub(correctedWorld, h.point)) * 1000);
      result.rawError.push(norm(sub(rawWorld, h.point)) * 1000);
      result.displacement.push(norm(sub(correctedWorld, rawWorld)) * 1000);
      result.object.push(h.index);
    }
  return result;
}
