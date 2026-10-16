import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`filament setup, assignments, recovery, and color preview at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    // Seed geometry through the same persistence API used by project import.
    await page.evaluate(async () => {
      const { primitive } = await import("/src/lib/geometry.ts");
      const { saveLocal } = await import("/src/lib/project.ts");
      const { PRINTERS, DEFAULT_SETTINGS } =
        await import("/src/lib/profiles.ts");
      const a = primitive("cube", 1),
        b = primitive("cube", 1);
      a.name = "Left cube";
      b.name = "Right cube";
      a.scale = b.scale = [0.4, 0.4, 0.1];
      a.position = [-10, 0, 0];
      b.position = [10, 0, 0];
      await saveLocal({
        version: 1,
        name: "Two colors",
        models: [a, b],
        printer: PRINTERS.find((p) => p.id === "generic-multi")!,
        settings: { ...DEFAULT_SETTINGS, adhesion: "none" },
        plates: [1],
        activePlate: 1,
      });
    });
    await page.reload();
    if (width < 761)
      await page
        .getByRole("button", { name: "Print setup", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Manage filaments", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add filament", exact: true })
      .click();
    await page.getByRole("button", { name: "2. PLA 2", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Filament 2 name", exact: true })
      .fill("Blue PLA");
    await page
      .getByRole("textbox", { name: "Filament 2 temperature", exact: true })
      .fill("220");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    if (width < 761) {
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Objects 2", exact: true })
        .click();
    }
    await page
      .locator(".object-row:visible")
      .filter({ hasText: "Right cube" })
      .click();
    await page
      .getByRole("combobox", { name: "Object filament", exact: true })
      .click();
    await page
      .getByRole("option", { name: "2. Blue PLA", exact: true })
      .click();
    if (width < 761) await page.keyboard.press("Escape");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Slice plate", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Export G-code", exact: true }),
    ).toBeVisible({ timeout: 60000 });
    // On phones the preview card scrolls inside the workspace.
    await page
      .getByRole("combobox", { name: "Preview color scheme", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Color by filament", exact: true })
      .click();
    await expect(page.getByText(/2\. Blue PLA ·/)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/stratum-multicolor-${width}.png` });
  });
}
