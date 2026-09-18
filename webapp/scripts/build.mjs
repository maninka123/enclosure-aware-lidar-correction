import { mkdir, copyFile, cp, writeFile, unlink } from "node:fs/promises";
import { build } from "esbuild";
await mkdir("dist/vendor", { recursive: true });
for (const f of ["index.html", "style.css"]) await copyFile(f, `dist/${f}`);
await cp("src", "dist/src", { recursive: true });
await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  splitting: true,
  format: "esm",
  outdir: "dist/src",
  minify: true,
  sourcemap: true,
  target: ["es2022"],
  chunkNames: "chunks/[name]-[hash]",
});
for (const [pkg, file] of [
  ["three", "LICENSE"],
  ["echarts", "LICENSE"],
  ["zrender", "LICENSE"],
])
  await copyFile(`node_modules/${pkg}/${file}`, `dist/vendor/${pkg}-LICENSE`);
await copyFile("node_modules/echarts/NOTICE", "dist/vendor/echarts-NOTICE");
await cp("node_modules/echarts/licenses", "dist/vendor/echarts-licenses", {
  recursive: true,
});
// Remove obsolete single files only; never recursively remove the output directory.
for (const f of ["dist/vendor/plotly.min.js", "dist/vendor/Plotly-LICENSE"])
  await unlink(f).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
await writeFile("dist/.nojekyll", "");
console.log("Built local Three.js and ECharts app in webapp/dist");
