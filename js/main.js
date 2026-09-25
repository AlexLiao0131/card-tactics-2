import "./terrain-database.js";
import { createPrototypeBattleState } from "./battle-state.js";
import { BattleSession } from "./battle-session.js";
import { BabylonRenderer } from "./babylon-renderer.js";
import { HydrologyEngine } from "./hydrology-engine.js";
const canvas=document.getElementById("battleCanvas"),status=document.getElementById("status"),state=createPrototypeBattleState(),session=new BattleSession(state);
const renderer=new BabylonRenderer(canvas,state,{onTilePicked(x,y){const result=session.dispatch({type:"MOVE",unitId:state.selectedUnitId,x,y});if(!result.ok)updateStatus(`不可移動到 (${x},${y})：${result.reason}`)}});
function updateStatus(message=""){const player=session.unitById("P1"),meteor=state.grid.tileAt(state.meteorTarget.x,state.meteorTarget.y),basin=state.grid.tileAt(1,4);status.textContent=[message,`Player grid=(${player.x},${player.y})`,`Meteor H${meteor.elevation} / Water ${Number(meteor.waterDepth||0).toFixed(2)}`,`Basin H${basin.elevation} / Surface ${Number(HydrologyEngine.waterSurfaceZ(basin)??0).toFixed(2)}`,`Camera=${state.cameraQuarterTurns*90}° | revision=${state.revision}`].filter(Boolean).join(" ｜ ")}
session.subscribe((next,event)=>{renderer.sync(next);updateStatus(event.type==="INIT"?"Strict core + Babylon renderer loaded.":event.type)});
document.getElementById("rotateLeft").addEventListener("click",()=>session.dispatch({type:"ROTATE_CAMERA",delta:-1}));
document.getElementById("rotateRight").addEventListener("click",()=>session.dispatch({type:"ROTATE_CAMERA",delta:1}));
document.getElementById("meteorButton").addEventListener("click",()=>session.dispatch({type:"METEOR",x:state.meteorTarget.x,y:state.meteorTarget.y,setElevation:1}));
document.getElementById("waterButton").addEventListener("click",()=>session.dispatch({type:"ADD_WATER",x:state.meteorTarget.x,y:state.meteorTarget.y,amount:.35}));
