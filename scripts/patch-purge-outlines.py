"""Incremental original MIT purge-outline adapter from 11e9ece."""
from pathlib import Path
p=Path('public/engine/kiri-work.js')
s=p.read_text()
patches=[
 ('import { planKiriPurgeBlocks, planPurgePaths, trimPurgeTower }', 'import { planOutlinePurgeBlocks, planPurgePaths, trimPurgeTower }'),
 ('const stratumPlan=planKiriPurgeBlocks(t,A,YA-1);', 'const stratumPlan=await planOutlinePurgeBlocks(t,A,YA-1,{polygons:Ue,polygon:tt},[...tA,$],progress=>e(.1+progress*.05,"purge footprints"));'),
]
for old,new in patches:
 assert s.count(old)==1,old
 s=s.replace(old,new)
p.write_text(s)
