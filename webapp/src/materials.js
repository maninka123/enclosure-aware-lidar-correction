// Nominal polymer values are deliberately NOT extrapolated to a LiDAR wavelength.
export const materials = {
  custom: {
    name: "Custom / measured index",
    note: "Enter a phase index measured at your laser wavelength and operating temperature.",
  },
  pc: {
    name: "Polycarbonate · nominal 1.586",
    n: 1.586,
    note: "Covestro Makrolon 3107: nominal ISO 489 index 1.586. Grade and wavelength dependent; not a calibrated 905/1550 nm value.",
    url: "https://solutions.covestro.com/en/products/makrolon/makrolon-3107_000000000057534595",
  },
  pmma: {
    name: "PMMA / acrylic · nominal 1.49",
    n: 1.49,
    note: "PLEXIGLAS film: nominal ISO 489 index 1.49 at 23 °C. Use measured values for the actual dome grade and laser wavelength.",
    url: "https://www.plexiglas.de/files/plexiglas-content/pdf/239-35-EN-PLEXIGLAS-Films-microfluidic-applications.pdf",
  },
  bk7: {
    name: "SCHOTT N-BK7 · wavelength model",
    note: "SCHOTT Sellmeier dispersion model. App range 400–1550 nm; standard catalog conditions. Check temperature and batch for precision work.",
    url: "https://labcit.ligo.caltech.edu/~gari/LIGOII/BK7datasheet.pdf",
  },
};
export function indexFor(material, nm) {
  if (material === "bk7") {
    if (!Number.isFinite(nm) || nm < 400 || nm > 1550)
      throw Error("N-BK7 wavelength must be 400–1550 nm.");
    const l = (nm / 1000) ** 2,
      b = [1.03961212, 0.231792344, 1.01046945],
      cs = [0.00600069867, 0.0200179144, 103.560653];
    return Math.sqrt(
      1 + b.reduce((sum, v, i) => sum + (v * l) / (l - cs[i]), 0),
    );
  }
  return materials[material]?.n;
}
