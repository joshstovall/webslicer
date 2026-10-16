import { expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { snapshotRuntime } from "../scripts/runtime-bundle.mjs";
import { engineEntry } from "../src/lib/engine-runtime";
const hash = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
function fixture(fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "stratum-runtime-"));
  try {
    mkdirSync(join(root, "engine"));
    mkdirSync(join(root, "wasm"));
    writeFileSync(
      join(root, "engine/bridge.html"),
      '<html><head></head><body><script type="module" src="./bridge.js"></script></body></html>',
    );
    writeFileSync(join(root, "engine/bridge.js"), 'import "./worker.js";');
    writeFileSync(
      join(root, "engine/worker.js"),
      'new URL("../wasm/test.wasm",import.meta.url);',
    );
    writeFileSync(
      join(root, "wasm/test.wasm"),
      new Uint8Array([0, 97, 115, 109]),
    );
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
it("captures a deterministic complete runtime and stamps only the packaged frame", () =>
  fixture((root) => {
    const source = readFileSync(join(root, "engine/bridge.html"));
    const runtime = snapshotRuntime(root);
    expect(runtime.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshotRuntime(root).revision).toBe(runtime.revision);
    expect(runtime.assets).toHaveLength(4);
    for (const file of runtime.assets) {
      expect(file.path).toMatch(
        new RegExp(`^runtime/${runtime.revision}/(?:engine|wasm)/`),
      );
      expect(hash(file.bytes)).toBe(file.sha256);
      expect(
        runtime.manifest.files.find((f: any) => f.path === file.path),
      ).toEqual({
        path: file.path,
        sha256: file.sha256,
        size: file.bytes.length,
      });
    }
    expect(
      runtime.assets
        .find((f: any) => f.path === runtime.manifest.entry)
        .bytes.toString(),
    ).toContain(`content="${runtime.revision}"`);
    expect(readFileSync(join(root, "engine/bridge.html"))).toEqual(source);
    writeFileSync(join(root, "engine/worker.js"), "changed after snapshot");
    expect(
      runtime.assets
        .find((f: any) => f.path.endsWith("/worker.js"))
        .bytes.toString(),
    ).toContain("../wasm/test.wasm");
  }));
it("changes the namespace when a helper, worker, WASM file, or relative filename changes", () =>
  fixture((root) => {
    const revisions = new Set([snapshotRuntime(root).revision]);
    for (const name of [
      "engine/helper.js",
      "engine/worker.js",
      "wasm/test.wasm",
      "engine/LICENSE.md",
    ]) {
      writeFileSync(join(root, name), "changed");
      const next = snapshotRuntime(root).revision;
      expect(revisions.has(next)).toBe(false);
      revisions.add(next);
    }
  }));
it("rejects unstamped frames and symlinked inputs instead of publishing an incomplete runtime", () =>
  fixture((root) => {
    writeFileSync(join(root, "engine/bridge.html"), "no document head");
    expect(() => snapshotRuntime(root)).toThrow(/document head/);
    writeFileSync(join(root, "engine/bridge.html"), "<head></head>");
    symlinkSync(join(root, "engine/worker.js"), join(root, "engine/alias.js"));
    expect(() => snapshotRuntime(root)).toThrow(/Unsupported runtime entry/);
  }));
it("keeps development URLs stable and isolates every production base path", () => {
  const revision = "a".repeat(64);
  expect(engineEntry("/", "development")).toBe("/engine/bridge.html");
  expect(engineEntry("/webslicer/", "development")).toBe(
    "/webslicer/engine/bridge.html",
  );
  expect(engineEntry("/", revision)).toBe(
    `/runtime/${revision}/engine/bridge.html`,
  );
  expect(engineEntry("/webslicer/", revision)).toBe(
    `/webslicer/runtime/${revision}/engine/bridge.html`,
  );
});

it("rejects a stale app, changed runtime bytes and a rewritten manifest under an unchanged namespace", async () => {
  const { verifyRuntime } = await import("../scripts/verify-runtime.mjs");
  const root = mkdtempSync(join(tmpdir(), "stratum-runtime-artifact-"));
  try {
    mkdirSync(join(root, "engine"));
    mkdirSync(join(root, "wasm"));
    writeFileSync(join(root, "engine/bridge.html"), "<head></head>");
    writeFileSync(join(root, "engine/worker.js"), "original worker");
    writeFileSync(join(root, "engine/bridge.js"), "bridge fixture");
    writeFileSync(join(root, "wasm/example.wasm"), "wasm fixture");
    const runtime = snapshotRuntime(root);
    for (const asset of runtime.assets) {
      mkdirSync(join(root, asset.path, ".."), { recursive: true });
      writeFileSync(join(root, asset.path), asset.bytes);
    }
    mkdirSync(join(root, "assets"));
    writeFileSync(
      join(root, "index.html"),
      '<script src="/webslicer/assets/index-test.js"></script>',
    );
    writeFileSync(join(root, "assets/index-test.js"), runtime.revision);
    const saveManifest = () =>
      writeFileSync(
        join(root, "runtime-manifest.json"),
        JSON.stringify(runtime.manifest),
      );
    saveManifest();
    expect((await verifyRuntime(root)).assets).toBe(4);
    writeFileSync(join(root, "assets/index-test.js"), "stale app");
    await expect(verifyRuntime(root)).rejects.toThrow(/different runtime/);
    writeFileSync(join(root, "assets/index-test.js"), runtime.revision);
    const worker = runtime.manifest.files.find((f: any) =>
      f.path.endsWith("worker.js"),
    )!;
    const replacement = Buffer.from("changed worker");
    writeFileSync(join(root, worker.path), replacement);
    await expect(verifyRuntime(root)).rejects.toThrow(/checksum mismatch/);
    worker.sha256 = hash(replacement);
    worker.size = replacement.length;
    saveManifest();
    await expect(verifyRuntime(root)).rejects.toThrow(/namespace/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
