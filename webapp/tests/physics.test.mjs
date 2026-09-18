import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baseline,
  validate,
  trace,
  planeDirection,
  correct,
  norm,
  sub,
  rotation,
  mv,
  transpose,
  toPython,
  fromPython,
} from "../src/physics.js";
import { indexFor } from "../src/materials.js";
import { parseCloud, exportCloud, xyzPCD, csvText } from "../src/cloud.js";
import { simulate, defaultObjects, intersect } from "../src/scene.js";
test("matches original Python 2D trace", () => {
  const c = baseline(),
    r = trace(planeDirection(90, "XZ"), c);
  assert.ok(r.valid);
  assert.ok(Math.abs(r.exit[0] + 0.005105988719334736) < 1e-13);
  assert.ok(Math.abs(r.outer[2] - 0.07528920473811516) < 1e-13);
});
test("centered source and homogeneous limits", () => {
  let c = baseline();
  c.origin = [0, 0, 0];
  for (let a = 1; a < 180; a++)
    assert.ok(trace(planeDirection(a, "XZ"), c).deflection < 1e-10);
  c = { ...baseline(), nInside: 1.2, nWall: 1.2, nOutside: 1.2 };
  for (const mode of ["optical_path", "direction_only", "geometric_path"])
    assert.ok(
      norm(sub(correct([1, 2, 5], c, mode, 1.2).point, [1, 2, 5])) < 1e-12,
    );
});
test("invalid rays, geometry and total reflection", () => {
  const c = baseline();
  assert.equal(trace([0, 0, 0], c).valid, false);
  assert.equal(trace([0, 0, -1], c).status, "outside_aperture");
  assert.equal(
    correct([0, 0, 0.0001], c, "optical_path").status,
    "range_before_outer_surface",
  );
  assert.throws(() => validate({ ...c, origin: [2, 0, 0] }));
  assert.throws(() =>
    validate({
      ...c,
      rotation: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, -1],
      ],
    }),
  );
  assert.equal(
    trace([0, 1, 0], {
      ...c,
      origin: [0.07, 0, 0],
      upperOnly: false,
      nInside: 1.5,
      nWall: 1,
    }).status,
    "inner_total_reflection",
  );
});
test("rotation and config round trip", () => {
  const c = { ...baseline(), rotation: rotation(20, -15, 72) };
  const p = [0.3, 0.4, 0.5];
  assert.ok(norm(sub(mv(transpose(c.rotation), mv(c.rotation, p)), p)) < 1e-14);
  assert.deepEqual(fromPython(toPython(c)), c);
});
test("nominal indices and Schott wavelength model", () => {
  assert.equal(indexFor("pc", 905), 1.586);
  assert.equal(indexFor("pmma", 905), 1.49);
  assert.ok(Math.abs(indexFor("bk7", 587.6) - 1.5168) < 1e-5);
  assert.ok(indexFor("bk7", 905) < indexFor("bk7", 587.6));
  assert.throws(() => indexFor("bk7", 100));
});
test("CSV attributes and PCD roundtrip", () => {
  const cloud = parseCloud(
    'x,y,z,id,note\n1,2,5,1234567890123456789,"a,b"\n',
    "x.csv",
  );
  const out = exportCloud(cloud, [[2, 3, 6]], "csv");
  assert.equal(parseCloud(out, "x.csv").rows[0][3], "1234567890123456789");
  assert.equal(parseCloud(out, "x.csv").rows[0][4], "a,b");
  assert.deepEqual(
    parseCloud(exportCloud(cloud, [[2, 3, 6]], "pcd"), "x.pcd").points,
    [[2, 3, 6]],
  );
  assert.deepEqual(parseCloud(xyzPCD([[1, 2, 3]]), "x.pcd").points, [
    [1, 2, 3],
  ]);
});
test("PCD metadata and vector fields preserved", () => {
  const text =
    "FIELDS normal x y z intensity\nSIZE 4 4 4 4 4\nTYPE F F F F U\nCOUNT 3 1 1 1 1\nWIDTH 1\nHEIGHT 1\nPOINTS 1\nDATA ascii\n0 0 1 1 2 5 42\n";
  const c = parseCloud(text, "x.pcd");
  const o = parseCloud(exportCloud(c, [[2, 3, 6]], "pcd"), "o.pcd");
  assert.deepEqual(o.points, [[2, 3, 6]]);
  assert.equal(o.rows[0].at(-1), "42");
  assert.throws(() => parseCloud(text.replace("ascii", "binary"), "x.pcd"));
  assert.throws(() => parseCloud("x,y,z\n1,,2", "x.csv"));
});
test("scene closest intersections and reconstruction", () => {
  const c = baseline(),
    r = simulate(
      c,
      defaultObjects(),
      { position: [0, 0, 0], rpy: [0, 0, 0] },
      21,
      60,
    );
  assert.ok(r.truth.length > 100);
  assert.ok(Math.max(...r.error) < 1e-8);
  assert.ok(Math.max(...r.rawError) > 1);
  assert.ok(
    intersect([0, 0, 0], [0, 0, 1], {
      type: "box",
      position: [0, 0, 3],
      size: [1, 1, 1],
      rpy: [0, 0, 0],
    }).t === 2.5,
  );
});
