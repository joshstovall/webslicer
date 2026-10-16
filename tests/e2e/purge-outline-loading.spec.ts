import { test, expect } from "@playwright/test";
import { purgeFrameProject } from "../fixtures/purge-outlines";
test("a missing footprint module fails clearly and a fresh slice can recover", async ({
  page,
}) => {
  await page.route("**/engine/purge-footprints.js", (route) => route.abort());
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "Frame.webslicer",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(purgeFrameProject())),
    });
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  await expect(
    page.getByText(
      /slicing worker could not load|Could not load the slicing engine/i,
    ),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.locator('iframe[title="Local slicing engine"]'),
  ).toHaveCount(0);
  await page.unroute("**/engine/purge-footprints.js");
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export G-code", exact: true }),
  ).toBeVisible({ timeout: 60000 });
});
