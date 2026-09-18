import {
  angle,
  mv,
  norm,
  trace,
  transpose,
  unit,
  mul,
  toPython,
} from "./physics.js";

export const LUT_SCHEMA = "enclosure-aware-lidar-lut";
export const LUT_SCHEMA_VERSION = "1.0";
export const LUT_STATUSES = [
  "ok",
  "invalid_direction",
  "invalid_angle_pair",
  "outside_aperture",
  "no_inner_hit",
  "inner_total_reflection",
  "no_outer_hit",
  "outer_total_reflection",
  "outside_lut_domain",
  "invalid_interpolation_neighbours",
];
const code = (name) => {
  const index = LUT_STATUSES.indexOf(name);
  return index < 0 ? 1 : index;
};
const canonicalNumber = (value) => {
  if (!Number.isFinite(value))
    throw Error("Configuration signatures require finite numbers.");
  if (Object.is(value, -0) || value === 0) return "0";
  let text = value.toPrecision(15);
  if (text.includes("e")) {
    const [mantissa, exponent] = text.split("e");
    text = `${mantissa.replace(/\.?0+$/, "")}e${Number(exponent)}`;
  } else text = text.replace(/\.?0+$/, "");
  return text;
};
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`
      : typeof value === "number"
        ? JSON.stringify(canonicalNumber(value))
        : JSON.stringify(value);
async function digest(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export const defaultLUTSettings = () => ({
  resolution_deg: 0.1,
  xz_min_deg: -32.5,
  xz_max_deg: 32.5,
  yz_min_deg: -32.5,
  yz_max_deg: 32.5,
  interpolation: "bilinear",
});
export function validateLUTSettings(settings) {
  const s = { ...defaultLUTSettings(), ...settings };
  for (const key of [
    "resolution_deg",
    "xz_min_deg",
    "xz_max_deg",
    "yz_min_deg",
    "yz_max_deg",
  ])
    if (!Number.isFinite(s[key])) throw Error(`${key} must be finite.`);
  if (s.resolution_deg <= 0) throw Error("LUT resolution must be positive.");
  if (s.xz_max_deg <= s.xz_min_deg || s.yz_max_deg <= s.yz_min_deg)
    throw Error("LUT angular maxima must be greater than minima.");
  if (s.xz_max_deg - s.xz_min_deg > 360 || s.yz_max_deg - s.yz_min_deg > 360)
    throw Error("A LUT angular axis cannot span more than 360 degrees.");
  if (s.interpolation !== "bilinear")
    throw Error("Only bilinear LUT interpolation is supported.");
  const nx = Math.round((s.xz_max_deg - s.xz_min_deg) / s.resolution_deg),
    ny = Math.round((s.yz_max_deg - s.yz_min_deg) / s.resolution_deg);
  if (
    Math.abs(nx * s.resolution_deg - (s.xz_max_deg - s.xz_min_deg)) > 1e-9 ||
    Math.abs(ny * s.resolution_deg - (s.yz_max_deg - s.yz_min_deg)) > 1e-9
  )
    throw Error("Each LUT angular span must be divisible by its resolution.");
  if (nx < 1 || ny < 1) throw Error("Each LUT axis needs at least two nodes.");
  if ((nx + 1) * (ny + 1) > 4_000_000)
    throw Error("LUT exceeds the four-million-cell safety limit.");
  return s;
}
export function directionToAngles(direction) {
  if (!direction?.every(Number.isFinite) || !norm(direction)) return [NaN, NaN];
  const d = unit(direction);
  return [
    (Math.atan2(d[0], d[2]) * 180) / Math.PI,
    (Math.atan2(d[1], d[2]) * 180) / Math.PI,
  ];
}
export function anglesToDirection(thetaXZ, thetaYZ) {
  const x = (thetaXZ * Math.PI) / 180,
    y = (thetaYZ * Math.PI) / 180,
    cx = Math.cos(x),
    cy = Math.cos(y);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    Math.abs(cx) <= 1e-12 ||
    Math.abs(cy) <= 1e-12 ||
    Math.sign(cx) !== Math.sign(cy)
  )
    return null;
  const tx = Math.tan(x),
    ty = Math.tan(y),
    z = Math.sign(cx) / Math.sqrt(1 + tx * tx + ty * ty);
  return [tx * z, ty * z, z];
}
const axis = (lo, hi, step) => {
  const count = Math.round((hi - lo) / step);
  return Array.from(
    { length: count + 1 },
    (_, i) => lo + (i * (hi - lo)) / count,
  );
};
const wrap = (value) => ((((value + 180) % 360) + 360) % 360) - 180;
export const configurationSignature = (config) => digest(toPython(config));
export const tableSignature = (configurationHash, settings) =>
  digest({ configuration_hash: configurationHash, lut: settings });

export async function generateLUT(
  config,
  settings = defaultLUTSettings(),
  progress = () => {},
  cancelled = () => false,
) {
  const s = validateLUTSettings(settings),
    xz = axis(s.xz_min_deg, s.xz_max_deg, s.resolution_deg),
    yz = axis(s.yz_min_deg, s.yz_max_deg, s.resolution_deg),
    count = xz.length * yz.length,
    exit = new Float64Array(count * 3),
    deltaXZ = new Float64Array(count),
    deltaYZ = new Float64Array(count),
    valid = new Uint8Array(count),
    status = new Uint8Array(count),
    inverse = transpose(config.rotation),
    started = performance.now();
  exit.fill(NaN);
  deltaXZ.fill(NaN);
  deltaYZ.fill(NaN);
  for (let j = 0; j < yz.length; j++) {
    if (cancelled()) throw Error("LUT generation cancelled.");
    for (let i = 0; i < xz.length; i++) {
      const k = j * xz.length + i,
        incident = anglesToDirection(xz[i], yz[j]);
      if (!incident) {
        status[k] = code("invalid_angle_pair");
        continue;
      }
      const traced = trace(mv(config.rotation, incident), config);
      status[k] = code(traced.status);
      if (!traced.valid) continue;
      const out = unit(mv(inverse, traced.exit)),
        angles = directionToAngles(out);
      valid[k] = 1;
      status[k] = 0;
      exit.set(out, k * 3);
      deltaXZ[k] = wrap(angles[0] - xz[i]);
      deltaYZ[k] = wrap(angles[1] - yz[j]);
    }
    if (j % 4 === 0) progress(((j + 1) / yz.length) * 0.75);
  }
  const configurationHash = await configurationSignature(config),
    lutHash = await tableSignature(configurationHash, s),
    lut = {
      schema: LUT_SCHEMA,
      schema_version: LUT_SCHEMA_VERSION,
      settings: s,
      xz,
      yz,
      exit,
      deltaXZ,
      deltaYZ,
      valid,
      status,
      configuration: toPython(config),
      configurationHash,
      lutHash,
      generationTime: (performance.now() - started) / 1000,
      validation: null,
    };
  lut.validation = validateLUT(
    lut,
    config,
    12000,
    (p) => progress(0.75 + p * 0.25),
    cancelled,
  );
  progress(1);
  return lut;
}
export function lookupDirection(direction, lut) {
  const [ax, ay] = directionToAngles(direction),
    s = lut.settings,
    u = (ax - lut.xz[0]) / s.resolution_deg,
    v = (ay - lut.yz[0]) / s.resolution_deg;
  if (!Number.isFinite(u) || !Number.isFinite(v))
    return { valid: false, status: "invalid_direction" };
  if (
    u < -1e-12 ||
    v < -1e-12 ||
    u > lut.xz.length - 1 + 1e-12 ||
    v > lut.yz.length - 1 + 1e-12
  )
    return { valid: false, status: "outside_lut_domain" };
  const i = Math.min(lut.xz.length - 2, Math.max(0, Math.floor(u))),
    j = Math.min(lut.yz.length - 2, Math.max(0, Math.floor(v))),
    fx = Math.max(0, Math.min(1, u - i)),
    fy = Math.max(0, Math.min(1, v - j)),
    ids = [
      j * lut.xz.length + i,
      j * lut.xz.length + i + 1,
      (j + 1) * lut.xz.length + i,
      (j + 1) * lut.xz.length + i + 1,
    ];
  if (!ids.every((k) => lut.valid[k]))
    return { valid: false, status: "invalid_interpolation_neighbours" };
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy],
    out = [0, 0, 0];
  ids.forEach((id, n) => {
    for (let q = 0; q < 3; q++) out[q] += weights[n] * lut.exit[id * 3 + q];
  });
  return { valid: true, status: "ok", direction: unit(out) };
}
export function correctPointLUT(point, lut) {
  const range = norm(point);
  if (!point?.every(Number.isFinite) || !Number.isFinite(range) || !range)
    return {
      point: [NaN, NaN, NaN],
      valid: false,
      status: "invalid_direction",
    };
  const result = lookupDirection(mul(point, 1 / range), lut);
  return result.valid
    ? { point: mul(result.direction, range), valid: true, status: "ok" }
    : { point: [NaN, NaN, NaN], valid: false, status: result.status };
}
const percentile = (sorted, q) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q,
    lo = Math.floor(i),
    hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
export function summary(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length)
    return {
      count: 0,
      mean: null,
      rms: null,
      median: null,
      p95: null,
      max: null,
    };
  return {
    count: a.length,
    mean: a.reduce((sum, value) => sum + value, 0) / a.length,
    rms: Math.sqrt(a.reduce((sum, value) => sum + value * value, 0) / a.length),
    median: percentile(a, 0.5),
    p95: percentile(a, 0.95),
    max: a.at(-1),
  };
}
export function validateLUT(
  lut,
  config,
  sampleLimit = 12000,
  progress = () => {},
  cancelled = () => false,
) {
  const cells = (lut.xz.length - 1) * (lut.yz.length - 1),
    samples = Math.min(cells, sampleLimit),
    errors = [],
    validationError = new Float64Array(cells),
    inverse = transpose(config.rotation);
  validationError.fill(NaN);
  for (let n = 0; n < samples; n++) {
    if (cancelled()) throw Error("LUT validation cancelled.");
    const cell =
        samples === 1 ? 0 : Math.round((n * (cells - 1)) / (samples - 1)),
      i = cell % (lut.xz.length - 1),
      j = Math.floor(cell / (lut.xz.length - 1)),
      x = (lut.xz[i] + lut.xz[i + 1]) / 2,
      y = (lut.yz[j] + lut.yz[j + 1]) / 2,
      incident = anglesToDirection(x, y);
    if (!incident) continue;
    const traced = trace(mv(config.rotation, incident), config),
      predicted = lookupDirection(incident, lut);
    if (traced.valid && predicted.valid) {
      const error = angle(mv(inverse, traced.exit), predicted.direction);
      errors.push(error);
      validationError[cell] = error;
    }
    if (n % 500 === 0) progress((n + 1) / samples);
  }
  const metrics = summary(errors),
    endpoint = (range) =>
      errors.length
        ? Math.sqrt(
            errors.reduce(
              (sum, e) =>
                sum + (2 * range * Math.sin((e * Math.PI) / 360)) ** 2,
              0,
            ) / errors.length,
          ) * 1000
        : null;
  lut.validationError = validationError;
  return {
    resolution_deg: lut.settings.resolution_deg,
    cells: lut.valid.length,
    generation_time_s: lut.generationTime,
    memory_bytes:
      lut.exit.byteLength +
      lut.deltaXZ.byteLength +
      lut.deltaYZ.byteLength +
      lut.valid.byteLength +
      lut.status.byteLength,
    valid_cells: lut.valid.reduce((sum, value) => sum + value, 0),
    invalid_cells: lut.valid.reduce((sum, value) => sum + (value ? 0 : 1), 0),
    validation_samples: samples,
    valid_validation_samples: metrics.count,
    mean_angular_error_deg: metrics.mean,
    rms_angular_error_deg: metrics.rms,
    p95_angular_error_deg: metrics.p95,
    max_angular_error_deg: metrics.max,
    equivalent_rms_position_error_mm_at_1m: endpoint(1),
    equivalent_rms_position_error_mm_at_5m: endpoint(5),
    equivalent_rms_position_error_mm_at_10m: endpoint(10),
  };
}
export function serializeLUT(lut) {
  return {
    schema: LUT_SCHEMA,
    schema_version: LUT_SCHEMA_VERSION,
    software_version: "0.1.0",
    generation_timestamp: new Date().toISOString(),
    configuration: lut.configuration,
    configuration_hash: lut.configurationHash,
    lut_hash: lut.lutHash,
    coordinate_convention: {
      frame: "sensor",
      theta_xz: "degrees, atan2(x,z)",
      theta_yz: "degrees, atan2(y,z)",
      correction:
        "bilinear exit-vector interpolation; measured radius preserved",
    },
    settings: lut.settings,
    xz_deg: lut.xz,
    yz_deg: lut.yz,
    exit_direction_sensor: Array.from(lut.exit),
    delta_xz_deg: Array.from(lut.deltaXZ),
    delta_yz_deg: Array.from(lut.deltaYZ),
    valid: Array.from(lut.valid),
    status: Array.from(lut.status, (value) => LUT_STATUSES[value]),
    generation_time_s: lut.generationTime,
    validation: lut.validation,
    validation_error_deg: Array.from(lut.validationError || []),
  };
}
export async function deserializeLUT(data, config) {
  if (data?.schema !== LUT_SCHEMA || data.schema_version !== LUT_SCHEMA_VERSION)
    throw Error("Unsupported LUT schema or version.");
  const settings = validateLUTSettings(data.settings),
    configurationHash = await configurationSignature(config);
  if (data.configuration_hash !== configurationHash)
    throw Error("Imported LUT is incompatible with the current configuration.");
  const lutHash = await tableSignature(configurationHash, settings);
  if (data.lut_hash !== lutHash)
    throw Error("Malformed or inconsistent LUT data.");
  const count = data.xz_deg.length * data.yz_deg.length;
  if (
    data.exit_direction_sensor.length !== count * 3 ||
    data.delta_xz_deg.length !== count ||
    data.delta_yz_deg.length !== count ||
    data.valid.length !== count ||
    data.status.length !== count
  )
    throw Error("Malformed LUT array dimensions.");
  return {
    schema: data.schema,
    schema_version: data.schema_version,
    settings,
    xz: data.xz_deg,
    yz: data.yz_deg,
    exit: Float64Array.from(data.exit_direction_sensor, (value) =>
      value === null ? NaN : value,
    ),
    deltaXZ: Float64Array.from(data.delta_xz_deg, (value) =>
      value === null ? NaN : value,
    ),
    deltaYZ: Float64Array.from(data.delta_yz_deg, (value) =>
      value === null ? NaN : value,
    ),
    valid: Uint8Array.from(data.valid),
    status: Uint8Array.from(data.status, code),
    configuration: data.configuration,
    configurationHash,
    lutHash,
    generationTime: data.generation_time_s,
    validation: data.validation,
    validationError: Float64Array.from(
      data.validation_error_deg || [],
      (value) => (value === null ? NaN : value),
    ),
  };
}
