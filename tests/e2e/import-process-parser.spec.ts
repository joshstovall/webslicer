import { expect, test } from "@playwright/test";
import { process3mf } from "../fixtures/process-3mf";

test("malformed, excessive and oversized metadata retain geometry with explicit diagnostics", async ({
  page,
}) => {
  await page.goto("/");
  const fixtures = [
    "{not JSON",
    null,
    [],
    Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`key${i}`, i])),
    " ".repeat(4 * 1024 * 1024) + "{}",
  ];
  const data = fixtures.map((f) => Array.from(process3mf(f)));
  const results = await page.evaluate(async (fixtures) => {
    const { import3mf } = await import("/src/lib/import-3mf.ts");
    return fixtures.map((bytes) => {
      const imported = import3mf(new Uint8Array(bytes), "Invalid metadata", 1);
      return {
        models: imported.models.length,
        settings: imported.processSettings,
        warnings: imported.warnings,
      };
    });
  }, data);
  for (const result of results) {
    expect(result.models).toBe(1);
    expect(result.settings).toBeUndefined();
    expect(result.warnings.join()).toMatch(
      /settings could not be read|exceeds 4 MB/,
    );
  }
});

test("palette-only metadata stays a geometry/material import and scopes never override the global process", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { import3mf } = await import("/src/lib/import-3mf.ts");
      const { readProcessSettings, processImportPatch } = await import(
        "/src/lib/import-process.ts"
      );
      const { DEFAULT_SETTINGS, PRINTERS } = await import(
        "/src/lib/profiles.ts"
      );
      const imported = import3mf(new Uint8Array(bytes), "Scoped", 1);
      const report = readProcessSettings(
        imported.processSettings!,
        DEFAULT_SETTINGS,
        PRINTERS[0],
      );
      return {
        palette: imported.palette,
        report,
        patch: processImportPatch(
          report,
          report.entries.map((e) => e.id),
        ),
        warnings: imported.processWarnings,
      };
    },
    Array.from(
      process3mf(
        {
          filament_colour: ["#aabbcc"],
          filament_type: ["PLA"],
          filament_settings_id: ["Source spool"],
        },
        true,
      ),
    ),
  );
  expect(result.palette[0]).toMatchObject({
    color: "#aabbcc",
    name: "Source spool",
  });
  expect(result.report.entries).toHaveLength(0);
  expect(result.report.skipped).toHaveLength(0);
  expect(result.patch).toEqual({});
  expect(result.warnings.join()).toMatch(/wall_loops=8/);
  expect(result.warnings.join()).toMatch(/Painted seams/);
});
