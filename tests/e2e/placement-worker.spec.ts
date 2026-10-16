import { expect, test } from "@playwright/test";
test("geometry worker cancellation disposes work, including cancellation from the first progress callback", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const result = await page.evaluate(async () => {
    const { arrangePlate } = await import("/src/lib/placement.ts");
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
      options = { gap: 2, edge: 2, rotate: true };
    const cancelled = [];
    for (const stage of [
      "Loading outline arranger",
      "Projecting model outlines",
    ]) {
      const controller = new AbortController();
      try {
        await arrangePlate(
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
    const retry = await arrangePlate(
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
      parts: retry.length,
      unchanged: models.every((m) => m.position.every((v) => v === 0)),
    };
  });
  expect(result).toEqual({
    active: 0,
    created: 2,
    cancelled: ["AbortError", "AbortError"],
    parts: 2,
    unchanged: true,
  });
});
test("stalled geometry worker reaches its deadline and missing worker loads can be retried", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page.clock.install();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let blocked = false;
  await page.context().route(/placement-worker/, async (route) => {
    blocked = true;
    await held;
    await route.continue().catch(() => {});
  });
  await page.evaluate(async () => {
    const { arrangePlate } = await import("/src/lib/placement.ts");
    const { primitive } = await import("/src/lib/geometry.ts");
    const { PRINTERS } = await import("/src/lib/profiles.ts");
    (window as any).job = arrangePlate(
      [primitive("cube", 1)],
      PRINTERS[0],
      { gap: 2, edge: 2, rotate: true },
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
    const { arrangePlate } = await import("/src/lib/placement.ts");
    const { primitive } = await import("/src/lib/geometry.ts");
    const { PRINTERS } = await import("/src/lib/profiles.ts");
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(_url: string | URL, options?: WorkerOptions) {
        super(
          new URL("/missing-placement-worker-for-test.js", location.href),
          options,
        );
      }
    };
    try {
      await arrangePlate(
        [primitive("cube", 1)],
        PRINTERS[0],
        { gap: 2, edge: 2, rotate: true },
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
    const { arrangePlate } = await import("/src/lib/placement.ts");
    const { primitive } = await import("/src/lib/geometry.ts");
    const { PRINTERS } = await import("/src/lib/profiles.ts");
    return (
      await arrangePlate(
        [primitive("cube", 1)],
        PRINTERS[0],
        { gap: 2, edge: 2, rotate: true },
        new AbortController().signal,
        () => {},
      )
    ).length;
  });
  expect(count).toBe(1);
});
