import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";

const keyOf=tile=>`${tile.x},${tile.y}`;
const surfaceOf=tile=>tile.waterSurfaceZ==null
  ?Number(tile.elevation||0)
  :Math.max(Number(tile.elevation||0),Number(tile.waterSurfaceZ));

export class GridPicker{
  constructor(scene,canvas){
    this.scene=scene;this.canvas=canvas;this.hitMeshes=new Map();this.unitHits=new Map();
  }

  pickCurrent(){
    // The visible 3D character occupies screen pixels ABOVE its ground tile.
    // A ground-only ray can select the tile BEHIND a tall character (especially
    // on iPhone's tilted camera), making enemy-targeted map skills appear dead.
    // This is one shared pick surface for local / Gemini / PvP, not targeting logic.
    const pick=this.scene.pick(this.scene.pointerX,this.scene.pointerY,mesh=>
      mesh?.metadata?.kind==="tile-hit"||mesh?.metadata?.kind==="unit-hit");
    const meta=pick?.pickedMesh?.metadata;
    return pick?.hit&&(meta?.kind==="tile-hit"||meta?.kind==="unit-hit")
      ?{x:meta.x,y:meta.y}:null;
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

    // One persistent, invisible picking collider per *already visible* unit.
    // Never query the private roster: PvP supplies only the authorized snapshot.
    // Do not attach to animation meshes, which are intentionally non-pickable.
    const visible=new Set();
    for(const unit of state?.units||[]){
      if(!unit?.id||unit.alive===false)continue;
      const id=String(unit.id);visible.add(id);
      const width=Math.max(1,Math.floor(Number(unit.footprint?.width||1)));
      const depth=Math.max(1,Math.floor(Number(unit.footprint?.height||1)));
      const height=Math.max(.75,Number(unit.collisionHeight||1.7));
      let mesh=this.unitHits.get(id);
      if(!mesh){
        mesh=BABYLON.MeshBuilder.CreateBox(`unit-hit-${id}`,{width:TILE_SIZE*.78,depth:TILE_SIZE*.78,height:1},this.scene);
        mesh.metadata={kind:"unit-hit",unitId:id,x:unit.x,y:unit.y};
        mesh.isPickable=true;mesh.visibility=0;mesh.renderingGroupId=0;
        mesh.receiveShadows=false;
        this.unitHits.set(id,mesh);
      }
      mesh.metadata.x=unit.x;mesh.metadata.y=unit.y;
      mesh.scaling.set(width, height, depth);
      mesh.position.set((Number(unit.x)+(width-1)/2)*TILE_SIZE,
        Number(unit.renderZ??unit.z??0)*ELEVATION_HEIGHT+height*.5,
        (Number(unit.y)+(depth-1)/2)*TILE_SIZE);
    }
    for(const[id,mesh]of this.unitHits){if(visible.has(id))continue;mesh.dispose();this.unitHits.delete(id);}
  }
}
