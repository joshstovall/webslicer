"""Incremental original MIT interface adapter from 424087d."""
from pathlib import Path
p = Path('public/engine/kiri-work.js')
s = p.read_text()
patches = [
 ('import { planPlateTrees } from "./tree-supports.js";', 'import { planPlateTrees } from "./tree-supports.js";\nimport { planSupportInterfaces } from "./support-interfaces.js";'),
 ('progress=>e(progress*.05,"branching supports")),!n)', 'progress=>e(progress*.05,"branching supports")),await planSupportInterfaces(t,g,{polygons:Ue,polygon:tt,point:je,fill:Dz},I,progress=>e(.05+progress*.05,"support interfaces")),!n)'),
]
for old, new in patches:
 assert s.count(old) == 1, old
 s = s.replace(old, new)
p.write_text(s)
