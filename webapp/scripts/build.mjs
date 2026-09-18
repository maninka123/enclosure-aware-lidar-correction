import { mkdir, copyFile, cp, writeFile } from "node:fs/promises";
await mkdir("dist/vendor", { recursive: true });
for (const f of ["index.html", "style.css"]) await copyFile(f, `dist/${f}`);
await cp("src", "dist/src", { recursive: true });
await copyFile(
  "node_modules/plotly.js-dist-min/plotly.min.js",
  "dist/vendor/plotly.min.js",
);
await copyFile(
  "node_modules/plotly.js-dist-min/LICENSE",
  "dist/vendor/Plotly-LICENSE",
);
await writeFile("dist/.nojekyll", "");
console.log("Built static app in webapp/dist");
