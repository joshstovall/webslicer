"""Incremental original MIT tree adapter from 17e9c4c."""
from pathlib import Path
p=Path('public/engine/kiri-work.js')
s=p.read_text()
patches=[
 ('import { applySupportModifiers } from "./support-modifiers.js";', 'import { applySupportModifiers } from "./support-modifiers.js";\nimport { planPlateTrees } from "./tree-supports.js";'),
 ('if(await w.ready(),!n)', 'if(await w.ready(),await planPlateTrees(t,g,{polygons:Ue,polygon:tt,point:je,fill:Dz},I,progress=>e(progress*.05,"branching supports")),!n)'),
]
for old,new in patches:
 assert s.count(old)==1,old
 s=s.replace(old,new)
p.write_text(s)
