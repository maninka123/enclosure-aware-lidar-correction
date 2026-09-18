// Text attributes are retained exactly as field values, including long timestamps.
export function parseCSV(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw Error("Unclosed quote in CSV.");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
const escapeCSV = (s) =>
  /[",\n\r]/.test(String(s))
    ? '"' + String(s).replaceAll('"', '""') + '"'
    : String(s);
export const csvText = (rows) =>
  rows.map((r) => r.map(escapeCSV).join(",")).join("\n") + "\n";
export function parseCloud(text, name) {
  let rows,
    names,
    header = [],
    counts,
    format;
  if (name.toLowerCase().endsWith(".csv")) {
    [names, ...rows] = parseCSV(text);
    if (!names) throw Error("CSV is empty.");
    counts = names.map(() => 1);
    format = "csv";
  } else if (name.toLowerCase().endsWith(".pcd")) {
    format = "pcd";
    const lines = text.split(/\r?\n/),
      meta = {};
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      header.push(lines[i]);
      const t = lines[i].trim().split(/\s+/);
      if (!t[0] || t[0].startsWith("#")) continue;
      const k = t.shift().toUpperCase();
      meta[k] = t;
      if (k === "DATA") {
        if (t[0] !== "ascii")
          throw Error(
            "This app supports ASCII PCD. Convert binary/compressed PCD to ASCII first.",
          );
        start = i + 1;
        break;
      }
    }
    if (start < 0) throw Error("PCD DATA header missing.");
    names = meta.FIELDS;
    counts = (meta.COUNT ?? names?.map(() => 1))?.map(Number);
    if (
      !names ||
      !meta.SIZE ||
      !meta.TYPE ||
      meta.SIZE.length !== names.length ||
      meta.TYPE.length !== names.length
    )
      throw Error("PCD FIELDS/SIZE/TYPE must match.");
    if (
      counts.length !== names.length ||
      counts.some((n) => !Number.isInteger(n) || n < 1)
    )
      throw Error("Invalid PCD COUNT.");
    names.forEach((_, i) => {
      if (
        !["F", "I", "U"].includes(meta.TYPE[i]) ||
        !(meta.TYPE[i] === "F" ? [4, 8] : [1, 2, 4, 8]).includes(
          Number(meta.SIZE[i]),
        )
      )
        throw Error("Invalid PCD SIZE/TYPE.");
    });
    rows = lines
      .slice(start)
      .filter((l) => l.trim())
      .map((l) => l.trim().split(/\s+/));
    for (const k of ["POINTS", "WIDTH", "HEIGHT"])
      if (
        !meta[k] ||
        meta[k].length !== 1 ||
        !Number.isInteger(Number(meta[k][0])) ||
        Number(meta[k][0]) < 0
      )
        throw Error(`Invalid PCD ${k}.`);
    if (
      rows.length !== Number(meta.POINTS[0]) ||
      rows.length !== Number(meta.WIDTH[0]) * Number(meta.HEIGHT[0])
    )
      throw Error("PCD point count does not match its header.");
  } else throw Error("Choose an ASCII .pcd or an x,y,z .csv file.");
  if (new Set(names).size !== names.length)
    throw Error("Duplicate field names.");
  let width = 0;
  const offsets = counts.map((n) => {
    const j = width;
    width += n;
    return j;
  });
  const columns = ["x", "y", "z"].map((n) => {
    const i = names.indexOf(n);
    if (i < 0 || counts[i] !== 1)
      throw Error("Scalar x, y, z fields are required.");
    return offsets[i];
  });
  if (rows.some((r) => r.length !== width))
    throw Error("Point row width does not match fields.");
  if (rows.length > 500000)
    throw Error(
      "Browser limit: 500,000 points. Use the Python package for larger clouds.",
    );
  const points = rows.map((r) =>
    columns.map((i) => {
      const s = r[i].trim();
      if (!s) throw Error("Empty coordinate field.");
      const v = Number(s);
      if (Number.isNaN(v) && !/^[-+]?nan$/i.test(s))
        throw Error(`Invalid coordinate: ${s.slice(0, 25)}`);
      return v;
    }),
  );
  return { rows, names, columns, header, counts, format, points };
}
export function exportCloud(cloud, points, format = "pcd") {
  const rows = cloud.rows.map((row, i) => {
    const r = [...row];
    cloud.columns.forEach(
      (col, j) =>
        (r[col] = Number.isFinite(points[i][j])
          ? points[i][j].toPrecision(17)
          : "nan"),
    );
    return r;
  });
  if (format === "csv") {
    const names = cloud.names.flatMap((n, i) =>
      cloud.counts[i] === 1
        ? [n]
        : Array.from({ length: cloud.counts[i] }, (_, j) => `${n}_${j}`),
    );
    return csvText([names, ...rows]);
  }
  if (cloud.format === "pcd") {
    const header = cloud.header.map((line) => {
      const t = line.trim().split(/\s+/),
        key = t[0].toUpperCase();
      if (["SIZE", "TYPE"].includes(key)) {
        for (const name of ["x", "y", "z"])
          t[1 + cloud.names.indexOf(name)] = key === "SIZE" ? "8" : "F";
        return t.join(" ");
      }
      return line;
    });
    return (
      header.join("\n") + "\n" + rows.map((r) => r.join(" ")).join("\n") + "\n"
    );
  }
  // CSV fields may contain text or integers too large for floats. Keep them in CSV;
  // a new PCD from CSV contains XYZ only, explicitly stated in the interface.
  return xyzPCD(points);
}
export function xyzPCD(points) {
  return (
    "# Enclosure-aware LiDAR Lab; units follow export settings\nVERSION .7\nFIELDS x y z\nSIZE 8 8 8\nTYPE F F F\nCOUNT 1 1 1\nWIDTH " +
    points.length +
    "\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS " +
    points.length +
    "\nDATA ascii\n" +
    points
      .map((p) =>
        p
          .map((v) => (Number.isFinite(v) ? v.toPrecision(17) : "nan"))
          .join(" "),
      )
      .join("\n") +
    "\n"
  );
}
