import { expect, it } from "vitest";
import { trimPurgeTower } from "../public/engine/purge-planner.js";

const travel = (type?: string) => ({
  type,
  emit: 0,
  point: { x: 1, y: 2, z: 3 },
});
const extrude = (type?: string) => ({ ...travel(type), emit: 1 });
const layer = (records: ReturnType<typeof travel>[], index: number) =>
  Object.assign(records, {
    height: 0.2,
    z: (index + 1) * 0.2,
    layer: index,
    slice: { index },
    params: { speed: 40 },
  });

it("keeps supporting structure through late changes and strips all later tower moves", () => {
  const first = layer(
    [travel("purge tower structure"), extrude(), travel("shells"), extrude()],
    0,
  );
  const change = layer(
    [
      travel("purge tower"),
      extrude(),
      travel("purge tower structure"),
      extrude(),
    ],
    1,
  );
  const model = [travel("shells"), extrude()];
  const top = layer(
    [...model, travel("purge tower structure"), extrude(), travel()],
    2,
  );
  const empty = layer([travel("purge tower structure"), extrude()], 3);
  const result = [first, change, top, empty];
  const original = structuredClone(result.slice(0, 2));
  trimPurgeTower(result);
  expect(result).toHaveLength(3);
  expect(result.slice(0, 2)).toEqual(original);
  expect(result[2]).toBe(top);
  expect([...top]).toEqual(model);
  expect(top).toMatchObject({
    height: 0.2,
    z: 0.6000000000000001,
    layer: 2,
    slice: { index: 2 },
    params: { speed: 40 },
  });
});

it("handles modal labels across layer boundaries and removes towers without actual priming", () => {
  const model = [travel("shells"), extrude()];
  const result = [
    layer([travel("purge tower structure"), extrude()], 0),
    layer([extrude(), travel(), ...model], 1),
  ];
  trimPurgeTower(result);
  expect(result).toHaveLength(1);
  expect(result[0].layer).toBe(1);
  expect([...result[0]]).toEqual(model);
});

it("does not mistake a priming travel marker for actual deposition or remove control/model paths", () => {
  const records = [
    travel("purge tower"),
    travel(),
    travel("shells"),
    extrude(),
    { type: "dwell", emit: 0, point: null },
  ];
  const expected = records.slice(-3);
  const result = [Object.assign(records, { slice: { index: 0 } })];
  trimPurgeTower(result);
  expect([...result[0]]).toEqual(expected);
  expect(result[0].slice).toEqual({ index: 0 });
});
