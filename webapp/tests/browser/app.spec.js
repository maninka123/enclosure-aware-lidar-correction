import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("designer, materials, beam inspection and atlas", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#geometry canvas")).toBeVisible();
  await expect(page.locator("#error")).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/designer.png", fullPage: true });
  await page.locator("#material").selectOption("bk7");
  await expect(page.locator("#nwall")).toHaveValue(/1\.50/);
  await expect(page.locator("#error")).toBeHidden();
  await page.locator("#ox").fill("-30");
  await page.locator("#pitch").fill("12");
  await page.waitForTimeout(500);
  await page.locator("#plane-b").selectOption("XY");
  await expect(page.locator("#curve-b-title")).toContainText("XY");
  await page.getByRole("tab", { name: /Beam inspector/ }).click();
  await expect(page.locator("#beam3d canvas")).toBeVisible();
  await page.locator('[data-focus="beam-a"][data-hit="inner"]').click();
  await page.locator('[data-expand="beam3d"]').click();
  await expect(page.locator("#plot-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#plot-dialog")).toBeHidden();
  await page.getByRole("tab", { name: /Deflection atlas/ }).click();
  await expect(page.locator("#heatmap canvas").first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/atlas.png", fullPage: true });
  await page.locator("#open-model").click();
  await expect(page.locator("#model-dialog")).toBeVisible();
  await expect(page.locator("#model-dialog")).toContainText("Apply Snell");
  await expect(page.locator("#model-dialog")).toContainText(
    "not an exact reproduction",
  );
  await page.screenshot({ path: "test-results/model-dialog.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#model-dialog")).not.toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Deflection atlas/ }),
  ).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});
test("cloud correction, downloads and stale result protection", async ({
  page,
}) => {
  await page.goto("/#cloud");
  await page.locator("#cloud-file").setInputFiles({
    name: "raw.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("x,y,z,intensity\n0,0,5,42\n1,0,5,17\n0,0,0,0\n"),
  });
  await expect(page.locator("#correct-cloud")).toBeEnabled();
  await page.locator("#correct-cloud").click();
  await expect(page.locator("#cloud-status")).toContainText("2 analytical");
  const download = page.waitForEvent("download");
  await page.locator("#export-pcd").click();
  expect((await download).suggestedFilename()).toBe("analytical-corrected.pcd");
  await page.locator("#thickness").fill("6");
  await expect(page.locator("#export-pcd")).toBeDisabled();
  await page.locator("#cloud-mode").selectOption("optical_path");
  await page.locator("#correct-cloud").click();
  await expect(page.locator("#export-report")).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/cloud.png", fullPage: true });
});
test("scene editing, simulation and exact model error", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#scene");
  await expect(page.locator("#scene-layer")).toHaveValue("comparison");
  await expect(page.locator(".scene-method-note")).toContainText(
    "ground truth is not supplied",
  );
  await expect(page.locator("#scene-status")).toContainText("returns", {
    timeout: 30000,
  });
  await page.locator("#scene-auto").uncheck();
  await page.locator("#object-x").fill(".5");
  await page.locator("#simulate").click();
  await expect(page.locator("#scene-pcd")).toBeEnabled();
  await page.locator("#new-object").selectOption("box");
  await page.locator("#add-object").click();
  await expect(page.locator("#object-list option")).toHaveCount(4);
  await page.locator("#simulate").click();
  await expect(page.locator("#scene-pcd")).toBeEnabled();
  await page.locator("#add-station").click();
  await expect(page.locator("#station-list option")).toHaveCount(2);
  await page.locator("#nwall").fill("1.6");
  await page.locator("#station-list").selectOption("0");
  await expect(page.locator("#nwall")).toHaveValue("1.52");
  await page.locator("#station-list").selectOption("1");
  await expect(page.locator("#nwall")).toHaveValue("1.6");
  await page.locator("#material").selectOption("pc");
  const saved = page.waitForEvent("download");
  await page.locator("#save-scene").click();
  const sceneFile = await readFile(await (await saved).path());
  const conflictingScene = JSON.parse(sceneFile);
  conflictingScene.config = null;
  conflictingScene.pose = { position: [99, 99, 99], rpy: [45, 45, 45] };
  conflictingScene.material = { preset: "missing-material" };

  await page.locator("#remove-station").click();
  await page.locator("#load-scene").setInputFiles({
    name: "scene.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(conflictingScene)),
  });
  await expect(page.locator("#station-list option")).toHaveCount(2);
  await expect(page.locator("#material")).toHaveValue("pc");
  await expect(page.locator("#radius")).toHaveValue("74");
  await expect(page.locator("#world-x")).toHaveValue(
    String(
      conflictingScene.stations[conflictingScene.active_station].pose
        .position[0],
    ),
  );
  await expect(page.locator("#world-roll")).toHaveValue(
    String(
      conflictingScene.stations[conflictingScene.active_station].pose.rpy[0],
    ),
  );
  await expect(page.locator("#error")).toBeHidden();
  await page.locator("#station-list").selectOption("0");
  await expect(page.locator("#material")).toHaveValue("custom");
  await page.locator("#station-list").selectOption("1");
  await expect(page.locator("#material")).toHaveValue("pc");
  await page.locator("#simulate").click();
  await expect(page.locator("#scene-pcd")).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/scene.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("mobile navigation and invalid geometry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#geometry canvas")).toBeVisible();
  await page.locator("#toggle-controls").click();
  await page.locator("#ox").fill("200");
  await expect(page.locator("#error")).toContainText("inside");
  await page.locator("#reset").click();
  await expect(page.locator("#error")).toBeHidden();
  await page.locator("#toggle-controls").click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});

test("named material library persists and travels with scenes", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#outside-material").selectOption("water");
  await expect(page.locator("#noutside")).toHaveValue("1.333");
  await expect(page.locator("#noutside")).toHaveAttribute("readonly", "");
  await page.locator("#material").selectOption("__add__");
  await page.locator("#new-material-name").fill("Measured dome 905 nm");
  await page.locator("#new-material-index").fill("1.54321");
  await page.locator("#new-material-note").fill("Measured at 23 C");
  await page.getByRole("button", { name: "Save and use material" }).click();
  await expect(page.locator("#material-dialog")).not.toBeVisible();
  await expect(page.locator("#nwall")).toHaveValue("1.543210000");
  const key = await page.locator("#material").inputValue();
  await page.locator("#inside-material").selectOption(key);
  await expect(page.locator("#ninside")).toHaveValue("1.54321");
  await page.reload();
  await page.locator("#material").selectOption(key);
  await expect(page.locator("#nwall")).toHaveValue("1.543210000");
  await page.getByRole("tab", { name: /Scene lab/ }).click();
  await page.locator("#material").selectOption(key);
  const saved = page.waitForEvent("download");
  await page.locator("#save-scene").click();
  const sceneFile = await readFile(await (await saved).path());
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator("#load-scene").setInputFiles({
    name: "scene.json",
    mimeType: "application/json",
    buffer: sceneFile,
  });
  await expect(page.locator("#material")).toHaveValue(key);
  await expect(page.locator("#nwall")).toHaveValue("1.54321");
  await expect(page.locator("#error")).toBeHidden();
});

test("new renderers preserve view controls, picking, aspect and PNG export", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#geometry")).toHaveAttribute(
    "data-renderer",
    "three",
  );
  await expect(page.locator("#designer-section")).toHaveAttribute(
    "data-renderer",
    "echarts",
  );
  expect(await page.evaluate(() => typeof window.Plotly)).toBe("undefined");
  const before = await page.locator("#geometry").getAttribute("data-camera");
  await page.locator('[data-view="geometry"][data-camera="top"]').click();
  await expect(page.locator("#geometry")).not.toHaveAttribute(
    "data-camera",
    before,
  );
  const bounds = JSON.parse(
    await page.locator("#designer-section").getAttribute("data-bounds"),
  );
  const geometryBox = await page.locator("#geometry").boundingBox();
  const projectionBox = await page.locator("#designer-section").boundingBox();
  expect(geometryBox.width).toBeGreaterThan(projectionBox.width * 1.45);
  // The equal-scale ray frame follows the configured geometry and ray extent;
  // card width must not inflate the horizontal axis into empty space.
  expect(Math.max(Math.abs(bounds.x[0]), Math.abs(bounds.x[1]))).toBeLessThan(
    160,
  );
  expect(bounds.x[0]).toBeCloseTo(-128, 5);
  expect(bounds.x[1]).toBeCloseTo(128, 5);
  expect(bounds.y[0]).toBeCloseTo(0, 5);
  expect(bounds.y[1]).toBeCloseTo(128, 5);
  const frame = JSON.parse(
    await page.locator("#designer-section").getAttribute("data-frame"),
  );
  expect(frame.width / frame.height).toBeCloseTo(
    (bounds.x[1] - bounds.x[0]) / (bounds.y[1] - bounds.y[0]),
    5,
  );
  await page.locator('[data-focus="designer-section"][data-hit="all"]').click();
  await expect
    .poll(
      async () =>
        JSON.parse(
          await page.locator("#designer-section").getAttribute("data-bounds"),
        ).y[1],
    )
    .toBeGreaterThan(bounds.y[1]);
  await page
    .locator('[data-focus="designer-section"][data-hit="outer"]')
    .click();
  await expect
    .poll(
      async () =>
        JSON.parse(
          await page.locator("#designer-section").getAttribute("data-bounds"),
        ).y[1],
    )
    .toBeLessThan(bounds.y[1]);
  for (const id of ["geometry", "designer-section"]) {
    const download = page.waitForEvent("download");
    await page
      .locator(`#${id}`)
      .getByRole("button", { name: "Save PNG" })
      .click();
    const file = await download,
      bytes = await readFile(await file.path());
    expect(file.suggestedFilename()).toBe(`${id}.png`);
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBeGreaterThan(300);
    expect(bytes.length).toBeGreaterThan(5000);
  }
  await page.locator('[data-expand="designer-section"]').click();
  await expect(
    page.locator("#plot-dialog #designer-section canvas").first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Scene lab/ }).click();
  await expect(page.locator("#scene-status")).toContainText("returns");
  await page.locator("#scene-auto").uncheck();
  await page.locator("#scene-click").selectOption("sensor");
  const canvas = page.locator("#scene3d canvas");
  await canvas.scrollIntoViewIfNeeded();
  const rect = await canvas.boundingBox();
  // Find a visible scene hit using the viewer's coordinate tooltip, then place the station.
  let picked = false;
  for (const x of [0.35, 0.5, 0.65]) {
    for (const y of [0.4, 0.55, 0.7]) {
      await page.mouse.move(rect.x + rect.width * x, rect.y + rect.height * y);
      if (await page.locator("#scene3d .view-tooltip").isVisible()) {
        await page.mouse.click(
          rect.x + rect.width * x,
          rect.y + rect.height * y,
        );
        picked = true;
        break;
      }
    }
    if (picked) break;
  }
  expect(picked).toBe(true);
  expect(await page.locator("#world-z").inputValue()).not.toBe("0");
  expect(errors).toEqual([]);
});

test("dynamic LUT generation, cloud comparison and Scene Lab", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#cloud");
  await page.locator("#cloud-method").selectOption("compare");
  await expect(page.locator("#lut-panel")).toBeVisible();
  await page.locator("#lut-resolution").selectOption("0.5");
  for (const [id, value] of [
    ["lut-xz-min", "-35"],
    ["lut-xz-max", "35"],
    ["lut-yz-min", "-35"],
    ["lut-yz-max", "35"],
  ])
    await page.locator(`#${id}`).fill(value);
  await page.locator("#generate-lut").click();
  await expect(page.locator("#lut-status")).toContainText("LUT ready", {
    timeout: 30000,
  });
  await expect(page.locator("#lut-total canvas").first()).toBeVisible();
  await page.locator("#cloud-file").setInputFiles({
    name: "raw.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("x,y,z,intensity\n0,0,5,42\n.5,.25,5,17\n"),
  });
  await page.locator("#correct-cloud").click();
  await expect(page.locator("#cloud-status")).toContainText(
    "2 analytical and 2 LUT",
    { timeout: 30000 },
  );
  await expect(page.locator("#cloud-stats")).toContainText(
    "Mean method difference",
  );
  await expect(
    page.locator("#cloud-method-range canvas").first(),
  ).toBeVisible();
  await page.locator("#cloud-view").selectOption("side");
  await expect(page.locator("#cloud3d-b")).toBeVisible();
  const cloudBox = await page.locator("#cloud3d canvas").boundingBox();
  await page.mouse.move(
    cloudBox.x + cloudBox.width / 2,
    cloudBox.y + cloudBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    cloudBox.x + cloudBox.width * 0.62,
    cloudBox.y + cloudBox.height * 0.42,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => page.locator("#cloud3d-b").getAttribute("data-camera"))
    .toBe(await page.locator("#cloud3d").getAttribute("data-camera"));
  await page.screenshot({ path: "test-results/lut-cloud.png", fullPage: true });
  const lutDownload = page.waitForEvent("download");
  await page.locator("#export-lut").click();
  expect((await lutDownload).suggestedFilename()).toBe(
    "enclosure-angular-lut.json",
  );
  await page.getByRole("tab", { name: /Scene lab/ }).click();
  await page.locator("#scene-auto").uncheck();
  await page.locator("#scene-correction-method").selectOption("compare");
  await page.locator("#simulate").click();
  await expect(page.locator("#scene-status")).toContainText("returns", {
    timeout: 30000,
  });
  await expect(page.locator("#scene-stats")).toContainText("LUT 3D RMSE");
  await expect(
    page.locator("#scene-method-difference canvas").first(),
  ).toBeVisible();
  await page.locator("#thickness").fill("6");
  await expect(page.locator("#scene-lut-status")).toContainText("stale", {
    timeout: 10000,
  });
  expect(errors).toEqual([]);
});
