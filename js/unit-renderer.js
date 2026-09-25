import { TILE_SIZE,ELEVATION_HEIGHT,UNIT_VISUAL_HEIGHT } from "./coordinate-system.js";
import { HydrologyEngine } from "./hydrology-engine.js";
export class UnitRenderer{
 constructor(scene){this.scene=scene;this.meshes=new Map();this.materials={P:this.mat("player",new BABYLON.Color3(.20,.55,.95)),E:this.mat("enemy",new BABYLON.Color3(.90,.24,.24)),N:this.mat("neutral",new BABYLON.Color3(.75,.65,.25))}}
 mat(name,color){const m=new BABYLON.StandardMaterial(name,this.scene);m.diffuseColor=color;return m}
 sync(state){for(const unit of state.units){if(!unit.alive)continue;let mesh=this.meshes.get(unit.id);if(!mesh){mesh=BABYLON.MeshBuilder.CreateCapsule(`unit-${unit.id}`,{height:UNIT_VISUAL_HEIGHT,radius:.42},this.scene);mesh.metadata={kind:"unit",unitId:unit.id};mesh.material=this.materials[unit.team]??this.materials.N;this.meshes.set(unit.id,mesh)}const x=unit.x,y=unit.y,tile=state.grid.tileAt(x,y);if(!tile)continue;const logicalSurface=HydrologyEngine.waterSurfaceZ(tile)??Number(tile.elevation||0);mesh.position.set(x*TILE_SIZE,logicalSurface*ELEVATION_HEIGHT+UNIT_VISUAL_HEIGHT/2,y*TILE_SIZE)}}
}
