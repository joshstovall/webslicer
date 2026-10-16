import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { snapshotRuntime } from "../../scripts/runtime-bundle.mjs";
import { primitive, mergedVertices } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";

const dist = resolve(process.env.TEST_RUNTIME_DIST || "dist");
const fixture = (supports: string) => {
  const cube = primitive("cube", 1);
  return {
    name: "Cached canopy.webslicer",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        name: "Cached canopy",
        plates: [1],
        activePlate: 1,
        printer: PRINTERS[0],
        settings: {
          ...DEFAULT_SETTINGS,
          supports,
          adhesion: "none",
          minLayerTime: 0,
          firstLayerHeight: 0.2,
        },
        models: [
          {
            ...cube,
            name: "Cached canopy",
            positions: [
              ...mergedVertices(
                [-6, 6].map((x) => ({
                  ...cube,
                  position: [x, 0, 14],
                  scale: [0.2, 0.2, 0.1],
                })),
              ),
            ],
          },
        ],
      }),
    ),
  };
};
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
async function importCanopy(page: Page, supports: string) {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture(supports));
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
}
async function releaseServer(legacy: boolean) {
  const manifest = JSON.parse(
    await readFile(join(dist, "runtime-manifest.json"), "utf8"),
  );
  const html = await readFile(join(dist, "index.html"), "utf8");
  const main = html.match(/src="([^"]*\/assets\/index-[^"]+\.js)"/)![1];
  const base = main.slice(0, main.indexOf("assets/"));
  const currentMain = await readFile(
    join(dist, main.slice(base.length)),
    "utf8",
  );
  expect(currentMain).toContain(manifest.revision);
  const temp = await mkdtemp(join(tmpdir(), "stratum-cached-release-"));
  await cp(resolve("public/engine"), join(temp, "engine"), { recursive: true });
  await cp(resolve("public/wasm"), join(temp, "wasm"), { recursive: true });
  const oldBridge = await readFile(join(temp, "engine/bridge.js"), "utf8");
  // This older engine can slice normally but lacks the new tree capability.
  await writeFile(
    join(temp, "engine/bridge.js"),
    `window.addEventListener("message",e=>{
    if(e.source===parent && e.data?.type==="slice" && e.data.process?.sliceSupportTree){
      e.stopImmediatePropagation();parent.postMessage({stratumEngine:true,type:"error",message:"Old runtime cannot generate branching supports"},location.origin);
    }
  },true);\n` + oldBridge,
  );
  const older = snapshotRuntime(temp),
    oldRevision = legacy ? "development" : older.revision;
  const olderAssets = new Map<string, Buffer>();
  for (const asset of older.assets) {
    const relative = asset.path.slice(`runtime/${older.revision}/`.length);
    olderAssets.set(base + asset.path, asset.bytes);
    olderAssets.set(
      base + relative,
      relative === "engine/bridge.html"
        ? await readFile(join(temp, relative))
        : asset.bytes,
    );
  }
  const olderMainPath = base + "assets/previous-release.js";
  const olderMain = currentMain.replaceAll(manifest.revision, oldRevision);
  const olderHtml = html.replace(main, olderMainPath);
  let current = false,
    fault: "" | "mismatch" | "silent" | "hang" = "";
  const hits = new Map<string, number>();
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url!, "http://localhost").pathname;
    hits.set(pathname, (hits.get(pathname) ?? 0) + 1);
    try {
      let bytes: Buffer | string;
      if (pathname === base || pathname === base + "index.html")
        bytes = current ? html : olderHtml;
      else if (pathname === olderMainPath) bytes = olderMain;
      else if (olderAssets.has(pathname)) bytes = olderAssets.get(pathname)!;
      else {
        const relative = pathname.slice(base.length);
        if (!pathname.startsWith(base) || relative.includes(".."))
          throw new Error("Invalid fixture path");
        bytes = await readFile(join(dist, relative));
        if (relative === manifest.entry && fault === "mismatch")
          bytes = bytes.toString().replace(manifest.revision, "0".repeat(64));
        if (relative === manifest.entry && fault === "silent")
          bytes = "<!doctype html><title>Missing release</title>";
        if (relative === manifest.entry && fault === "hang")
          bytes = `<!doctype html><title>Stalled job</title><body><script>
            let jobs=0;
            const ready=()=>parent.postMessage({stratumEngine:true,type:"ready",revision:${JSON.stringify(manifest.revision)}},location.origin);
            window.addEventListener("message",e=>{if(e.data?.type==="slice"){
              document.body.dataset.jobs=String(++jobs);ready();
            }});ready();
          </script></body>`;
      }
      const types: Record<string, string> = {
        ".js": "text/javascript",
        ".html": "text/html",
        ".css": "text/css",
        ".wasm": "application/wasm",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
      };
      res.setHeader(
        "Content-Type",
        pathname === base
          ? "text/html"
          : types[extname(pathname)] || "application/octet-stream",
      );
      res.setHeader(
        "Cache-Control",
        pathname === base || pathname.endsWith("index.html") || fault
          ? "no-store"
          : "public, max-age=3600",
      );
      res.end(bytes);
    } catch {
      res.statusCode = 404;
      res.end("Missing fixture asset");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}${base}`,
    base,
    manifest,
    oldRevision,
    hits,
    deploy: () => {
      current = true;
    },
    setFault: (value: typeof fault) => {
      fault = value;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(temp, { recursive: true, force: true });
    },
  };
}

for (const legacy of [true, false])
  test(`cached ${legacy ? "legacy" : "versioned"} runtime cannot override a newly deployed tree engine`, async ({
    page,
  }) => {
    if (!legacy) await page.setViewportSize({ width: 390, height: 844 });
    const server = await releaseServer(legacy);
    try {
      await page.goto(server.url);
      await expect(page.locator(".saved-indicator")).toContainText("Saved");
      await importCanopy(page, "auto");
      await button(page, "Slice plate").click();
      await expect(button(page, "Export G-code")).toBeVisible({
        timeout: 60000,
      });
      const oldEntry =
        server.base +
        (legacy ? "" : `runtime/${server.oldRevision}/`) +
        "engine/bridge.html";
      const hits = server.hits.get(oldEntry);
      expect(hits).toBe(1);
      await page.getByRole("button", { name: /^Prepare/ }).click();
      await importCanopy(page, "tree");
      await button(page, "Slice plate").click();
      await expect(page.locator(".workspace-alert")).toContainText(
        "Old runtime cannot generate branching supports",
      );
      // The same frame bytes really came from HTTP cache on the second attempt.
      expect(server.hits.get(oldEntry)).toBe(hits);
      server.deploy();
      const requested: string[] = [];
      page
        .context()
        .on("request", (r) => requested.push(new URL(r.url()).pathname));
      await page.reload();
      await expect(page.locator(".saved-indicator")).toContainText("Saved");
      await button(page, "Slice plate").click();
      await expect(button(page, "Export G-code")).toBeVisible({
        timeout: 60000,
      });
      const runtime = requested.filter((p) => /\/(?:engine|wasm)\//.test(p));
      expect(runtime.length).toBeGreaterThan(5);
      expect(
        runtime.every((p) =>
          p.startsWith(`${server.base}runtime/${server.manifest.revision}/`),
        ),
      ).toBe(true);
      for (const name of [
        "engine/bridge.html",
        "engine/bridge.js",
        "engine/kiri-eng.js",
        "engine/kiri-work.js",
        "engine/kiri-pool.js",
        "engine/tree-supports.js",
        "wasm/manifold.wasm",
      ])
        expect(
          server.hits.get(
            `${server.base}runtime/${server.manifest.revision}/${name}`,
          ),
          name,
        ).toBeGreaterThan(0);
      expect(
        await page.locator('iframe[title="Local slicing engine"]').count(),
      ).toBe(0);
      const download = page.waitForEvent("download");
      await button(page, "Export G-code").click();
      const code = await readFile((await (await download).path())!, "utf8");
      expect(code).toContain("STRATUM_PRINT_BEGIN");
      expect(code).toMatch(/;TYPE:support/);
    } finally {
      await server.close();
    }
  });

for (const failure of ["mismatch", "silent"] as const)
  test(`a ${failure} runtime fails before slicing and recovers without losing the project`, async ({
    page,
  }) => {
    const server = await releaseServer(false);
    server.deploy();
    server.setFault(failure);
    try {
      if (failure === "silent")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(server.url);
      await expect(page.locator(".saved-indicator")).toContainText("Saved");
      await importCanopy(page, "tree");
      if (failure === "silent") await page.clock.install();
      await button(page, "Slice plate").click();
      if (failure === "silent") {
        await expect(
          page.locator('iframe[title="Local slicing engine"]'),
        ).toHaveCount(1);
        await page.clock.fastForward(30_001);
      }
      await expect(page.locator(".workspace-alert")).toContainText(
        failure === "mismatch"
          ? "versions do not match"
          : "Could not load this app's slicing engine",
      );
      await expect(
        page.locator('iframe[title="Local slicing engine"]'),
      ).toHaveCount(0);
      await expect(button(page, "Slice plate")).toBeEnabled();
      await page.screenshot({
        path: `/tmp/stratum-runtime-error-${failure}.png`,
        animations: "disabled",
      });
      expect(
        server.hits.get(
          `${server.base}runtime/${server.manifest.revision}/engine/kiri-work.js`,
        ),
      ).toBeUndefined();
      server.setFault("");
      await button(page, "Slice plate").click();
      await expect(button(page, "Export G-code")).toBeVisible({
        timeout: 60000,
      });
      await expect(
        page.locator('iframe[title="Local slicing engine"]'),
      ).toHaveCount(0);
    } finally {
      await server.close();
    }
  });

test("ready clears the startup deadline, duplicate readiness does not restart a job, and the job deadline still recovers", async ({
  page,
}) => {
  const server = await releaseServer(false);
  server.deploy();
  server.setFault("hang");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(server.url);
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await importCanopy(page, "tree");
    await page.clock.install();
    await button(page, "Slice plate").click();
    const frame = page.frameLocator('iframe[title="Local slicing engine"]');
    await expect(frame.locator("body")).toHaveAttribute("data-jobs", "1");
    await page.clock.fastForward(30_001);
    await expect(frame.locator("body")).toHaveAttribute("data-jobs", "1");
    await expect(button(page, "Cancel")).toBeVisible();
    await page.clock.fastForward(570_000);
    await expect(page.locator(".workspace-alert")).toContainText(
      "Slicing timed out after 10 minutes",
    );
    await expect(
      page.locator('iframe[title="Local slicing engine"]'),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
    server.setFault("");
    await button(page, "Slice plate").click();
    await expect(button(page, "Export G-code")).toBeVisible({ timeout: 60000 });
  } finally {
    await server.close();
  }
});
