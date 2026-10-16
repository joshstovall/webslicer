// Optional interoperability check. Requires Node 24+, Python 3, and a separately
// downloaded pinned U1 planner. No vendor implementation is bundled in the app.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { arcPath } from "../src/lib/gcode-arcs.ts";

const planner = process.argv[2];
if (!planner)
  throw new Error(
    "Usage: node scripts/verify-u1-arcs.mjs /path/to/gcode_arcs.py",
  );
const hash = createHash("sha256").update(readFileSync(planner)).digest("hex");
if (hash !== "6dddcfb3bc0e828b2f152f998ca494d338e95ca0259d79b1f57e788d7ab6f9dd")
  throw new Error("Use the pinned U1 planner linked in docs/gcode-preview.md");
const reference = spawnSync(
  "python3",
  [
    "-c",
    `
import importlib.util,json,collections,sys
spec=importlib.util.spec_from_file_location('u1_arcs',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
planner=module.ArcSupport.__new__(module.ArcSupport)
planner.mm_per_arc_segment=1.
planner.Coord=collections.namedtuple('Coord','x y z e',defaults=[None])
cases=[]
for plane,axes in [(17,(0,1,2)),(18,(0,2,1)),(19,(1,2,0))]:
 for clockwise in [False,True]:
  for full,helix in [(False,False),(True,False),(True,True),(False,True)]:
   start=[12.,23.,34.];end=start.copy();a,b,h=axes
   if not full:end[a]=start[a]-10;end[b]=start[b]+(-10 if clockwise else 10)
   if helix:end[h]+=4
   points=planner.planArc(planner.Coord(*start),planner.Coord(*end),[-10,0],clockwise,*axes)
   cases.append(dict(start=start,end=end,args={'IJK'[a]:-10},clockwise=clockwise,plane=plane,points=[list(p)[:3] for p in points]))
print(json.dumps(cases))
`,
    planner,
  ],
  { encoding: "utf8", maxBuffer: 1024 * 1024 },
);
if (reference.status !== 0)
  throw new Error(reference.stderr || String(reference.error));
const cases = JSON.parse(reference.stdout);
let maxError = 0,
  points = 0;
for (const c of cases) {
  const arc = arcPath(
    c.start,
    c.end,
    c.args,
    c.clockwise,
    c.plane,
    false,
    "klipper",
  );
  c.points.forEach((expected, i) => {
    const actual = arc.pointAt((i + 1) / c.points.length);
    const error = Math.hypot(
      ...actual.map((value, axis) => value - expected[axis]),
    );
    if (!Number.isFinite(error) || error > 1e-8)
      throw new Error(
        JSON.stringify({
          plane: c.plane,
          clockwise: c.clockwise,
          expected,
          actual,
          error,
        }),
      );
    maxError = Math.max(error, maxError);
    points++;
  });
}
console.log(JSON.stringify({ cases: cases.length, points, maxError }, null, 2));
