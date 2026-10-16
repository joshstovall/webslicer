import { test, expect } from "@playwright/test";
test("printer uploads use the selected API and never request a print start", async ({
  page,
}) => {
  const posts: { url: string; body: string; key: string | undefined }[] = [];
  await page.route("http://printer.test/**", async (route) => {
    const req = route.request();
    if (req.method() === "POST")
      posts.push({
        url: req.url(),
        body: req.postData() || "",
        key: req.headers()["x-api-key"],
      });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
      body: JSON.stringify({ api: "0.1", result: { klippy_connected: true } }),
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Slice plate", exact: true }),
  ).toBeEnabled();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "test.gcode",
      mimeType: "text/plain",
      buffer: Buffer.from("G90\nM82\nG1 Z0.2\nG1 X10 Y10 E1 F1200\nG1 X20 E2"),
    });
  await page
    .getByRole("button", { name: "Connect printer", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Printer server URL" })
    .fill("http://printer.test");
  await page.getByLabel("API key", { exact: true }).fill("test-only-token");
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    page.getByText("Connected successfully.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Upload G-code", exact: true })
    .click();
  await expect(
    page.getByText(
      "G-code uploaded. Start the print from your printer interface.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0].url).toBe("http://printer.test/api/files/local");
  expect(posts[0].key).toBe("test-only-token");
  expect(posts[0].body).toMatch(/name="print"\r\n\r\nfalse/);
  expect(posts[0].body).toContain("G1 X20 E2");
  await page.getByText("Moonraker", { exact: true }).click();
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    page.getByText("Connected successfully.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Upload G-code", exact: true })
    .click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].url).toBe("http://printer.test/server/files/upload");
  expect(posts[1].body).not.toMatch(/name="print"\r\n\r\ntrue/);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "test-only-token",
  );
});
test("a missing engine asset reports an error instead of leaving a stuck slicing job", async ({
  page,
}) => {
  await page.route("**/engine/kiri-eng.js", (route) => route.abort());
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Slice plate", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  await expect(page.locator(".workspace-alert")).toContainText(
    "Could not load the slicing engine",
  );
  await expect(
    page.getByRole("button", { name: "Slice plate", exact: true }),
  ).toBeEnabled();
  await expect(
    page.locator('iframe[title="Local slicing engine"]'),
  ).toHaveCount(0);
});
