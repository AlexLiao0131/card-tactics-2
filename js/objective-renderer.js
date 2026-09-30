import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";
const ownerKey=owner=>owner==="PLAYER"?"PLAYER":owner==="ENEMY"?"ENEMY":"NEUTRAL";
const tileKey=(x,y)=>`${x},${y}`;
const surfaceZ=tile=>tile?.waterSurfaceZ==null?Number(tile?.elevation||0):Math.max(Number(tile?.elevation||0),Number(tile.waterSurfaceZ));
export class ObjectiveRenderer{
  constructor(scene){
    this.scene=scene;this.cores=new Map();this.points=new Map();this.signatureValue=null;
    this.materials={
      PLAYER:this.mat("objective-player",new BABYLON.Color3(.20,.55,.95)),
      ENEMY:this.mat("objective-enemy",new BABYLON.Color3(.90,.24,.24)),
      NEUTRAL:this.mat("objective-neutral",new BABYLON.Color3(.72,.62,.26))
    };
  }
  mat(name,color){const m=new BABYLON.StandardMaterial(name,this.scene);m.diffuseColor=color;m.emissiveColor=color.scale(.18);return m;}
  surfaceY(tile){return surfaceZ(tile)*ELEVATION_HEIGHT;}
  signature(state,byKey){
    const cores=(state?.cores||[]).map(core=>[
      "C",core.id,ownerKey(core.owner),core.hp>0?1:0,core.x,core.y,
      surfaceZ(byKey.get(tileKey(core.x,core.y))).toFixed(3)
    ].join(":"));
    const points=(state?.presentation?.deploymentPoints||[]).filter(point=>point.capturable!==false&&point.captureTiles?.[0]).map(point=>{
      const tile=point.captureTiles[0];
      return["P",point.id,ownerKey(point.owner),tile.x,tile.y,surfaceZ(byKey.get(tileKey(tile.x,tile.y))).toFixed(3)].join(":");
    });
    return [...cores,...points].sort().join(";");
  }
  sync(state){
    const tiles=state?.map?.tiles||[],byKey=new Map(tiles.map(tile=>[tileKey(tile.x,tile.y),tile]));
    const signature=this.signature(state,byKey);
    if(signature===this.signatureValue)return;
    this.signatureValue=signature;

    const coreAlive=new Set();
    for(const core of state?.cores||[]){
      coreAlive.add(core.id);let mesh=this.cores.get(core.id);
      if(!mesh){mesh=BABYLON.MeshBuilder.CreateBox(`core-${core.id}`,{width:1.22,depth:1.22,height:1.65},this.scene);mesh.isPickable=false;this.cores.set(core.id,mesh);}
      const tile=byKey.get(tileKey(core.x,core.y));
      mesh.material=this.materials[ownerKey(core.owner)];
      mesh.position.set(core.x*TILE_SIZE,this.surfaceY(tile)+.825,core.y*TILE_SIZE);
      mesh.visibility=core.hp>0?1:.2;
    }
    for(const[id,mesh]of this.cores)if(!coreAlive.has(id)){mesh.dispose();this.cores.delete(id);}

    const pointAlive=new Set();
    for(const point of state?.presentation?.deploymentPoints||[]){
      if(point.capturable===false)continue;
      const capture=point.captureTiles?.[0];if(!capture)continue;
      pointAlive.add(point.id);let mesh=this.points.get(point.id);
      if(!mesh){mesh=BABYLON.MeshBuilder.CreateCylinder(`capture-${point.id}`,{diameter:1.35,height:.09,tessellation:32},this.scene);mesh.isPickable=false;this.points.set(point.id,mesh);}
      const tile=byKey.get(tileKey(capture.x,capture.y));
      mesh.material=this.materials[ownerKey(point.owner)];
      mesh.position.set(capture.x*TILE_SIZE,this.surfaceY(tile)+.07,capture.y*TILE_SIZE);
    }
    for(const[id,mesh]of this.points)if(!pointAlive.has(id)){mesh.dispose();this.points.delete(id);}
  }
}
