import { expect, test } from "@playwright/test";
test("orientation worker cancellation disposes work, including cancellation from the first progress callback", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const result = await page.evaluate(async () => {
    const { findOrientations } = await import("/src/lib/orientation.ts");
    const { primitive } = await import("/src/lib/geometry.ts");
    const { PRINTERS } = await import("/src/lib/profiles.ts");
    const Native = window.Worker;
    let active = 0,
      created = 0;
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        active++;
        created++;
      }
      terminate() {
        active--;
        super.terminate();
      }
    };
    const models = [primitive("cube", 1), primitive("cube", 1)],
      options = { edge: 2, angle: 50, priority: "balanced" };
    const cancelled = [];
    for (const stage of [
      "Loading orientation search",
      "Combining visible assembly surfaces",
    ]) {
      const controller = new AbortController();
      try {
        await findOrientations(
          models,
          PRINTERS[0],
          options,
          controller.signal,
          (_n: number, label: string) => {
            if (label === stage) controller.abort();
          },
        );
      } catch (e) {
        cancelled.push((e as Error).name);
      }
    }
    const retry = await findOrientations(
      models,
      PRINTERS[0],
      options,
      new AbortController().signal,
      () => {},
    );
    window.Worker = Native;
    return {
      active,
      created,
      cancelled,
      parts: retry.candidates.length,
      unchanged: models.every((m) => m.position.every((v) => v === 0)),
    };
  });
  expect(result).toEqual({
    active: 0,
    created: 2,
    cancelled: ["AbortError", "AbortError"],
    parts: 6,
    unchanged: true,
  });
});
test("stalled orientation worker reaches its deadline and missing worker loads can be retried", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page.clock.install();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let blocked = false;
  await page.context().route(/orientation-worker/, async (route) => {
    blocked = true;
    await held;
    await route.continue().catch(() => {});
  });
  await page.evaluate(async () => {
    const { findOrientations } = await import("/src/lib/orientation.ts");
    const { primitive } = await import("/src/lib/geometry.ts");
    const { PRINTERS } = await import("/src/lib/profiles.ts");
    (window as any).job = findOrientations(
      [primitive("cube", 1)],
      PRINTERS[0],
      { edge: 2, angle: 50, priority: "balanced" },
      new AbortController().signal,
      () => {},
    ).then(
      () => "",
      (e: Error) => e.message,
    );
  });
  await expect.poll(() => blocked).toBe(true);
  await page.clock.fastForward(180001);
  expect(await page.evaluate(() => (window as any).job)).toContain("timed out");
  release();
  await page.context().unrouteAll({ behavior: "wait" });
  const failure = await page.evaluate(async () => {
    const { findOrientations } = await import("/src/lib/orientation.ts");
    const { primitive } = await import("/src/lib/geometry.ts");
    const { PRINTERS } = await import("/src/lib/profiles.ts");
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(_url: string | URL, options?: WorkerOptions) {
        super(
          new URL("/missing-orientation-worker-for-test.js", location.href),
          options,
        );
      }
    };
    try {
      await findOrientations(
        [primitive("cube", 1)],
        PRINTERS[0],
        { edge: 2, angle: 50, priority: "balanced" },
        new AbortController().signal,
        () => {},
      );
      return "";
    } catch (e) {
      return (e as Error).message;
    } finally {
      window.Worker = NativeWorker;
    }
  });
  expect(failure).not.toBe("");
  const count = await page.evaluate(async () => {
    const { findOrientations } = await import("/src/lib/orientation.ts");
    const { primitive } = await import("/src/lib/geometry.ts");
    const { PRINTERS } = await import("/src/lib/profiles.ts");
    return (
      await findOrientations(
        [primitive("cube", 1)],
        PRINTERS[0],
        { edge: 2, angle: 50, priority: "balanced" },
        new AbortController().signal,
        () => {},
      )
    ).candidates.length;
  });
  expect(count).toBe(6);
});
