import { validate, correct, norm, sub, mul } from "./physics.js";
import { parseCloud, exportCloud } from "./cloud.js";
import { simulate } from "./scene.js";
let cloud = null,
  corrected = null;
self.onmessage = ({ data }) => {
  const { id, type } = data;
  try {
    if (type === "scene") {
      const result = simulate(
        data.config,
        data.objects,
        data.pose,
        data.resolution,
        data.fov,
        data.mode,
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
      self.postMessage({
        id,
        type,
        text: exportCloud(cloud, corrected, data.format),
      });
      return;
    }
    if (type === "correct") {
      if (!cloud) throw Error("Load a cloud first.");
      validate(data.config);
      const factor = data.factor;
      if (![1, 0.01, 0.001].includes(factor))
        throw Error("Invalid input units.");
      corrected = [];
      const rawPreview = [],
        preview = [],
        deviations = [],
        angles = [],
        statuses = [],
        allDeviations = [],
        counts = {};
      const stride = Math.max(1, Math.ceil(cloud.points.length / 20000));
      let valid = 0,
        sumSq = 0,
        max = 0;
      cloud.points.forEach((p, i) => {
        const r = correct(
          mul(p, factor),
          data.config,
          data.mode,
          data.reference,
        );
        corrected.push(mul(r.point, 1 / factor));
        counts[r.status] = (counts[r.status] || 0) + 1;
        statuses.push(r.status);
        if (r.valid) {
          const shift = norm(sub(r.point, mul(p, factor))) * 1000;
          valid++;
          sumSq += shift ** 2;
          max = Math.max(max, shift);
          allDeviations.push(shift);
          if (i % stride === 0) {
            rawPreview.push(mul(p, factor));
            preview.push(r.point);
            deviations.push(shift);
            angles.push(r.deflection);
          }
        }
        if (i % 10000 === 0)
          self.postMessage({
            id,
            progress: i / Math.max(1, cloud.points.length),
          });
      });
      self.postMessage({
        id,
        type,
        raw: rawPreview,
        corrected: preview,
        deviations,
        angles,
        statuses,
        counts,
        valid,
        total: cloud.points.length,
        rms: valid ? Math.sqrt(sumSq / valid) : null,
        max: valid ? max : null,
        histogram: allDeviations.filter((_, i) => i % stride === 0),
      });
    }
  } catch (e) {
    self.postMessage({ id, error: e.message });
  }
};
