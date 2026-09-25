import { TILE_SIZE,ELEVATION_HEIGHT,tileCenterWorld } from "./coordinate-system.js";
const keyOf=t=>`${t.x},${t.y}`;
export class TerrainRenderer{
 constructor(scene){this.scene=scene;this.meshes=new Map();this.materials={soil:this.mat("soil",new BABYLON.Color3(.30,.42,.24)),rock:this.mat("rock",new BABYLON.Color3(.34,.36,.39)),mud:this.mat("mud",new BABYLON.Color3(.35,.27,.17))}}
 mat(name,color){const m=new BABYLON.StandardMaterial(name,this.scene);m.diffuseColor=color;m.specularColor=BABYLON.Color3.Black();return m}
 sync(state){for(const tile of state.grid.tiles){const key=keyOf(tile),topY=Number(tile.elevation||0)*ELEVATION_HEIGHT,height=Math.max(.18,(Number(tile.elevation||0)+1)*ELEVATION_HEIGHT);let mesh=this.meshes.get(key);if(!mesh||mesh.metadata?.height!==height){mesh?.dispose();mesh=BABYLON.MeshBuilder.CreateBox(`tile-${key}`,{width:TILE_SIZE*.94,depth:TILE_SIZE*.94,height},this.scene);mesh.metadata={kind:"tile",x:tile.x,y:tile.y,height};this.meshes.set(key,mesh)}const center=tileCenterWorld(tile);mesh.position.set(center.x,topY-height/2,center.z);mesh.material=tile.terrain==="MUD"?this.materials.mud:(tile.material==="ROCK"||tile.terrain==="HIGH_GROUND"?this.materials.rock:this.materials.soil);mesh.receiveShadows=true}}
}
