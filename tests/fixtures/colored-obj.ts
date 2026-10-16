import { primitive } from "../../src/lib/geometry";
export const materialLibrary =
  "newmtl Brick\nKd 1 0 0\nnewmtl Snow\nKd 1 1 1\n";
export function coloredObj(groups = false, vertexColors = false) {
  const p = primitive("cube", 1).positions.map((v) => v * 0.3);
  const vertices = Array.from(
    { length: p.length / 3 },
    (_, i) =>
      `v ${p[i * 3]} ${p[i * 3 + 1]} ${p[i * 3 + 2]}${vertexColors ? ` ${i % 3 === 0 ? "1 0 0" : i % 3 === 1 ? "0 1 0" : "0 0 1"}` : ""}`,
  );
  const faces = Array.from({ length: p.length / 9 }, (_, i) => {
    const top = [2, 5, 8].every((j) => p[i * 9 + j] === 6);
    return `${groups ? `g Surface ${i}\n` : ""}usemtl ${top ? "Snow" : "Brick"}\nf ${i * 3 + 1} ${i * 3 + 2} ${i * 3 + 3}`;
  });
  return `mtllib "colors palette.mtl"\no Body\n${vertices.join("\n")}\n${faces.join("\n")}\n`;
}
