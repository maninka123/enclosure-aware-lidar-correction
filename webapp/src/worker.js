import { validate, correct, norm, sub, mul, angle } from "./physics.js";
import { parseCloud, exportCloud } from "./cloud.js";
import { simulate } from "./scene.js";
import {
  configurationSignature,
  correctPointLUT,
  deserializeLUT,
  generateLUT,
  serializeLUT,
  summary,
  tableSignature,
  validateLUTSettings,
} from "./lut.js";

let cloud = null,
  corrected = null,
  defaultExport = "analytical";
const lutCache = new Map();
const statusCounts = (statuses) =>
  statuses.reduce((result, status) => {
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {});

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  const progress = (value) => self.postMessage({ id, progress: value });
  try {
    if (type === "lut_signature") {
      const settings = validateLUTSettings(data.settings),
        configurationHash = await configurationSignature(data.config),
        lutHash = await tableSignature(configurationHash, settings);
      self.postMessage({ id, type, configurationHash, lutHash });
      return;
    }
    if (type === "generate_lut") {
      validate(data.config);
      const settings = validateLUTSettings(data.settings),
        configurationHash = await configurationSignature(data.config),
        lutHash = await tableSignature(configurationHash, settings);
      let lut = lutCache.get(lutHash),
        reused = true;
      if (!lut) {
        reused = false;
        lut = await generateLUT(data.config, settings, progress);
        lutCache.set(lutHash, lut);
      }
      self.postMessage({ id, type, lut, reused });
      return;
    }
    if (type === "import_lut") {
      const lut = await deserializeLUT(JSON.parse(data.text), data.config);
      lutCache.set(lut.lutHash, lut);
      self.postMessage({ id, type, lut });
      return;
    }
    if (type === "export_lut") {
      self.postMessage({ id, type, data: serializeLUT(data.lut) });
      return;
    }
    if (type === "scene") {
      const result = simulate(
        data.config,
        data.objects,
        data.pose,
        data.resolution,
        data.fov,
        data.mode,
        data.lut || null,
      );
      self.postMessage({ id, type, result });
      return;
    }
    if (type === "load") {
      cloud = parseCloud(data.text, data.name);
      corrected = null;
      self.postMessage({
        id,
        type,
        count: cloud.points.length,
        format: cloud.format,
        fields: cloud.names,
      });
      return;
    }
    if (type === "export") {
      if (!cloud || !corrected) throw Error("Run correction before export.");
      const layer = data.layer || defaultExport,
        points = corrected[layer];
      if (!points)
        throw Error(`No ${layer} correction is available to export.`);
      self.postMessage({
        id,
        type,
        text: exportCloud(cloud, points, data.format),
        layer,
      });
      return;
    }
    if (type === "correct") {
      if (!cloud) throw Error("Load a cloud first.");
      validate(data.config);
      const factor = data.factor,
        method = data.method || "analytical",
        useAnalytical = method === "analytical" || method === "compare",
        useLUT = method === "lut" || method === "compare";
      if (![1, 0.01, 0.001].includes(factor))
        throw Error("Invalid input units.");
      if (useLUT && !data.lut) throw Error("Generate a compatible LUT first.");
      corrected = {};
      const rawMetres = cloud.points.map((point) => mul(point, factor)),
        analytical = [],
        analyticalStatuses = [],
        lut = [],
        lutStatuses = [];
      let analyticalMs = null,
        lutMs = null;
      if (useAnalytical) {
        const started = performance.now();
        rawMetres.forEach((point, index) => {
          const result = correct(point, data.config, data.mode, data.reference);
          analytical.push(result.point);
          analyticalStatuses.push(result.status);
          if (index % 10000 === 0)
            progress(
              (index / Math.max(1, rawMetres.length)) * (useLUT ? 0.42 : 0.84),
            );
        });
        analyticalMs = performance.now() - started;
        corrected.analytical = analytical.map((point) =>
          mul(point, 1 / factor),
        );
      }
      if (useLUT) {
        const started = performance.now();
        rawMetres.forEach((point, index) => {
          const result = correctPointLUT(point, data.lut);
          lut.push(result.point);
          lutStatuses.push(result.status);
          if (index % 10000 === 0)
            progress(0.45 + (index / Math.max(1, rawMetres.length)) * 0.4);
        });
        lutMs = performance.now() - started;
        corrected.lut = lut.map((point) => mul(point, 1 / factor));
      }
      defaultExport = method === "lut" ? "lut" : "analytical";
      const stride = Math.max(1, Math.ceil(rawMetres.length / 20000)),
        rawPreview = [],
        analyticalPreview = [],
        lutPreview = [],
        analyticalMagnitude = [],
        lutMagnitude = [],
        methodDifference = [],
        angularDifference = [],
        lutInterpolationAngular = [],
        ranges = [],
        rangeAnalyticalMagnitude = [],
        rangeLUTMagnitude = [],
        rangeMethodDifference = [],
        rangeMethodAngularDifference = [],
        rangeLUTInterpolationAngular = [];
      rawMetres.forEach((point, index) => {
        const aValid = useAnalytical && analyticalStatuses[index] === "ok",
          lValid = useLUT && lutStatuses[index] === "ok";
        if (aValid)
          analyticalMagnitude.push(norm(sub(analytical[index], point)) * 1000);
        if (lValid) lutMagnitude.push(norm(sub(lut[index], point)) * 1000);
        if (aValid && lValid) {
          methodDifference.push(
            norm(sub(analytical[index], lut[index])) * 1000,
          );
          angularDifference.push(angle(analytical[index], lut[index]));
        }
        if (lValid) {
          const reference = correct(
            point,
            data.config,
            "direction_only",
            data.config.nInside,
          );
          if (reference.valid)
            lutInterpolationAngular.push(angle(reference.point, lut[index]));
        }
        if (index % stride === 0 && (aValid || lValid)) {
          rawPreview.push(point);
          ranges.push(norm(point));
          analyticalPreview.push(aValid ? analytical[index] : [NaN, NaN, NaN]);
          lutPreview.push(lValid ? lut[index] : [NaN, NaN, NaN]);
          rangeAnalyticalMagnitude.push(
            aValid ? norm(sub(analytical[index], point)) * 1000 : NaN,
          );
          rangeLUTMagnitude.push(
            lValid ? norm(sub(lut[index], point)) * 1000 : NaN,
          );
          rangeMethodDifference.push(
            aValid && lValid
              ? norm(sub(analytical[index], lut[index])) * 1000
              : NaN,
          );
          rangeMethodAngularDifference.push(
            aValid && lValid ? angle(analytical[index], lut[index]) : NaN,
          );
          const directionReference = lValid
            ? correct(point, data.config, "direction_only", data.config.nInside)
            : null;
          rangeLUTInterpolationAngular.push(
            directionReference?.valid
              ? angle(directionReference.point, lut[index])
              : NaN,
          );
        }
      });
      const selectedMagnitude =
          method === "lut" ? lutMagnitude : analyticalMagnitude,
        selectedStatuses = method === "lut" ? lutStatuses : analyticalStatuses,
        selectedPreview = method === "lut" ? lutPreview : analyticalPreview,
        selectedSummary = summary(selectedMagnitude);
      progress(1);
      self.postMessage({
        id,
        type,
        method,
        total: rawMetres.length,
        raw: rawPreview,
        analytical: analyticalPreview,
        lut: lutPreview,
        corrected: selectedPreview,
        deviations: selectedMagnitude.filter(
          (_, index) => index % stride === 0,
        ),
        histogram: selectedMagnitude.filter((_, index) => index % stride === 0),
        analyticalMagnitude,
        lutMagnitude,
        methodDifference,
        angularDifference,
        lutInterpolationAngular,
        ranges,
        rangeAnalyticalMagnitude,
        rangeLUTMagnitude,
        rangeMethodDifference,
        rangeMethodAngularDifference,
        rangeLUTInterpolationAngular,
        analyticalStatuses,
        lutStatuses,
        analyticalCounts: statusCounts(analyticalStatuses),
        lutCounts: statusCounts(lutStatuses),
        analyticalValid: analyticalStatuses.filter((value) => value === "ok")
          .length,
        lutValid: lutStatuses.filter((value) => value === "ok").length,
        statuses: selectedStatuses,
        counts: statusCounts(selectedStatuses),
        valid: selectedStatuses.filter((value) => value === "ok").length,
        rms: selectedSummary.rms,
        max: selectedSummary.max,
        metrics: {
          analytical_correction_magnitude_mm: summary(analyticalMagnitude),
          lut_correction_magnitude_mm: summary(lutMagnitude),
          method_difference_mm: summary(methodDifference),
          method_angular_difference_deg: summary(angularDifference),
          lut_interpolation_error_deg: summary(lutInterpolationAngular),
        },
        runtime: {
          analytical_ms: analyticalMs,
          lut_ms: lutMs,
          analytical_points_per_second:
            analyticalMs === null
              ? null
              : rawMetres.length / (analyticalMs / 1000),
          lut_points_per_second:
            lutMs === null ? null : rawMetres.length / (lutMs / 1000),
          lut_speedup:
            analyticalMs !== null && lutMs > 0 ? analyticalMs / lutMs : null,
        },
      });
      return;
    }
    throw Error(`Unknown worker request: ${type}`);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
