import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
const fixture = async (path: string) => [
  ...(await readFile(`node_modules/occt-import-js/test/testfiles/${path}`)),
];
test("real CAD worker preserves units, face colors, assembly placement and quality", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const inputs = await Promise.all(
    [
      "cube-units/cube-mm.step",
      "cube-units/cube-m.step",
      "cube-units/cube-in.step",
      "cube-fcstd/cube.step",
      "cax-if/as1-tu-203.stp",
      "rounded-cube/rounded-cube.step",
    ].map(fixture),
  );
  const result = await page.evaluate(async (inputs) => {
    const { importStep } = await import("/src/lib/import-step.ts");
    const summary = (r: any) => ({
      palette: r.palette,
      models: r.models.map((m: any) => {
        const min = [Infinity, Infinity, Infinity],
          max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < m.positions.length; i++) {
          const a = i % 3;
          min[a] = Math.min(min[a], m.positions[i]);
          max[a] = Math.max(max[a], m.positions[i]);
        }
        return {
          min,
          max,
          triangles: m.positions.length / 9,
          tool: m.tool,
          colors: [...new Set(m.faceTools ?? [])],
          assembly: m.assemblyId,
          position: m.position,
        };
      }),
    });
    const outputs = [];
    for (const [i, bytes] of inputs.entries())
      outputs.push(
        summary(
          await importStep(
            new File([new Uint8Array(bytes)], "fixture.step"),
            1,
            { quality: "balanced", colors: true },
          ),
        ),
      );
    for (const quality of ["draft", "fine"])
      outputs.push(
        summary(
          await importStep(
            new File([new Uint8Array(inputs[5])], "rounded.step"),
            1,
            { quality, colors: false },
          ),
        ),
      );
    return outputs;
  }, inputs);
  for (const unit of result.slice(0, 3)) {
    expect(unit.models).toHaveLength(1);
    for (let a = 0; a < 3; a++)
      expect(unit.models[0].max[a] - unit.models[0].min[a]).toBeCloseTo(
        1000,
        3,
      );
  }
  expect(result[3].palette.map((p: any) => p.color).sort()).toEqual(
    ["#cccccc", "#ff0000", "#0000ff", "#00aa00"].sort(),
  );
  expect(result[3].models[0].colors).toHaveLength(4);
  expect(result[4].models).toHaveLength(18);
  expect(new Set(result[4].models.map((m: any) => m.assembly)).size).toBe(1);
  expect(
    new Set(result[4].models.map((m: any) => m.min.join(","))).size,
  ).toBeGreaterThan(1);
  expect(result[7].models[0].triangles).toBeGreaterThan(
    result[6].models[0].triangles,
  );
  expect(result[6].palette).toEqual([]);
});

test("CAD cancellation terminates work and malformed imports allow retry", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const bytes = await fixture("cube-10x10mm/Cube 10x10.stp");
  const result = await page.evaluate(async (bytes) => {
    const { importStep } = await import("/src/lib/import-step.ts");
    const NativeWorker = window.Worker;
    let active = 0,
      terminated = 0;
    window.Worker = class extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        active++;
      }
      terminate() {
        active--;
        terminated++;
        super.terminate();
      }
    };
    const file = new File([new Uint8Array(bytes)], "cube.step");
    const controller = new AbortController();
    let cancelled = "";
    try {
      await importStep(file, 1, {
        quality: "fine",
        colors: true,
        signal: controller.signal,
        onStage: (stage) => {
          if (stage.includes("tessellating")) controller.abort();
        },
      });
    } catch (error) {
      cancelled = (error as Error).name;
    }
    let malformed = "";
    try {
      await importStep(new File(["not CAD"], "bad.step"), 1);
    } catch (error) {
      malformed = (error as Error).message;
    }
    const retry = await importStep(file, 1);
    window.Worker = NativeWorker;
    return {
      cancelled,
      malformed,
      active,
      terminated,
      parts: retry.models.length,
    };
  }, bytes);
  expect(result.cancelled).toBe("AbortError");
  expect(result.malformed).toContain("No readable");
  expect(result.active).toBe(0);
  expect(result.terminated).toBe(3);
  expect(result.parts).toBe(1);
});

test("stalled CAD startup expires and a failed WASM fetch can be retried", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const bytes = await fixture("cube-10x10mm/Cube 10x10.stp");
  await page.clock.install();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/occt-import-js.*\.wasm/, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await page.evaluate(async (bytes) => {
    const { importStep } = await import("/src/lib/import-step.ts");
    (window as any).cadResult = importStep(
      new File([new Uint8Array(bytes)], "cube.step"),
      1,
    ).then(
      () => "unexpected success",
      (e: Error) => e.message,
    );
  }, bytes);
  await page.clock.fastForward(180001);
  expect(await page.evaluate(() => (window as any).cadResult)).toContain(
    "timed out",
  );
  release();
  await page.unrouteAll({ behavior: "wait" });
  await page.route(/occt-import-js.*\.wasm/, (route) => route.abort());
  const failure = await page.evaluate(async (bytes) => {
    const { importStep } = await import("/src/lib/import-step.ts");
    try {
      await importStep(new File([new Uint8Array(bytes)], "cube.step"), 1);
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  }, bytes);
  expect(failure).not.toBe("");
  await page.unrouteAll({ behavior: "wait" });
  const parts = await page.evaluate(async (bytes) => {
    const { importStep } = await import("/src/lib/import-step.ts");
    return (await importStep(new File([new Uint8Array(bytes)], "cube.step"), 1))
      .models.length;
  }, bytes);
  expect(parts).toBe(1);
});
