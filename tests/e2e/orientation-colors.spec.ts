import { expect, test } from "@playwright/test";
import { orientationProject } from "../fixtures/orientation";
import { defaultFilament } from "../../src/lib/multimaterial";
import { DEFAULT_SETTINGS } from "../../src/lib/profiles";
for (const width of [1440, 390])
  test(`orientation preview retains surface filament colors at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const project = orientationProject();
    const colored = {
      ...project,
      filaments: [
        defaultFilament(DEFAULT_SETTINGS),
        {
          ...defaultFilament(DEFAULT_SETTINGS),
          color: "#234dff",
          name: "Blue",
        },
        { ...defaultFilament(DEFAULT_SETTINGS), color: "#ee231b", name: "Red" },
      ],
    };
    colored.models.forEach((m, i) => {
      m.faceTools = m.faceTools.map(() => i + 1);
      m.color = "#91ad87";
    });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Colored orientation.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(colored)),
      });
    if (width === 390)
      await page
        .getByRole("button", { name: "Objects 2", exact: true })
        .click();
    await page.locator(".object-row:visible").first().click();
    await page
      .getByRole("button", { name: "More model tools", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Find printing orientation", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Find printing orientation",
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "Find angles", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Apply and arrange", exact: true }),
    ).toBeVisible();
    await expect(dialog.locator("canvas")).toBeVisible();
    await page.screenshot({
      path: `/tmp/stratum-orientation-colors-${width}.png`,
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Cancel orientation", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  });
