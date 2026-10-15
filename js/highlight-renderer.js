import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";
const keyOf=tile=>`${tile.x},${tile.y}`;
const surfaceOf=tile=>tile.waterSurfaceZ==null?Number(tile.elevation||0):Math.max(Number(tile.elevation||0),Number(tile.waterSurfaceZ));
const highlightKind=tile=>tile.inspected?"inspected":tile.attackable?"attackable":tile.deployable?"deployable":tile.targetRange?"targetRange":tile.reachable?"reachable":null;
export class HighlightRenderer{
  constructor(scene){
    this.scene=scene;this.dynamic=new Map();this.areas=new Map();this.signatureValue=null;
    this.lastState=null;this.terrainMesh=null;this.terrainTops=new Map();
    // BabylonRenderer publishes terrain after the tactical overlays. React to
    // that exact published geometry in the same scene frame, like ObjectiveRenderer.
    scene.onBeforeRenderObservable.add(()=>{
      const current=this.publishedTerrainMesh();
      if(current!==this.terrainMesh&&this.lastState)this.sync(this.lastState);
    });
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
  mat(name,color,alpha){
    const m=new BABYLON.StandardMaterial(name,this.scene);
    m.diffuseColor=color;m.emissiveColor=color;m.alpha=alpha;m.disableLighting=true;
    // Tactical indicators are overlays, not opaque terrain or shadow occluders.
    m.disableDepthWrite=true;return m;
  }
  publishedTerrainMesh(){
    const mesh=this.scene.getMeshByName("terrain-surface");
    return mesh?.metadata?.kind==="terrain-surface"?mesh:null;
  }
  syncPublishedTerrain(){
    const mesh=this.publishedTerrainMesh();
    if(mesh===this.terrainMesh)return;
    this.terrainMesh=mesh;this.terrainTops.clear();this.signatureValue=null;
    // Read terrain heights ONLY from the published Triangle Mesh; no guessed
    // 3x3 grid, duplicate terrain generator or second geometry owner.
    const positions=mesh?.getVerticesData?.(BABYLON.VertexBuffer.PositionKind)||[];
    for(let i=0;i+2<positions.length;i+=3){
      const x=Number(positions[i]),y=Number(positions[i+1]),z=Number(positions[i+2]);
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))continue;
      const key=`${Math.round(x/TILE_SIZE)},${Math.round(z/TILE_SIZE)}`;
      this.terrainTops.set(key,Math.max(this.terrainTops.get(key)??-Infinity,y));
    }
  }
  exposedSurfaceY(tile){
    const ground=Math.max(Number(tile.elevation||0)*ELEVATION_HEIGHT,
      this.terrainTops.get(keyOf(tile))??-Infinity);
    const waterDepth=Math.max(0,Number(tile.waterDepth||0));
    const water=surfaceOf(tile)*ELEVATION_HEIGHT;
    const ice=Math.max(0,Number(tile.iceThickness||0));
    const snow=Math.max(0,Number(tile.snowDepth||0));
    // Match the existing EnvironmentRenderer SNOW/ICE height contract. The
    // actual ground vertex is still taken from TerrainRenderer's 3D surface.
    const iceY=waterDepth>0&&ice>0?water+.034:-Infinity;
    const snowBase=waterDepth>0&&ice>=.45?water:ground;
    const snowY=snow>0?snowBase+Math.max(.006,snow*ELEVATION_HEIGHT):-Infinity;
    return Math.max(ground,water,iceY,snowY);
  }
  tileMesh(name,height=.026,scale=.94){
    const mesh=BABYLON.MeshBuilder.CreateBox(name,{width:TILE_SIZE*scale,depth:TILE_SIZE*scale,height},this.scene);
    // Water, snow and optical haze render as translucent layers underneath
    // tactical indicators. Visibility is UI, not a new water/terrain surface.
    mesh.isPickable=false;mesh.receiveShadows=false;mesh.alphaIndex=20;
    mesh.metadata={kind:"tactical-ground-highlight",castShadow:false};
    return mesh;
  }
  signature(tiles){
    const active=[];
    for(const tile of tiles){
      const areaOwner=tile.deploymentAreaOwner||"",kind=highlightKind(tile)||"";
      if(!areaOwner&&!kind)continue;
      active.push([tile.x,tile.y,this.exposedSurfaceY(tile).toFixed(3),areaOwner,kind].join(":"));
    }
    return active.sort().join(";");
  }
  sync(state){
    this.lastState=state;this.syncPublishedTerrain();
    const tiles=state?.map?.tiles||[],signature=this.signature(tiles);
    if(signature===this.signatureValue)return;
    this.signatureValue=signature;

    const dynAlive=new Set(),areaAlive=new Set();
    for(const tile of tiles){
      const key=keyOf(tile),surfaceY=this.exposedSurfaceY(tile),areaOwner=tile.deploymentAreaOwner;
      if(areaOwner){
        areaAlive.add(key);let area=this.areas.get(key);
        if(!area){area=this.tileMesh(`deploy-area-${key}`,.022,.94);this.areas.set(key,area);}
        area.position.set(tile.x*TILE_SIZE,surfaceY+.054,tile.y*TILE_SIZE);
        area.material=this.materials[areaOwner]||this.materials.NEUTRAL;
      }
      const kind=highlightKind(tile);
      if(kind){
        dynAlive.add(key);let mesh=this.dynamic.get(key);
        if(!mesh){mesh=this.tileMesh(`hl-${key}`,.035,.985);this.dynamic.set(key,mesh);}
        mesh.position.set(tile.x*TILE_SIZE,surfaceY+.080,tile.y*TILE_SIZE);mesh.material=this.materials[kind];
      }
    }
    for(const[key,mesh]of this.areas)if(!areaAlive.has(key)){mesh.dispose();this.areas.delete(key);}
    for(const[key,mesh]of this.dynamic)if(!dynAlive.has(key)){mesh.dispose();this.dynamic.delete(key);}
  }
  diagnostics(){
    const total=this.areas.size+this.dynamic.size;
    return{deploymentAreaMeshes:this.areas.size,dynamicHighlights:this.dynamic.size,
      terrainGeometryAligned:!!this.terrainMesh,visibleOverlayMeshes:[...this.areas.values(),...this.dynamic.values()]
        .filter(mesh=>mesh.isEnabled?.()!==false&&mesh.isVisible!==false).length,total};
  }
}
