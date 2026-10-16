"""Incremental patch against 9debe20's worker; shared plans use slice midpoints."""
from pathlib import Path
p = Path('public/engine/kiri-work.js')
s = p.read_text()
old = 'function OA(_){if(n.xray)return _.zIndexes;let{zMin:v,zMax:AA}='
new = 'function OA(_){if(n.xray)return _.zIndexes;if(n.stratumLayerPlan){for(const layer of n.stratumLayerPlan){if(layer.z>_.zMax)break;VA.push(layer.z);LA.push(layer.height)}return VA}let{zMin:v,zMax:AA}='
assert s.count(old) == 1, 'Unexpected worker adaptive entry point'
s = s.replace(old, new)

patches = [
    ('for(let Z of EA.slices){Z.widget=EA;let _=(Z.z+EA.offset.z)', 'for(let Z of EA.slices){if(g.stratumAlignedLayers&&!(Z.height>0))continue;Z.widget=EA;let _=(Z.z+EA.offset.z)'),
    ('$.z=v+AA.height/2', '$.z=g.stratumLayerPlan?g.stratumLayerPlan[AA.index].top+AA.widget.offset.z:v+AA.height/2'),
    ('(Z.z+EA.offset.z).round(2)', '(Z.z+EA.offset.z).round(g.stratumLayerPlan?3:2)'),
    ('$.height=$.height||AA.height', '$.height=g.stratumLayerPlan?AA.height:$.height||AA.height'),
]
for old, new in patches:
    assert s.count(old) == 1, f'Unexpected adaptive preparation target: {old}'
    s = s.replace(old, new)
p.write_text(s)
