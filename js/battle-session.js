import { HydrologyEngine } from "./hydrology-engine.js";
import { TacticalEngine } from "./tactical-engine.js";
export class BattleSession{
 constructor(state){this.state=state;this.listeners=new Set()}
 subscribe(listener){this.listeners.add(listener);listener(this.state,{type:"INIT"});return()=>this.listeners.delete(listener)}
 emit(event){this.state.revision+=1;for(const listener of this.listeners)listener(this.state,event)}
 unitById(id){return this.state.units.find(u=>u.id===id)??null}
 dispatch(intent){switch(intent?.type){case"MOVE":return this.move(intent);case"METEOR":return this.meteor(intent);case"ADD_WATER":return this.addWater(intent);case"ROTATE_CAMERA":return this.rotateCamera(intent);default:return{ok:false,reason:"UNKNOWN_INTENT"}}}
 move({unitId,x,y}){const unit=this.unitById(unitId);if(!unit?.alive)return{ok:false,reason:"UNIT_NOT_AVAILABLE"};const path=TacticalEngine.pathTo(this.state.grid,this.state.units,unit,x,y);if(!path.length)return{ok:false,reason:"ILLEGAL_MOVE"};const from={x:unit.x,y:unit.y};unit.x=x;unit.y=y;this.emit({type:"UNIT_MOVED",unitId,from,to:{x,y},path:path.map(t=>({x:t.x,y:t.y,elevation:t.elevation}))});return{ok:true,path}}
 meteor({x,y,setElevation=1}){const tile=this.state.grid.tileAt(x,y);if(!tile)return{ok:false,reason:"NO_TILE"};const events=HydrologyEngine.deformTerrain(this.state.grid,x,y,{setElevation,source:"METEOR"});this.emit({type:"HYDROLOGY_UPDATED",source:"METEOR",events});return{ok:true,events}}
 addWater({x,y,amount=.35}){const tile=this.state.grid.tileAt(x,y);if(!tile)return{ok:false,reason:"NO_TILE"};const events=[],before=HydrologyEngine.waterDepth(tile);HydrologyEngine.addWater(tile,amount,events);HydrologyEngine.redistribute(this.state.grid,{source:"DEBUG_ADD_WATER",events});this.emit({type:"HYDROLOGY_UPDATED",source:"DEBUG_ADD_WATER",x,y,from:before,to:HydrologyEngine.waterDepth(tile),events});return{ok:true,events}}
 rotateCamera({delta=1}){const turns=((this.state.cameraQuarterTurns+delta)%4+4)%4;this.state.cameraQuarterTurns=turns;this.emit({type:"CAMERA_ROTATED",quarterTurns:turns});return{ok:true}}
}
