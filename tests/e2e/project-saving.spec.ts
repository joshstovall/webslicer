import { expect, test } from "@playwright/test";

test("an older completed save cannot mark a newer project as saved", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  // Hold only transaction-completion callbacks, while actual IndexedDB writes
  // finish normally. This deterministically exposes a stale completion race.
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      IDBTransaction.prototype,
      "oncomplete",
    )!;
    (window as any).pendingProjectSaves = [];
    Object.defineProperty(IDBTransaction.prototype, "oncomplete", {
      configurable: true,
      get: descriptor.get,
      set(callback) {
        if (
          typeof callback === "function" &&
          this.mode === "readwrite" &&
          this.objectStoreNames.contains("keyval")
        )
          descriptor.set!.call(this, (event: Event) =>
            (window as any).pendingProjectSaves.push(() =>
              callback.call(this, event),
            ),
          );
        else descriptor.set!.call(this, callback);
      },
    });
  });
  await page
    .getByRole("button", { name: "Add build plate", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).pendingProjectSaves.length))
    .toBe(1);
  await page
    .getByRole("button", { name: "Add build plate", exact: true })
    .click();
  await page.evaluate(() => (window as any).pendingProjectSaves.shift()());
  await expect(page.locator(".saved-indicator")).toHaveText(/Saving/);
  await expect
    .poll(() => page.evaluate(() => (window as any).pendingProjectSaves.length))
    .toBe(1);
  await expect(page.locator(".saved-indicator")).toHaveText(/Saving/);
  await page.evaluate(() => (window as any).pendingProjectSaves.shift()());
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page.reload();
  await expect(page.getByRole("button", { name: /^Plate 3/ })).toHaveClass(
    /active/,
  );
});
