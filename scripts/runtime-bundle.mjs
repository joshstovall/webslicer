import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Capture the runtime once; its identity and emitted assets use the same bytes. */
export function snapshotRuntime(publicDir) {
  const files = [];
  function walk(relative) {
    for (const entry of readdirSync(join(publicDir, relative), {
      withFileTypes: true,
    })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile())
        files.push({ path, bytes: readFileSync(join(publicDir, path)) });
      else throw new Error(`Unsupported runtime entry: ${path}`);
    }
  }
  walk("engine");
  walk("wasm");
  if (!files.some((file) => file.path === "engine/bridge.html"))
    throw new Error("Runtime bridge is missing.");
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const marker = "__STRATUM_RUNTIME_REVISION__";
  for (const file of files) {
    if (file.path !== "engine/bridge.html") continue;
    const html = file.bytes.toString("utf8");
    if (!html.includes("</head>"))
      throw new Error("Runtime bridge has no document head.");
    file.bytes = Buffer.from(
      html.replace(
        "</head>",
        `<meta name="stratum-runtime-revision" content="${marker}"></head>`,
      ),
    );
  }
  // Hash the stamped frame template too: changing packaging must change URLs.
  const revision = digest(
    JSON.stringify(files.map((f) => [f.path, digest(f.bytes)])),
  );
  const prefix = `runtime/${revision}/`;
  const assets = files.map(({ path, bytes }) => {
    if (path === "engine/bridge.html") {
      bytes = Buffer.from(bytes.toString("utf8").replace(marker, revision));
    }
    return { path: prefix + path, bytes, sha256: digest(bytes) };
  });
  return {
    revision,
    assets,
    manifest: {
      format: 1,
      revision,
      entry: prefix + "engine/bridge.html",
      files: assets.map(({ path, sha256, bytes }) => ({
        path,
        sha256,
        size: bytes.length,
      })),
    },
  };
}

/** Preserve relative module/worker/WASM URLs beneath one immutable directory. */
export function runtimeBundlePlugin(snapshot) {
  return {
    name: "stratum-versioned-runtime",
    apply: "build",
    generateBundle() {
      for (const asset of snapshot.assets)
        this.emitFile({
          type: "asset",
          fileName: asset.path,
          source: asset.bytes,
        });
      this.emitFile({
        type: "asset",
        fileName: "runtime-manifest.json",
        source: JSON.stringify(snapshot.manifest, null, 2) + "\n",
      });
    },
  };
}
