import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";
import { elevation,waterDepth,waterSurfaceZ } from "./hydrology-engine.js";
const keyOf=t=>`${t.x},${t.y}`;
export class WaterRenderer{
 constructor(scene){this.scene=scene;this.meshes=new Map();this.material=new BABYLON.StandardMaterial("waterMaterial",scene);this.material.diffuseColor=new BABYLON.Color3(.12,.42,.75);this.material.alpha=.58;this.material.specularColor=new BABYLON.Color3(.35,.55,.75)}
 sync(state){const alive=new Set();for(const tile of state.grid.tiles){const depth=waterDepth(tile),surface=waterSurfaceZ(tile);if(surface==null||depth<=0)continue;const key=keyOf(tile);alive.add(key);const height=Math.max(.001,depth*ELEVATION_HEIGHT);let mesh=this.meshes.get(key);if(!mesh||Math.abs(Number(mesh.metadata?.height)-height)>.0001){mesh?.dispose();mesh=BABYLON.MeshBuilder.CreateBox(`water-${key}`,{width:TILE_SIZE*.88,depth:TILE_SIZE*.88,height},this.scene);mesh.material=this.material;mesh.isPickable=false;mesh.metadata={height};this.meshes.set(key,mesh)}const x=tile.x*TILE_SIZE,z=tile.y*TILE_SIZE,bottom=elevation(tile)*ELEVATION_HEIGHT,top=surface*ELEVATION_HEIGHT;mesh.position.set(x,(bottom+top)/2,z)}
 for(const[key,mesh]of this.meshes)if(!alive.has(key)){mesh.dispose();this.meshes.delete(key)}}
}
