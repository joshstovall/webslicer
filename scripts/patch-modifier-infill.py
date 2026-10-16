"""Incremental MIT engine patch from e0dea91: spatial infill modifier masks."""
from pathlib import Path
p = Path('public/engine/kiri-work.js')
s = p.read_text()
setup = '''
const stratumModifiers=(A.anno.stratumModifiers||[]).map(modifier=>{
 const points=[];let min=Infinity,max=-Infinity;
 for(let i=0;i<modifier.vertices.length;i+=3){
  const point=je(modifier.vertices[i],modifier.vertices[i+1],modifier.vertices[i+2]);
  if(![point.x,point.y,point.z].every(Number.isFinite))throw new Error("Invalid modifier coordinates.");
  points.push(point);min=Math.min(min,point.z);max=Math.max(max,point.z);
 }
 return {...modifier,points,min,max};
});
async function stratumFill(slice,options){
 if(!stratumModifiers.length)return fz(slice,options);
 if(!slice.height||slice.isSolidLayer)return;
 const masks=[];
 for(const modifier of stratumModifiers){
  if(slice.z<modifier.min||slice.z>modifier.max)continue;
  const section=await Ih(slice.z,modifier.points,{strict:true,union:true,zMin:modifier.min,zMax:modifier.max});
  if(section.groups?.some(poly=>poly.open))throw new Error(modifier.name+": modifier meshes must have closed cross-sections.");
  const polys=Ue.nest(section.groups||[]);
  if(polys.length)masks.push({...modifier,polys});
 }
 fillModifiedInfill(slice,options,masks,{polygons:Ue,polygon:tt,sparse:fz});
}
'''
patches = [
    ('import { annotateBridges } from "./bridge-cooling.js";', 'import { annotateBridges } from "./bridge-cooling.js";\nimport { fillModifiedInfill } from "./modifier-infill.js";'),
    ('ae=bA.sliceFillSparse>XC.DENSE_INFILL_THRESHOLD', 'ae=!A.anno.stratumModifiers?.length&&bA.sliceFillSparse>XC.DENSE_INFILL_THRESHOLD'),
    ('async function sA(_,v){let AA,bA=f?[]:void 0', 'async function sA(_,v){'+setup+'let AA,bA=f?[]:void 0'),
    ('if(!ae.sliceFillSparse)return;let Qe=ae.sliceFillType;fz(jA,', 'if(!ae.sliceFillSparse&&!stratumModifiers.length)continue;let Qe=ae.sliceFillType;await stratumFill(jA,'),
    ('ne(_A[0].lo,_A[0].hi,jA=>{let ae=jA.params||n;', 'for(let stratumIndex=0;stratumIndex<rA.length;stratumIndex++){const jA=rA[stratumIndex];let ae=jA.params||n;'),
    ('promises:bA}),AA=Qe},"infill"),bA&&await', 'promises:bA});AA=Qe;te((stratumIndex+1)/rA.length,_A[0].lo,_A[0].hi,"infill")}bA&&await'),
]
for old, new in patches:
    assert s.count(old) == 1, f'Expected one patch target: {old}'
    s = s.replace(old, new)
p.write_text(s)
