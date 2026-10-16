import { expect, it } from "vitest";
import {
  SUPPORT_INTERFACE_LIMITS,
  supportInterfaceSettings,
  supportInterfaceErrors,
} from "../src/lib/support-interface-settings";
import {
  DEFAULT_SETTINGS,
  PRINTERS,
  processProfile,
} from "../src/lib/profiles";
import { validateProject } from "../src/lib/project";
import { slicePlate } from "../src/lib/slicer";
const project = {
  version: 1,
  name: "Interfaces",
  plates: [1],
  activePlate: 1,
  models: [],
  printer: PRINTERS[0],
  settings: { ...DEFAULT_SETTINGS },
};
it("keeps older projects unchanged until interfaces are enabled", () => {
  expect(supportInterfaceSettings(validateProject(project).settings)).toEqual({
    supportTopInterfaceLayers: 0,
    supportBottomInterfaceLayers: 0,
    supportInterfaceDensity: 80,
    supportInterfaceAngle: 0,
  });
  const settings = {
    ...DEFAULT_SETTINGS,
    supportTopInterfaceLayers: 3,
    supportBottomInterfaceLayers: 2,
    supportInterfaceDensity: 90,
    supportInterfaceAngle: 45,
  };
  expect(validateProject({ ...project, settings }).settings).toMatchObject(
    settings,
  );
  expect(processProfile(settings)).toMatchObject({
    stratumSupportTopLayers: 3,
    stratumSupportBottomLayers: 2,
    stratumSupportInterfaceDensity: 0.9,
    stratumSupportInterfaceAngle: 45,
  });
});
it("rejects malformed interface values in portable projects and presets", () => {
  for (const [key, [min, max]] of Object.entries(SUPPORT_INTERFACE_LIMITS))
    for (const value of [
      NaN,
      Infinity,
      null,
      "2",
      min - 1,
      max + 1,
      ...(key.endsWith("Layers") ? [1.5] : []),
    ]) {
      const settings = { ...DEFAULT_SETTINGS, [key]: value };
      expect(supportInterfaceErrors(settings).length).toBeGreaterThan(0);
      expect(() => validateProject({ ...project, settings })).toThrow(
        /support interface/,
      );
    }
});
it("rejects invalid direct slicing requests before starting a worker", async () => {
  await expect(
    slicePlate(
      [],
      PRINTERS[0],
      { ...DEFAULT_SETTINGS, supportTopInterfaceLayers: 2.5 },
      () => {},
      new AbortController().signal,
    ),
  ).rejects.toThrow(/support interface/);
});
