"""Incremental MIT worker patch from d20016e: regional wall counts."""
from pathlib import Path
p = Path('public/engine/kiri-work.js')
s = p.read_text()
patches = [
    ('B=Ue.renest(B,!0),Q&&B.length>0', 'B=Ue.renest(n.stratumWallDepth?B.clone(true):B,!0),Q&&B.length>0'),
    ('function EA(ie,Re={},Fe=0){', 'function EA(ie,Re={},Fe=0){if(Array.isArray(ie)&&Re.sort&&ie.some(p=>p.stratumWallPath)){for(const depth of [...new Set(ie.map(p=>p.depth))].sort((a,b)=>(b-a)*Re.sort))_A(ie.filter(p=>p.depth===depth),p=>EA(p,Re,Fe++),null);return}'),
    ('g.shells=A.shells.filter(Q=>Q.area()>I)', 'g.shells=A.shells.filter(Q=>Q.area()>I||(Q.points.some(p=>p.moved)&&Q.perimeter()>0))'),
    ('this.tops.map(e=>e.shells[0])', 'this.tops.map(e=>e.stratumWallRoute||e.shells[0])'),
    ('e=t.polyPrintPath(ie,e,r,{accel:eA', 'e=t.polyPrintPath(ie,e,r,{open:!!ie.open,simple:!!ie.open,accel:eA'),
    ('import { applyProcessModifiers } from "./process-modifiers.js";', 'import { applyProcessModifiers } from "./process-modifiers.js";\nimport { applyWallModifiers } from "./wall-modifiers.js";'),
    ('v.solids=[],v.widget=A;if(await XA(.1,.2)', 'v.solids=[],v.widget=A;await applyWallModifiers(rA,A,n,F,{point:je,section:Ih,polygons:Ue,polygon:tt,shell:uG});if(await XA(.1,.2)'),
    ('cache:ae._range!==!0&&AA===Qe', 'cache:!A.anno.stratumWallModifiers?.length&&ae._range!==!0&&AA===Qe'),
]
for old, new in patches:
    assert s.count(old) == 1, f'Unexpected wall modifier patch target: {old}'
    s = s.replace(old, new)
p.write_text(s)
