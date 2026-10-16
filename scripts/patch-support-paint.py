"""Incremental MIT worker patch from 0abe6a8: painted contact surfaces."""
from pathlib import Path
p=Path('public/engine/kiri-work.js')
s=p.read_text()
old='await applySupportModifiers(bA,A.anno.stratumSupportModifiers,{polygons:Ue,point:je,slice:Ih},A.anno.stratumSupportPeers,n.sliceSupportOffset+F/2);'
new='await applySupportModifiers(bA,A.anno.stratumSupportModifiers,{polygons:Ue,polygon:tt,point:je,slice:Ih},A.anno.stratumSupportPeers,n.sliceSupportOffset+F/2,A.anno.stratumSupportPaint);'
assert s.count(old)==1,'Unexpected support modifier entry point'
s=s.replace(old,new)
old='te(eA,AA[0].lo,AA[0].hi,"shadow")},jA,R);'
assert s.count(old)==1,'Unexpected automatic support shadow sampling'
s=s.replace(old,'te(eA,AA[0].lo,AA[0].hi,"shadow")},jA,R+0.0006);')
p.write_text(s)
