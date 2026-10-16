"""Apply the documented Stratum purge-planning patch to the pinned worker once.

Fail on a different runtime instead of silently modifying a similarly named function.
The preceding non-contiguous block-index patch must already be present.
"""
from pathlib import Path
p = Path('public/engine/kiri-work.js')
s = p.read_text()
patches = [
 ('A.done({done:!0,minSpeed:C,maxSpeed:B})})},async export',
  'A.done({done:!0,minSpeed:C,maxSpeed:B})}).catch(error=>A.done({error:String(error?.message||error)}))},async export'),
 ('t=t.filter(EA=>!EA.track.ignore&&!EA.meta.disabled);let{device:I,process:g,controller:Q,bounds:n}=A',
  't=t.filter(EA=>!EA.track.ignore&&!EA.meta.disabled&&EA.slices.length);let{device:I,process:g,controller:Q,bounds:n}=A'),
 ('SA[o]||(SA[o]={},YA++);', 'SA[o]||!t.some(widget=>widget.slices.some(slice=>slice.supports?.length))||(SA[o]={},YA++);'),
 ('function mA(EA,Z=45,_=6,blockIndex=0)', 'const stratumPlan=planKiriPurgeBlocks(t,A,YA-1);if(stratumPlan){VA=LA=stratumPlan.size}const stratumBlocks=stratumPlan?.positions;function mA(EA,Z=45,_=6,blockIndex=0)'),
 ('bA={x:BA.x+rA.x*blockIndex,y:BA.y+rA.y*blockIndex,z:0}', 'bA=stratumBlocks?.[blockIndex]??{x:BA.x+rA.x*blockIndex,y:BA.y+rA.y*blockIndex,z:0}'),
 ('(!Ie||Ie.extruder!==AA.extruder)&&AA.extruder>=0', '(Ie&&Ie.extruder!==AA.extruder)&&AA.extruder>=0'),
 ('_.sort((he,de)=>he.dst-de.dst)', '_.sort((he,de)=>(he.slice.extruder===(fA??0)?0:1)-(de.slice.extruder===(fA??0)?0:1)||he.dst-de.dst)'),
 ('else return console.log({no_purge_tower_for:EA,using:bA,track:Z,layer:_}),v', 'else throw new Error("Purge block capacity exhausted before a tool change. No G-code was exported.")'),
]
if 'import { planKiriPurgeBlocks }' in s:
    raise SystemExit('Purge planner patch already applied.')
for old, new in patches:
    if s.count(old) != 1:
        raise SystemExit(f'Expected exactly one patch target: {old} (found {s.count(old)})')
    s = s.replace(old, new)
p.write_text('import { planKiriPurgeBlocks } from "./purge-planner.js";\n' + s)
