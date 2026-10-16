import { test, expect } from "@playwright/test";
import { primitive } from "../../src/lib/geometry";
import { PRINTERS, DEFAULT_SETTINGS } from "../../src/lib/profiles";
import { defaultFilament } from "../../src/lib/multimaterial";

test("X1C supply voltage persists on phones and changes the allowed bed target", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const model = primitive("cube", 1);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "X1C thermal.webslicer",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          name: "X1C thermal",
          plates: [1],
          activePlate: 1,
          printer: PRINTERS.find((p) => p.id === "bambu-x1c"),
          settings: { ...DEFAULT_SETTINGS, bedTemp: 115, firstBedTemp: 115 },
          filaments: [defaultFilament(DEFAULT_SETTINGS)],
          models: [{ ...model, positions: [...model.positions] }],
        }),
      ),
    });
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  await expect(page.locator(".workspace-alert")).toContainText(
    "between 0 and 110°C",
  );
  await page.getByRole("button", { name: "Print setup", exact: true }).click();
  await page.getByRole("button", { name: "Edit printer", exact: true }).click();
  await page
    .getByRole("combobox", { name: "X1 Carbon mains supply", exact: true })
    .click();
  await page.getByRole("option", { name: "110 V", exact: true }).click();
  await page.getByRole("button", { name: "Save printer", exact: true }).click();
  // Saving can fetch uncached machine sequences; wait for the transaction
  // to finish before closing the underlying drawer or reloading the page.
  await expect(
    page.getByRole("dialog", { name: "Printer configuration" }),
  ).not.toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Print setup", exact: true }).click();
  await page
    .getByRole("button", { name: "Temperature & cooling", exact: false })
    .click();
  const bed = page.getByRole("textbox", { name: "Bed", exact: true });
  await expect(bed).toHaveValue("115 °C");
  await expect(bed).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Edit printer", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "X1 Carbon mains supply", exact: true }),
  ).toHaveValue("110 V");
  await page
    .getByRole("combobox", { name: "X1 Carbon mains supply", exact: true })
    .click();
  await page.getByRole("option", { name: "220 V", exact: true }).click();
  await page.getByRole("button", { name: "Save printer", exact: true }).click();
  // Saving can fetch uncached machine sequences; wait for the transaction
  // to finish before closing the underlying drawer or reloading the page.
  await expect(
    page.getByRole("dialog", { name: "Printer configuration" }),
  ).not.toBeVisible();
  await expect(bed).toHaveAttribute("aria-invalid", "true");
  await expect(bed).toHaveValue("115 °C");
});
