"""Incremental patch against f46e633's worker. Fail on unexpected source."""
from pathlib import Path
p=Path('public/engine/kiri-work.js')
s=p.read_text()
patches=[
('_A=Math.abs(v)<1e-4&&m||bA', '_A=(n.stratumAlignedLayers||Math.abs(v)<1e-4)&&m||bA'),
('import { planKiriPurgeBlocks, planPurgePaths, trimPurgeTower } from "./purge-planner.js";', 'import { planKiriPurgeBlocks, planPurgePaths, trimPurgeTower } from "./purge-planner.js";\nimport { annotateBridges } from "./bridge-cooling.js";'),
('w.output=tA,w.firstTool=UA', '(!d&&g.stratumBridgeCooling&&annotateBridges(tA,t,g.sliceLineWidth||I.extruders[0].extNozzle)),w.output=tA,w.firstTool=UA'),
('let W=t.output,V=r.extras||{}', 'let stratumBridge=false,stratumBridgeTool=-1,stratumBridgeLayer;let W=t.output,V=r.extras||{}'),
('let PA=U.x+eA+ie.x', 'if(ge.emit>0&&ge.stratumBridge!==undefined&&(stratumBridge!==ge.stratumBridge||stratumBridgeTool!==Re||stratumBridgeLayer!==JA)){stratumBridge=ge.stratumBridge;stratumBridgeTool=Re;stratumBridgeLayer=JA;Yt(`;STRATUM_BRIDGE:${stratumBridge?1:0}`)}let PA=U.x+eA+ie.x'),
]
for old,new in patches:
    assert s.count(old)==1, f'Expected one patch target: {old}'
    s=s.replace(old,new)
p.write_text(s)
