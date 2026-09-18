import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("designer, materials, beam inspection and atlas", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#geometry .svg-container")).toBeVisible();
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
  await expect(page.locator("#beam3d .svg-container")).toBeVisible();
  await page.locator('[data-focus="beam-a"][data-hit="inner"]').click();
  await page.locator('[data-expand="beam3d"]').click();
  await expect(page.locator("#plot-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#plot-dialog")).toBeHidden();
  await page.getByRole("tab", { name: /Deflection atlas/ }).click();
  await expect(page.locator("#heatmap .svg-container")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/atlas.png", fullPage: true });
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
  await expect(page.locator("#cloud-status")).toContainText("2 / 3 valid");
  const download = page.waitForEvent("download");
  await page.locator("#export-pcd").click();
  expect((await download).suggestedFilename()).toBe("corrected.pcd");
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
  await page.locator("#remove-station").click();
  await page.locator("#load-scene").setInputFiles({
    name: "scene.json",
    mimeType: "application/json",
    buffer: sceneFile,
  });
  await expect(page.locator("#station-list option")).toHaveCount(2);
  await expect(page.locator("#material")).toHaveValue("pc");
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
  await expect(page.locator("#geometry .svg-container")).toBeVisible();
  await page.locator("#toggle-controls").click();
  await page.locator("#ox").fill("200");
  await expect(page.locator("#error")).toContainText("inside");
  await page.locator("#reset").click();
  await expect(page.locator("#error")).toBeHidden();
  await page.locator("#toggle-controls").click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
