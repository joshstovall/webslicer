import type { Vec3 } from "../types";
export interface PaintedTriangle {
  points: [Vec3, Vec3, Vec3];
  tool: number;
}
const midpoint = (a: Vec3, b: Vec3): Vec3 =>
  a.map((v, i) => (v + b[i]) / 2) as Vec3;
/** Decode the right-to-left hexadecimal subdivision format used by painted 3MF facets. */
export function decodePaintTriangle(
  code: string,
  points: [Vec3, Vec3, Vec3],
  defaultTool: number,
): PaintedTriangle[] {
  if (!/^[0-9a-f]+$/i.test(code) || code.length > 1_000_000)
    throw new Error("Invalid or oversized 3MF paint tree.");
  let cursor = code.length - 1;
  const output: PaintedTriangle[] = [];
  const read = () => {
    if (cursor < 0) throw new Error("Truncated 3MF paint tree.");
    return parseInt(code[cursor--], 16);
  };
  function visit(triangle: [Vec3, Vec3, Vec3], depth: number) {
    if (depth > 64 || output.length > 250000)
      throw new Error("The 3MF paint tree is too complex.");
    const header = read(),
      splits = header & 3,
      side = header >> 2;
    if (!splits) {
      let state = side;
      if (state === 3) {
        const extension = read();
        state = extension === 15 ? 18 + read() : 3 + extension;
      }
      output.push({ points: triangle, tool: state ? state - 1 : defaultTool });
      return;
    }
    if (splits < 3 && side > 2)
      throw new Error("Invalid 3MF paint split edge.");
    const start = splits === 3 ? 0 : side;
    const [a, b, c] = [0, 1, 2].map((i) => triangle[(start + i) % 3]);
    const ab = midpoint(a, b),
      bc = midpoint(b, c),
      ca = midpoint(c, a);
    const children: [Vec3, Vec3, Vec3][] =
      splits === 1
        ? [
            [a, b, bc],
            [bc, c, a],
          ]
        : splits === 2
          ? [
              [a, ab, ca],
              [ab, b, ca],
              [b, c, ca],
            ]
          : [
              [a, ab, ca],
              [ab, b, bc],
              [bc, c, ca],
              [ab, bc, ca],
            ];
    for (const child of children.reverse()) visit(child, depth + 1);
  }
  visit(points, 0);
  if (cursor !== -1)
    throw new Error("Unexpected trailing data in 3MF paint tree.");
  return output;
}
