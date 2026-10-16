import { expect, it } from "vitest";
import {
  parseArrangeOptions,
  DEFAULT_ARRANGE_OPTIONS,
} from "../src/lib/arrange-preferences";
it("restores valid zero-clearance and disabled-rotation preferences", () => {
  expect(parseArrangeOptions({ gap: 0, edge: 1.25, rotate: false })).toEqual({
    gap: 0,
    edge: 1.25,
    rotate: false,
  });
});
it("keeps invalid or legacy browser preferences from entering the placement job", () => {
  for (const value of [null, [], true, "text", {}])
    expect(parseArrangeOptions(value)).toEqual(DEFAULT_ARRANGE_OPTIONS);
  expect(parseArrangeOptions({ gap: NaN, edge: 101, rotate: "false" })).toEqual(
    DEFAULT_ARRANGE_OPTIONS,
  );
  expect(
    parseArrangeOptions({ gap: -1, edge: Infinity, rotate: false }),
  ).toEqual({ ...DEFAULT_ARRANGE_OPTIONS, rotate: false });
  expect(
    parseArrangeOptions({ gap: 3, edge: 2, rotate: true, other: 42 }),
  ).toEqual({ gap: 3, edge: 2, rotate: true });
});
