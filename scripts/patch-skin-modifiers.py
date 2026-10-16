"""Incremental MIT worker patch from fb7e0d6: regional surface skins."""
from pathlib import Path
p = Path('public/engine/kiri-work.js')
s = p.read_text()
patches = [
    ('if(he){let de=H*he;kL({slice:AA', 'if(he&&!A.anno.stratumSkinModifiers?.length){let de=H*he;kL({slice:AA'),
    ('async function yA(_,v){let AA=yh(_,v,[.9,.05,.05])', 'async function yA(_,v){if(A.anno.stratumSkinModifiers?.length)return;let AA=yh(_,v,[.9,.05,.05])'),
    ('bA(ie.fill_lines,{flow:R,raft:Fe})', 'bA(ie.fill_lines,{flow:R,raft:Fe,skinArea:A.stratumSkins?ie.solids:undefined})'),
    ('uA<=Be&&oA<=Be?(vA=eA.midPointTo(vA)', 'uA<=Be&&oA<=Be&&skinMoveInside(e,eA.midPointTo(vA),Re.skinArea)?(vA=eA.midPointTo(vA)'),
    ('uA<Be||JA&&!ye?t.addOutput(r,eA,xA,$,h)', 'uA<Be&&skinMoveInside(e,eA,Re.skinArea)||JA&&!ye?t.addOutput(r,eA,xA,$,h)'),

    ('import { applyWallModifiers } from "./wall-modifiers.js";', 'import { applyWallModifiers } from "./wall-modifiers.js";\nimport { applySkinModifiers, skinMoveInside } from "./skin-modifiers.js";'),
    ('await P(.4,.5),await UA(.5,.6)', 'await P(.4,.5),await applySkinModifiers(rA,A,n,{point:je,section:Ih,polygons:Ue}),await UA(.5,.6)'),
    ('cache:!A.anno.stratumWallModifiers?.length&&ae._range', 'cache:!A.anno.stratumSkinModifiers?.length&&!A.anno.stratumWallModifiers?.length&&ae._range'),
    ('he=jA.sliceSolidMinArea;uz({slice:_A', 'he=_A.stratumSkins?0.00001:jA.sliceSolidMinArea;uz({slice:_A'),
]
for old,new in patches:
    assert s.count(old)==1, f'Unexpected skin patch target: {old}'
    s=s.replace(old,new)
p.write_text(s)
