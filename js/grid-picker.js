import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";

const keyOf=tile=>`${tile.x},${tile.y}`;
const surfaceOf=tile=>tile.waterSurfaceZ==null
  ?Number(tile.elevation||0)
  :Math.max(Number(tile.elevation||0),Number(tile.waterSurfaceZ));

export class GridPicker{
  constructor(scene,canvas){
    this.scene=scene;this.canvas=canvas;this.hitMeshes=new Map();
  }

  pickCurrent(){
    const pick=this.scene.pick(this.scene.pointerX,this.scene.pointerY,mesh=>mesh?.metadata?.kind==="tile-hit");
    const meta=pick?.pickedMesh?.metadata;
    return pick?.hit&&meta?.kind==="tile-hit"?{x:meta.x,y:meta.y}:null;
  }

  sync(state){
    const alive=new Set();
    for(const tile of state?.map?.tiles||[]){
      const key=keyOf(tile);alive.add(key);
      let mesh=this.hitMeshes.get(key);
      if(!mesh){
        mesh=BABYLON.MeshBuilder.CreateBox(`tile-hit-${key}`,{width:TILE_SIZE*.995,depth:TILE_SIZE*.995,height:.035},this.scene);
        mesh.metadata={kind:"tile-hit",x:tile.x,y:tile.y};
        mesh.isPickable=true;mesh.visibility=0;mesh.renderingGroupId=0;
        this.hitMeshes.set(key,mesh);
      }
      mesh.metadata.x=tile.x;mesh.metadata.y=tile.y;
      mesh.position.set(tile.x*TILE_SIZE,surfaceOf(tile)*ELEVATION_HEIGHT+.0175,tile.y*TILE_SIZE);
    }
    for(const[key,mesh]of this.hitMeshes){if(alive.has(key))continue;mesh.dispose();this.hitMeshes.delete(key);}
  }
}
