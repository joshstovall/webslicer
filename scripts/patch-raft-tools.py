"""Incremental MIT engine patch from e885dfa: configured raft tools and supported tower bases."""
from pathlib import Path
p = Path('public/engine/kiri-work.js')
s = p.read_text()
patches = [
    ('let eA=fi(H+he/2);for(let vA of ae)', 'let eA=fi(H+he/2);if(g.stratumAlignedLayers)eA.extruder=o;for(let vA of ae)'),
    ('SA[o]||!t.some(widget=>widget.slices.some(slice=>slice.supports?.length))||(SA[o]={},YA++);', 'SA[o]||!(m&&g.stratumAlignedLayers||t.some(widget=>widget.slices.some(slice=>slice.supports?.length)))||(SA[o]={},YA++);'),
    ('let UA,sA,fA,Ie;w.zmax=W', 'let UA=m&&!d&&g.stratumAlignedLayers?o:void 0,sA,fA=UA,Ie;w.zmax=W'),
    ('(Ie&&Ie.extruder!==AA.extruder)&&AA.extruder>=0', '((Ie?Ie.extruder:(m&&!d&&g.stratumAlignedLayers?o:AA.extruder))!==AA.extruder)&&AA.extruder>=0'),
]
foundation = '''
if(m&&!d&&g.stratumAlignedLayers&&g.stratumExactPurge&&l&&TA.length){
 let originalType;
 for(const layer of tA){
  for(let index=0;index<layer.length;index++){
   originalType=layer[index].type??originalType;
   if(index===0&&originalType)layer[index].type=originalType;
  }
 }
 const gap=g.outputRaftSpacing||0;
 if(gap>0){const layer=[];layer.z=H;layer.height=gap;tA.push(layer)}
 for(let index=0;index<tA.length;index++){
  const layer=tA[index];
  let cursor=layer.last()?.point||tA[index-1]?.last()?.point||c;
  if(layer.last())layer.last().retract=true;
  for(const block of TA){
   const paths=planPurgePaths({bounds:block.rect.bounds,z:layer.z,volume:0,first:index===0,layer:index,lineWidth:g.sliceLineWidth||I.extruders[o].extNozzle,height:layer.height,flow:g.stratumFilamentFlows?.[o]??1});
   for(const path of paths){
    w.setType("purge tower structure");
    const poly=tt().setOpen();for(const point of path.points)poly.push(je(...point));
    cursor=w.polyPrintPath(poly,cursor,layer,{tool:o,rate:index===0?g.firstLayerRate:g.outputFeedrate,simple:true,open:true});
   }
  }
  if(layer.last())layer.last().retract=true;
  c=cursor;
 }
}
'''
patches.append(('let zA=!1,ne;function P(', foundation + 'let zA=!1,ne;function P('))
for old, new in patches:
    assert s.count(old) == 1, f'Expected exactly one patch target: {old}'
    s = s.replace(old, new)
p.write_text(s)
