import { test, expect } from "@playwright/test";

test("pinned vendor changes preserve early-layer clearance and cap tall-print lifts", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
      "/src/lib/vendor-printers.ts"
    );
    const { compileMachineGcode } = await import("/src/lib/machine-gcode.ts");
    const { DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const results = [];
    for (const preset of VENDOR_PRINTERS) {
      const p = await loadVendorPrinter(preset);
      const source = [
        ";STRATUM_INITIAL_TOOL:0",
        ";STRATUM_PRINT_BEGIN",
        "G90",
        "M83",
        ";LAYER:0",
        "G1 X50 Y50 Z0.2 F1200",
        "G1 X60 E1",
        "G1 E-0.8 F1800",
        ";STRATUM_TOOL_CHANGE:0:1",
        "T1",
        ";STRATUM_TOOL_READY",
        "G1 E0.8 F1800",
        "G1 Y60 E1 F1200",
        ";LAYER:1",
        `G1 Z${p.bed[2] - 1}`,
        "G1 X50 E1",
        "G1 E-0.8 F1800",
        ";STRATUM_TOOL_CHANGE:1:0",
        "T0",
        ";STRATUM_TOOL_READY",
        "G1 E0.8 F1800",
        "G1 Y50 E1",
        ";STRATUM_PRINT_END",
      ].join("\n");
      const output = compileMachineGcode(
        source,
        p,
        DEFAULT_SETTINGS,
        [
          defaultFilament(DEFAULT_SETTINGS),
          defaultFilament(DEFAULT_SETTINGS, 1),
        ],
        DEFAULT_MULTI_MATERIAL,
      );
      const changes = [
        ...output.matchAll(
          /;STRATUM_MACHINE_CHANGE_BEGIN\n([\s\S]*?);STRATUM_MACHINE_CHANGE_END/g,
        ),
      ].map((m) => m[1]);
      results.push({
        id: p.id,
        maxZ: p.bed[2],
        changes: changes.map((change) => {
          let absolute = true;
          const heights: number[] = [];
          for (const line of change.split("\n")) {
            const code = line.split(";")[0].trim();
            if (code === "G90") absolute = true;
            if (code === "G91") absolute = false;
            const z = code.match(/^G[01]\s.*?\bZ(-?[\d.]+)/);
            if (absolute && z) heights.push(Number(z[1]));
          }
          return {
            heights,
            restored: /G1 X60 Y50 .*\nG1 Z0.2 F600\nG1 F1800/.test(change),
          };
        }),
      });
    }
    return results;
  });
  expect(results).toHaveLength(6);
  for (const result of results) {
    expect(result.changes).toHaveLength(2);
    const early = result.changes[0];
    expect(early.restored, result.id).toBe(true);
    expect(early.heights.length).toBeGreaterThan(1);
    expect(Math.max(...early.heights), result.id).toBeLessThanOrEqual(3.2);
    expect(Math.max(...result.changes[1].heights), result.id).toBe(result.maxZ);
  }
});
