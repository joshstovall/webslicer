"""Incremental patch against 93245f3's pinned worker. No upstream rebuild needed."""
from pathlib import Path
p=Path('public/engine/kiri-work.js')
s=p.read_text()
old='import { planKiriPurgeBlocks } from "./purge-planner.js";'
assert s.count(old)==1, 'Expected the preceding purge-planner patch exactly once'
s=s.replace(old,'import { planKiriPurgeBlocks, planPurgePaths } from "./purge-planner.js";')
old='if(ne=Qe,jA){w.setType("purge tower")'
assert s.count(old)==1, 'Expected the pinned purge function exactly once'
new='''if(jA&&!d&&g.stratumExactPurge){
 const required=bA>=0?0:(g.stratumPurgeVolumes?.[`${fA}:${Qe}`]??g.stratumPurgeVolume);
 const paths=planPurgePaths({bounds:jA.rect.bounds,z:AA,volume:required,first:he,layer:G,lineWidth:g.sliceLineWidth||I.extruders[Qe].extNozzle,height:G===0?(g.firstSliceHeight||g.sliceHeight):_.height,flow:g.stratumFilamentFlows?.[Qe]??1});
 if(_.last())_.last().retract=true;
 for(const path of paths){
  w.setType(path.kind==="prime"?"purge tower":"purge tower structure");
  const poly=tt().setOpen();for(const point of path.points)poly.push(je(...point));
  v=w.polyPrintPath(poly,v,_,{tool:Qe,rate:de,simple:true,open:true});
 }
 _.last().retract=true;
 v=w.polyPrintPath(jA.rect.clone().setZ(AA),v,_,{tool:Qe,rate:de,simple:true,open:false,extrude:0});
 _.last().overate=0;ne=Qe;zA=zA||he;return v;
}if(ne=Qe,jA){w.setType("purge tower")'''
s=s.replace(old,new)
p.write_text(s)
