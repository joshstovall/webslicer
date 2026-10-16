import { describe, expect, it } from "vitest";
import { cadColor, convertStep, type CadMesh } from "../src/lib/step-mesh";
const mesh = (offset = 0): CadMesh => ({
  name: "part",
  attributes: {
    position: { array: [offset, 0, 10, offset + 1, 0, 10, offset, 1, 11] },
  },
  index: { array: [0, 1, 2] },
});
const options = { quality: "balanced" as const, colors: true };
describe("STEP mesh conversion", () => {
  it("converts linear OCCT colors to sRGB", () => {
    expect(cadColor([0.603827357, 0.603827357, 0.603827357])).toBe("#cccccc");
    expect(cadColor([0, 0.401977807, 0])).toBe("#00aa00");
    expect(() => cadColor([NaN, 0, 0])).toThrow("invalid");
  });
  it("grounds an assembly with one shared origin and retains relative placement", () => {
    const result = convertStep(
      { success: true, meshes: [mesh(0), mesh(20)] },
      "CAD",
      3,
      options,
    );
    expect(result.models[0].assemblyId).toBe(result.models[1].assemblyId);
    expect(result.models[0].positions[2]).toBe(0);
    expect(result.models[1].positions[0] - result.models[0].positions[0]).toBe(
      20,
    );
    expect(result.models.map((m) => m.plate)).toEqual([3, 3]);
  });
  it("uses inclusive triangle ranges, compacts unused colors, and selects the dominant interior material", () => {
    const m = mesh();
    m.index.array = [0, 1, 2, 0, 1, 2, 0, 1, 2];
    m.brep_faces = [
      { first: 0, last: 1, color: [1, 0, 0] },
      { first: 2, last: 2, color: [0, 0, 1] },
    ];
    const result = convertStep(
      { success: true, meshes: [m] },
      "CAD",
      1,
      options,
    );
    expect(result.palette.map((p) => p.color)).toEqual(["#ff0000", "#0000ff"]);
    expect(result.models[0].tool).toBe(0);
    expect([...result.models[0].faceTools!]).toEqual([0, 0, 1]);
  });
  it("can ignore CAD colors without creating filament slots", () => {
    const m = mesh();
    m.color = [NaN, 1, 1];
    const result = convertStep({ success: true, meshes: [m] }, "CAD", 1, {
      ...options,
      colors: false,
    });
    expect(result.palette).toEqual([]);
    expect(result.models[0].faceTools).toBeUndefined();
  });
  it("rejects malformed, empty and excessive results before expanding geometry", () => {
    expect(() => convertStep({ success: false }, "CAD", 1, options)).toThrow(
      "No readable",
    );
    expect(() =>
      convertStep(
        { success: true, meshes: Array.from({ length: 201 }, () => mesh()) },
        "CAD",
        1,
        options,
      ),
    ).toThrow("200 parts");
    for (const index of [-1, 0.5, 3, NaN]) {
      const m = mesh();
      m.index.array[0] = index;
      expect(() =>
        convertStep({ success: true, meshes: [m] }, "CAD", 1, options),
      ).toThrow("index");
    }
    const m = mesh();
    m.attributes.position.array[0] = Infinity;
    expect(() =>
      convertStep({ success: true, meshes: [m] }, "CAD", 1, options),
    ).toThrow("coordinates");
    m.attributes.position.array[0] = 0;
    m.index.array = new Array(6_000_003).fill(0);
    expect(() =>
      convertStep({ success: true, meshes: [m] }, "CAD", 1, options),
    ).toThrow("two million");
  });
  it("rejects invalid face ranges and palette overflow explicitly", () => {
    const m = mesh();
    m.brep_faces = [{ first: 0, last: 1, color: [1, 0, 0] }];
    expect(() =>
      convertStep({ success: true, meshes: [m] }, "CAD", 1, options),
    ).toThrow("face color range");
    const meshes = Array.from({ length: 65 }, (_, i) => ({
      ...mesh(),
      color: [i / 64, 0, 0],
    }));
    expect(() =>
      convertStep({ success: true, meshes }, "CAD", 1, options),
    ).toThrow("64 colors");
  });
});
