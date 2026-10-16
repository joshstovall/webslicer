// Vite replaces this at build time. Development modules keep their stable URLs.
export const ENGINE_REVISION =
  typeof __STRATUM_RUNTIME_REVISION__ === "string"
    ? __STRATUM_RUNTIME_REVISION__
    : "development";
export const ENGINE_STARTUP_TIMEOUT = 30_000;
export function engineEntry(base: string, revision = ENGINE_REVISION) {
  return `${base}${revision === "development" ? "" : `runtime/${revision}/`}engine/bridge.html`;
}
