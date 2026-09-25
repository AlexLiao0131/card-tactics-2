import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";
const keyOf=t=>`${t.x},${t.y}`;
export class HighlightRenderer{
  constructor(scene){
    this.scene=scene;this.meshes=new Map();
    this.materials={
      reachable:this.mat("reachable",new BABYLON.Color3(.18,.55,1)),
      attackable:this.mat("attackable",new BABYLON.Color3(1,.25,.22)),
      deployable:this.mat("deployable",new BABYLON.Color3(.25,.92,.48)),
      inspected:this.mat("inspected",new BABYLON.Color3(1,.78,.25))
    };
  }
  mat(name,color){const m=new BABYLON.StandardMaterial(name,this.scene);m.diffuseColor=color;m.emissiveColor=color;m.alpha=.38;m.disableLighting=true;return m}
  sync(state){
    const alive=new Set();
    for(const tile of state?.map?.tiles||[]){
      const kind=tile.inspected?"inspected":tile.attackable?"attackable":tile.deployable?"deployable":tile.reachable?"reachable":null;
      const key=keyOf(tile);
      if(!kind){const old=this.meshes.get(key);if(old){old.dispose();this.meshes.delete(key)}continue}
      alive.add(key);let mesh=this.meshes.get(key);
      if(!mesh){mesh=BABYLON.MeshBuilder.CreateBox(`hl-${key}`,{width:TILE_SIZE*.91,depth:TILE_SIZE*.91,height:.035},this.scene);mesh.isPickable=false;this.meshes.set(key,mesh)}
      const surface=tile.waterSurfaceZ==null?Number(tile.elevation||0):Math.max(Number(tile.elevation||0),Number(tile.waterSurfaceZ));
      mesh.position.set(tile.x*TILE_SIZE,surface*ELEVATION_HEIGHT+.055,tile.y*TILE_SIZE);
      mesh.material=this.materials[kind];
    }
    for(const[key,mesh]of this.meshes)if(!alive.has(key)){mesh.dispose();this.meshes.delete(key)}
  }
}
