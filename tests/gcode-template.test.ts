import { describe, it, expect } from "vitest";
import { expression, renderGcodeTemplate } from "../src/lib/gcode-template";
describe("vendor G-code template interpreter", () => {
  it("resolves indexed temperatures, arithmetic, comparisons and ternaries", () => {
    const context = {
      temperature: [215, 240],
      next_extruder: 1,
      material: ["PLA", "PETG"],
      speed: 60,
    };
    expect(expression("temperature[next_extruder] - 20", context)).toBe(220);
    expect(expression('material[1] == "PETG" && speed <= 60', context)).toBe(
      true,
    );
    expect(expression("min(speed * 60, 1800)", context)).toBe(1800);
    expect(expression("speed > 50 ? 10 : 20", context)).toBe(10);
  });
  it("renders nested and inline branches without evaluating unused expressions", () => {
    const code = renderGcodeTemplate(
      "{if next_extruder == 1}M104 S{temperature[next_extruder]}{if bed > 40}\nM140 S[bed]{endif}{elsif next_extruder == 2}{missing_variable}{else}M104 S0{endif}",
      { next_extruder: 1, temperature: [210, 240], bed: 60 },
    );
    expect(code).toBe("M104 S240\nM140 S60");
    expect(
      renderGcodeTemplate("M109 S[temperature[next_extruder]]", {
        temperature: [215, 240],
        next_extruder: 1,
      }),
    ).toBe("M109 S240");
  });
  it("supports double-encoded vendor line breaks and text comparisons", () => {
    expect(
      renderGcodeTemplate('{if material==\\"PLA\\"}M104 S200\\nM83{endif}', {
        material: "PLA",
      }),
    ).toBe("M104 S200\nM83");
  });
  it("fails closed on invalid variables, arithmetic, syntax and executable JavaScript", () => {
    for (const code of [
      "{unknown}",
      "{temperature[8]}",
      "{1/0}",
      "{window.alert(1)}",
      "{if true}M104 S200",
      "{endif}",
    ])
      expect(() => renderGcodeTemplate(code, { temperature: [210] })).toThrow();
  });
});
