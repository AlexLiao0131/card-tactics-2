import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";
const keyOf=t=>`${t.x},${t.y}`;
const surfaceOf=t=>t.waterSurfaceZ==null?Number(t.elevation||0):Math.max(Number(t.elevation||0),Number(t.waterSurfaceZ));
export class HighlightRenderer{
  constructor(scene){
    this.scene=scene;this.dynamic=new Map();this.areas=new Map();
    this.materials={
      reachable:this.mat("reachable",new BABYLON.Color3(.18,.55,1),.35),
      targetRange:this.mat("target-range",new BABYLON.Color3(1,.28,.22),.18),
      attackable:this.mat("attackable",new BABYLON.Color3(1,.25,.22),.48),
      deployable:this.mat("deployable",new BABYLON.Color3(.25,.92,.48),.38),
      inspected:this.mat("inspected",new BABYLON.Color3(1,.78,.25),.42),
      PLAYER:this.mat("deploy-area-player",new BABYLON.Color3(.20,.48,.96),.18),
      ENEMY:this.mat("deploy-area-enemy",new BABYLON.Color3(.92,.24,.28),.18),
      NEUTRAL:this.mat("deploy-area-neutral",new BABYLON.Color3(.78,.62,.22),.16)
    };
  }
  mat(name,color,alpha){const m=new BABYLON.StandardMaterial(name,this.scene);m.diffuseColor=color;m.emissiveColor=color;m.alpha=alpha;m.disableLighting=true;return m}
  tileMesh(name,tile,height=.026,scale=.94){
    const mesh=BABYLON.MeshBuilder.CreateBox(name,{width:TILE_SIZE*scale,depth:TILE_SIZE*scale,height},this.scene);mesh.isPickable=false;return mesh;
  }
  sync(state){
    const dynAlive=new Set(),areaAlive=new Set();
    for(const tile of state?.map?.tiles||[]){
      const key=keyOf(tile),surface=surfaceOf(tile),areaOwner=tile.deploymentAreaOwner;
      if(areaOwner){
        areaAlive.add(key);let area=this.areas.get(key);
        if(!area){area=this.tileMesh(`deploy-area-${key}`,tile,.022,.94);this.areas.set(key,area)}
        area.position.set(tile.x*TILE_SIZE,surface*ELEVATION_HEIGHT+.032,tile.y*TILE_SIZE);
        area.material=this.materials[areaOwner]||this.materials.NEUTRAL;
      }
      const kind=tile.inspected?"inspected":tile.attackable?"attackable":tile.deployable?"deployable":tile.targetRange?"targetRange":tile.reachable?"reachable":null;
      if(kind){
        dynAlive.add(key);let mesh=this.dynamic.get(key);
        if(!mesh){mesh=this.tileMesh(`hl-${key}`,tile,.035,.985);this.dynamic.set(key,mesh)}
        mesh.position.set(tile.x*TILE_SIZE,surface*ELEVATION_HEIGHT+.058,tile.y*TILE_SIZE);mesh.material=this.materials[kind];
      }
    }
    for(const[k,m]of this.areas)if(!areaAlive.has(k)){m.dispose();this.areas.delete(k)}
    for(const[k,m]of this.dynamic)if(!dynAlive.has(k)){m.dispose();this.dynamic.delete(k)}
  }
}
