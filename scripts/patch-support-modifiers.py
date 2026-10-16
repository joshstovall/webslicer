"""Incremental MIT engine patch from 56f0778: support-contact volumes."""
from pathlib import Path
p = Path('public/engine/kiri-work.js')
s = p.read_text()
patches = [
    ('import { fillModifiedInfill } from "./modifier-infill.js";', 'import { fillModifiedInfill } from "./modifier-infill.js";\nimport { applySupportModifiers } from "./support-modifiers.js";'),
    ('let de=F*F,fe,ie=bA.length,Re=0;n.sliceSupportTree;', 'await applySupportModifiers(bA,A.anno.stratumSupportModifiers,{polygons:Ue,point:je,slice:Ih},A.anno.stratumSupportPeers,n.sliceSupportOffset+F/2);let de=F*F,fe,ie=bA.length,Re=0;n.sliceSupportTree;'),
    ('oA=[eA.topPolys()].filter(MA=>MA).flat()', 'oA=[eA.topPolys(),eA.stratumSupportOccluders].filter(MA=>MA).flat()'),
    ('let vA=[eA.clips,Fe?eA.up?.clips:void 0,Fe?eA.down?.clips:void 0]', 'let vA=[eA.clips,eA.stratumSupportClips,Fe?eA.up?.clips:void 0,Fe?eA.down?.clips:void 0,Fe?eA.up?.stratumSupportClips:void 0,Fe?eA.down?.stratumSupportClips:void 0]'),
    ('(Z.z+EA.offset.z).round(g.stratumLayerPlan?3:2)', '(Z.z+EA.offset.z).round(g.stratumAlignedLayers?3:2)'),
    ('$.z=g.stratumLayerPlan?g.stratumLayerPlan[AA.index].top+AA.widget.offset.z:v+AA.height/2', '$.z=g.stratumLayerPlan?g.stratumLayerPlan[AA.index].top+AA.widget.offset.z:g.stratumAlignedLayers&&AA.index>=0?(g.firstSliceHeight||g.sliceHeight)+AA.index*g.sliceHeight+AA.widget.offset.z:v+AA.height/2'),
]
for old, new in patches:
    assert s.count(old) == 1, f'Expected one patch target: {old}'
    s = s.replace(old, new)
p.write_text(s)
