// Independently integrate exported linear extrusion on each side of machine X=110.
// This splits the baseline too, so path subdivision cannot inflate coverage or volume.
export function audit(text: string) {
  let x = 0,
    y = 0,
    z = 0,
    feed = 0,
    active = false,
    feature = "";
  const sides = [
    { length: 0, e: 0, time: 0 },
    { length: 0, e: 0, time: 0 },
  ];
  let crossing = 0,
    maxFlow = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line === ";STRATUM_PRINT_BEGIN") active = true;
    if (line === ";STRATUM_PRINT_END") active = false;
    const type = line.match(/^;\s*(?:TYPE:|feature )(.+)/i);
    if (type) feature = type[1];
    const command = line.match(/^G([0192]+)\s/);
    if (!command) continue;
    const args: Record<string, number> = {};
    for (const m of line.split(";")[0].matchAll(/\b([XYZEF])(-?[\d.]+)/g))
      args[m[1]] = Number(m[2]);
    if (command[1] === "92") {
      x = args.X ?? x;
      y = args.Y ?? y;
      z = args.Z ?? z;
      continue;
    }
    if (!["0", "1"].includes(command[1])) continue;
    const nx = args.X ?? x,
      ny = args.Y ?? y,
      nz = args.Z ?? z;
    feed = args.F ?? feed;
    const length = Math.hypot(nx - x, ny - y);
    if (
      active &&
      args.E > 0 &&
      length > 0.001 &&
      !/brim|support|purge|shield/.test(feature)
    ) {
      const cuts = [0, 1];
      if (
        (x < 110 - 1e-5 && nx > 110 + 1e-5) ||
        (nx < 110 - 1e-5 && x > 110 + 1e-5)
      ) {
        crossing++;
        cuts.splice(1, 0, (110 - x) / (nx - x));
      }
      for (let i = 1; i < cuts.length; i++) {
        const fraction = cuts[i] - cuts[i - 1],
          mid = (cuts[i] + cuts[i - 1]) / 2;
        const side = sides[x + (nx - x) * mid < 110 ? 0 : 1];
        side.length += length * fraction;
        side.e += args.E * fraction;
        side.time += (length * fraction) / (feed / 60);
      }
      maxFlow = Math.max(
        maxFlow,
        (args.E * Math.PI * (1.75 / 2) ** 2) / (length / (feed / 60)),
      );
    }
    x = nx;
    y = ny;
    z = nz;
  }
  return { sides, crossing, maxFlow };
}
