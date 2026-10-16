import { test, expect } from "@playwright/test";

test("previously selected official profiles remain available after reload without GitHub connectivity", async ({
  page,
}) => {
  await page.goto("/");
  const first = await page.evaluate(async () => {
    const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
      "/src/lib/vendor-printers.ts"
    );
    return Promise.all(
      [VENDOR_PRINTERS[1], VENDOR_PRINTERS[5]].map(loadVendorPrinter),
    );
  });
  await page.reload();
  const requests: string[] = [];
  await page.route("https://raw.githubusercontent.com/**", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  const offline = await page.evaluate(async () => {
    const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
      "/src/lib/vendor-printers.ts"
    );
    return Promise.all(
      [VENDOR_PRINTERS[1], VENDOR_PRINTERS[5]].map((p) =>
        loadVendorPrinter({ ...p, name: "My printer", bed: [200, 200, 200] }),
      ),
    );
  });
  expect(requests).toEqual([]);
  for (let i = 0; i < first.length; i++) {
    expect(offline[i].startGcode).toBe(first[i].startGcode);
    expect(offline[i].endGcode).toBe(first[i].endGcode);
    expect(offline[i].toolChangeGcode).toBe(first[i].toolChangeGcode);
    expect(offline[i].name).toBe("My printer");
    expect(offline[i].bed).toEqual([200, 200, 200]);
  }
});

test("a partial saved profile is repaired and an unavailable uncached profile reports a load error", async ({
  page,
}) => {
  await page.goto("/");
  const repaired = await page.evaluate(async () => {
    const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
      "/src/lib/vendor-printers.ts"
    );
    const p = VENDOR_PRINTERS[5];
    return loadVendorPrinter({
      ...p,
      startGcode: "; incomplete",
      endGcode: "",
      toolChangeGcode: "",
    });
  });
  expect(repaired.startGcode).toContain("PRINT_START");
  expect(repaired.endGcode).toContain("PRINT_END");
  await page.route("https://raw.githubusercontent.com/**", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  const message = await page.evaluate(async () => {
    const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
      "/src/lib/vendor-printers.ts"
    );
    try {
      await loadVendorPrinter(VENDOR_PRINTERS[0]);
      return "unexpected success";
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(message).toContain("Could not load official printer profile (503)");
});
