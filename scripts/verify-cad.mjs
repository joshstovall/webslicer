import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
const root = resolve(process.argv[2] || "dist");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assets = await readdir(join(root, "assets"));
const wasm = assets.filter((name) => /^occt-import-js-.*\.wasm$/.test(name));
const worker = assets.filter((name) => /^step-worker-.*\.js$/.test(name));
if (wasm.length !== 1 || worker.length !== 1)
  throw new Error("Missing or ambiguous CAD worker/WASM assets.");
const upstream = await readFile(
  "node_modules/occt-import-js/dist/occt-import-js.wasm",
);
if (hash(upstream) !== hash(await readFile(join(root, "assets", wasm[0]))))
  throw new Error("CAD WASM differs from the pinned package.");
if (
  !(await readFile(join(root, "assets", worker[0]), "utf8")).includes(wasm[0])
)
  throw new Error("CAD worker references a different WASM.");
const main = assets.find((name) => /^index-.*\.js$/.test(name));
if (
  !main ||
  !(await readFile(join(root, "assets", main), "utf8")).includes(worker[0])
)
  throw new Error("App does not reference the packaged CAD worker.");
const manifest = JSON.parse(
  await readFile("public/cad/source-manifest.json", "utf8"),
);
for (const [name, expected] of Object.entries(manifest)) {
  const bytes = await readFile(join(root, "cad", name));
  if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256)
    throw new Error(`CAD source archive mismatch: ${name}`);
}
for (const name of await readdir("public/cad")) {
  if (
    hash(await readFile(join("public/cad", name))) !==
    hash(await readFile(join(root, "cad", name)))
  )
    throw new Error(`CAD notice/source missing or changed: ${name}`);
}
console.log(
  JSON.stringify({
    cadWorker: worker[0],
    cadWasm: wasm[0],
    wasmSha256: hash(upstream),
    sourceArchives: Object.keys(manifest).length,
  }),
);
