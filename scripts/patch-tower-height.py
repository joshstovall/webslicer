"""Incremental patch against 0786993's pinned worker; keep prior patches intact."""
from pathlib import Path

p = Path('public/engine/kiri-work.js')
s = p.read_text()
old = 'import { planKiriPurgeBlocks, planPurgePaths } from "./purge-planner.js";'
assert s.count(old) == 1, 'Expected the metered purge patch exactly once'
s = s.replace(old, 'import { planKiriPurgeBlocks, planPurgePaths, trimPurgeTower } from "./purge-planner.js";')
old = 'w.output=tA,w.firstTool=UA'
assert s.count(old) == 1, 'Expected the pinned output assignment exactly once'
s = s.replace(old, '(!d&&g.stratumExactPurge&&trimPurgeTower(tA)),w.output=tA,w.firstTool=UA')
p.write_text(s)
