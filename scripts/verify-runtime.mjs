import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const marker = "__STRATUM_RUNTIME_REVISION__";

/** Verify the deployable artifact, including its content-addressed namespace. */
export async function verifyRuntime(directory) {
  const root = resolve(directory);
  const manifest = JSON.parse(
    await readFile(join(root, "runtime-manifest.json"), "utf8"),
  );
  if (
    manifest.format !== 1 ||
    !/^[a-f0-9]{64}$/.test(manifest.revision) ||
    !Array.isArray(manifest.files)
  )
    throw new Error("Invalid runtime manifest.");
  const prefix = `runtime/${manifest.revision}/`,
    seen = new Set(),
    inputs = [];
  if (manifest.entry !== prefix + "engine/bridge.html")
    throw new Error("Invalid runtime entry.");
  for (const file of manifest.files) {
    if (
      typeof file.path !== "string" ||
      !file.path.startsWith(prefix) ||
      file.path.includes("..") ||
      file.path.includes("\\") ||
      seen.has(file.path)
    )
      throw new Error("Invalid or duplicate runtime asset path.");
    seen.add(file.path);
    const bytes = await readFile(join(root, file.path));
    if (bytes.length !== file.size || digest(bytes) !== file.sha256)
      throw new Error(`Runtime checksum mismatch: ${file.path}`);
    const relative = file.path.slice(prefix.length);
    if (!/^(engine|wasm)\//.test(relative))
      throw new Error("Asset is outside the engine/WASM directories.");
    let canonical = bytes;
    if (file.path === manifest.entry) {
      const stamp = `<meta name="stratum-runtime-revision" content="${manifest.revision}">`;
      const html = bytes.toString("utf8");
      if (html.split(stamp).length !== 2)
        throw new Error("Runtime frame identity is missing or duplicated.");
      canonical = Buffer.from(
        html.replace(
          stamp,
          `<meta name="stratum-runtime-revision" content="${marker}">`,
        ),
      );
    }
    inputs.push([relative, digest(canonical)]);
  }
  if (!seen.has(manifest.entry) || !seen.has(prefix + "engine/bridge.js"))
    throw new Error("Runtime bridge files are missing.");
  async function walk(relative) {
    for (const entry of await readdir(join(root, relative), {
      withFileTypes: true,
    })) {
      const path = relative + "/" + entry.name;
      if (entry.isDirectory()) await walk(path);
      else if (!entry.isFile() || !seen.has(path))
        throw new Error(`Unlisted runtime asset: ${path}`);
    }
  }
  await walk(prefix.slice(0, -1));
  inputs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (digest(JSON.stringify(inputs)) !== manifest.revision)
    throw new Error("Runtime namespace does not match its contents.");
  const html = await readFile(join(root, "index.html"), "utf8");
  const main = html.match(/src="[^\"]*\/(assets\/index-[^\"]+\.js)"/)?.[1];
  if (!main || main.includes(".."))
    throw new Error("Production app entry is missing.");
  if (!(await readFile(join(root, main), "utf8")).includes(manifest.revision))
    throw new Error("App references a different runtime revision.");
  return { revision: manifest.revision, assets: seen.size };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await verifyRuntime(process.argv[2] || "dist");
  console.log(`Verified runtime ${result.revision} (${result.assets} files).`);
}
