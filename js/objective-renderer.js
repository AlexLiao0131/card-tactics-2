import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";
const ownerKey=owner=>owner==="PLAYER"?"PLAYER":owner==="ENEMY"?"ENEMY":"NEUTRAL";
export class ObjectiveRenderer{
  constructor(scene){
    this.scene=scene;this.cores=new Map();this.points=new Map();
    this.materials={
      PLAYER:this.mat("objective-player",new BABYLON.Color3(.20,.55,.95)),
      ENEMY:this.mat("objective-enemy",new BABYLON.Color3(.90,.24,.24)),
      NEUTRAL:this.mat("objective-neutral",new BABYLON.Color3(.72,.62,.26))
    };
  }
  mat(name,color){const m=new BABYLON.StandardMaterial(name,this.scene);m.diffuseColor=color;m.emissiveColor=color.scale(.18);return m}
  tile(state,x,y){return state?.map?.tiles?.find(t=>t.x===x&&t.y===y)||null}
  surfaceY(state,x,y){
    const t=this.tile(state,x,y);if(!t)return 0;
    const z=t.waterSurfaceZ==null?Number(t.elevation||0):Math.max(Number(t.elevation||0),Number(t.waterSurfaceZ));
    return z*ELEVATION_HEIGHT;
  }
  sync(state){
    const coreAlive=new Set();
    for(const core of state?.cores||[]){
      coreAlive.add(core.id);let mesh=this.cores.get(core.id);
      if(!mesh){mesh=BABYLON.MeshBuilder.CreateBox(`core-${core.id}`,{width:1.22,depth:1.22,height:1.65},this.scene);mesh.isPickable=false;this.cores.set(core.id,mesh)}
      mesh.material=this.materials[ownerKey(core.owner)];
      mesh.position.set(core.x*TILE_SIZE,this.surfaceY(state,core.x,core.y)+.825,core.y*TILE_SIZE);
      mesh.visibility=core.hp>0?1:.2;
    }
    for(const[id,mesh]of this.cores)if(!coreAlive.has(id)){mesh.dispose();this.cores.delete(id)}

    const pointAlive=new Set();
    for(const point of state?.presentation?.deploymentPoints||[]){
      if(point.capturable===false)continue;
      const tile=point.captureTiles?.[0];if(!tile)continue;
      pointAlive.add(point.id);let mesh=this.points.get(point.id);
      if(!mesh){mesh=BABYLON.MeshBuilder.CreateCylinder(`capture-${point.id}`,{diameter:1.35,height:.09,tessellation:32},this.scene);mesh.isPickable=false;this.points.set(point.id,mesh)}
      mesh.material=this.materials[ownerKey(point.owner)];
      mesh.position.set(tile.x*TILE_SIZE,this.surfaceY(state,tile.x,tile.y)+.07,tile.y*TILE_SIZE);
    }
    for(const[id,mesh]of this.points)if(!pointAlive.has(id)){mesh.dispose();this.points.delete(id)}
  }
}
