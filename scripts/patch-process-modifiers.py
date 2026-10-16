"""Incremental MIT worker patch from 62a3f76: regional speed and flow."""
from pathlib import Path
p = Path('public/engine/kiri-work.js')
s = p.read_text()
patches = [
    ('import { applySupportModifiers } from "./support-modifiers.js";', 'import { applySupportModifiers } from "./support-modifiers.js";\nimport { applyProcessModifiers } from "./process-modifiers.js";'),
    ('(!d&&g.stratumBridgeCooling&&annotateBridges(tA,t,g.sliceLineWidth||I.extruders[0].extNozzle))', '(!d&&await applyProcessModifiers(tA,t,g,{point:je,slice:Ih,polygons:Ue})),(!d&&g.stratumBridgeCooling&&annotateBridges(tA,t,g.sliceLineWidth||I.extruders[0].extNozzle))'),
    ('for(let _A of bA)_A.tops&&_A.tops.forEach(function(jA){AA.push(jA.poly.clone())});s&&(AA=Ue.union(AA,1,!0))', 'for(let _A of bA){_A.tops&&_A.tops.forEach(function(jA){AA.push(jA.poly.clone())});if(g.stratumAlignedLayers)for(const support of _A.supports||[])AA.push(support.clone(true))}if(g.stratumAlignedLayers)AA=Ue.union(AA,0,true);s&&(AA=Ue.union(AA,1,!0))'),
    ('if(m){let Qe=function(he,de,fe,ie,Re,Fe)', 'if(m&&!EA.length)throw new Error("Raft requires model or support contact on the first layer. Ground the model or add supports reaching the bed.");if(m){let Qe=function(he,de,fe,ie,Re,Fe)'),
]
for old, new in patches:
    assert s.count(old) == 1, f'Unexpected regional process patch target: {old}'
    s = s.replace(old, new)
p.write_text(s)
