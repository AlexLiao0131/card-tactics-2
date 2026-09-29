import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";

const tilesOf=state=>state?.map?.tiles||state?.grid?.tiles||[];
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));
const surfaceOf=tile=>tile?.waterSurfaceZ==null
  ?Number(tile?.elevation||0)+Math.max(0,Number(tile?.waterDepth||0))
  :Number(tile.waterSurfaceZ);

const UV_WORLD_SCALE=TILE_SIZE*3.25;
const SURFACE_OFFSET=.012;

export class WaterRenderer{
  constructor(scene){
    this.scene=scene;
    this.volumes=new Map();
    this.surfaceMeshes=new Map();
    this.surfaceSignature="";

    this.clearVolumeMaterial=this.makeVolumeMaterial(
      "waterVolumeClear",new BABYLON.Color3(.075,.255,.46),.28,new BABYLON.Color3(.16,.28,.39)
    );
    this.murkyVolumeMaterial=this.makeVolumeMaterial(
      "waterVolumeMurky",new BABYLON.Color3(.23,.26,.16),.44,new BABYLON.Color3(.14,.18,.10)
    );
    this.muddyVolumeMaterial=this.makeVolumeMaterial(
      "waterVolumeMuddy",new BABYLON.Color3(.30,.19,.095),.54,new BABYLON.Color3(.11,.08,.045)
    );

    this.surfaceMaterial=this.makeSurfaceMaterial();
  }

  makeVolumeMaterial(name,color,alpha,specular){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;
    material.alpha=alpha;
    material.specularColor=specular;
    material.specularPower=24;
    material.backFaceCulling=false;
    return material;
  }

  makeSurfaceMaterial(){
    if(typeof BABYLON.WaterMaterial==="function"){
      const material=new BABYLON.WaterMaterial(
        "waterSurfaceMaterial",
        this.scene,
        new BABYLON.Vector2(256,256)
      );
      material.bumpTexture=new BABYLON.Texture(
        "https://assets.babylonjs.com/textures/waterbump.png",
        this.scene
      );
      material.bumpTexture.wrapU=BABYLON.Texture.WRAP_ADDRESSMODE;
      material.bumpTexture.wrapV=BABYLON.Texture.WRAP_ADDRESSMODE;
      material.bumpTexture.uScale=.55;
      material.bumpTexture.vScale=.55;
      material.windForce=2.4;
      material.waveHeight=.035;
      material.bumpHeight=.055;
      material.waveLength=.9;
      material.windDirection=new BABYLON.Vector2(1,.28);
      material.waterColor=new BABYLON.Color3(.055,.30,.52);
      material.colorBlendFactor=.26;
      material.alpha=.70;
      material.backFaceCulling=false;
      return material;
    }

    const material=new BABYLON.StandardMaterial("waterSurfaceFallback",this.scene);
    material.diffuseColor=new BABYLON.Color3(.075,.38,.64);
    material.alpha=.56;
    material.specularColor=new BABYLON.Color3(.50,.68,.82);
    material.specularPower=64;
    material.backFaceCulling=false;
    return material;
  }

  volumeMaterialFor(tile){
    const value=clamp(tile?.waterTurbidity||0,0,1);
    return value>=.6?this.muddyVolumeMaterial:value>=.18?this.murkyVolumeMaterial:this.clearVolumeMaterial;
  }

  createVolume(key){
    const mesh=BABYLON.MeshBuilder.CreateBox(
      `water-volume-${key}`,
      {width:TILE_SIZE,depth:TILE_SIZE,height:1},
      this.scene
    );
    mesh.material=this.clearVolumeMaterial;
    mesh.isPickable=false;
    mesh.metadata={kind:"water-volume"};
    this.volumes.set(key,mesh);
    return mesh;
  }

  surfaceGroup(tile){return tile?.fogged?"fogged":"visible";}

  surfaceTopologySignature(waterTiles){
    return waterTiles
      .map(tile=>`${tile.x},${tile.y}:${surfaceOf(tile).toFixed(4)}:${this.surfaceGroup(tile)}`)
      .sort()
      .join("|");
  }

  disposeSurfaceMeshes(){
    for(const mesh of this.surfaceMeshes.values())mesh.dispose();
    this.surfaceMeshes.clear();
  }

  buildSurfaceMesh(group,waterTiles){
    if(!waterTiles.length)return null;

    const positions=[],indices=[],normals=[],uvs=[];
    const half=TILE_SIZE*.5;

    for(const tile of waterTiles){
      const cx=Number(tile.x)*TILE_SIZE;
      const cz=Number(tile.y)*TILE_SIZE;
      const y=surfaceOf(tile)*ELEVATION_HEIGHT+SURFACE_OFFSET;
      const base=positions.length/3;
      const corners=[
        [cx-half,y,cz-half],
        [cx+half,y,cz-half],
        [cx+half,y,cz+half],
        [cx-half,y,cz+half]
      ];

      for(const [x,py,z] of corners){
        positions.push(x,py,z);
        normals.push(0,1,0);
        // Absolute world-space UVs make the bump pattern continuous across tile boundaries.
        uvs.push(x/UV_WORLD_SCALE,z/UV_WORLD_SCALE);
      }

      // Up-facing triangles in Babylon's left-handed world.
      indices.push(base,base+2,base+1,base,base+3,base+2);
    }

    const mesh=new BABYLON.Mesh(`water-surface-${group}`,this.scene);
    const data=new BABYLON.VertexData();
    data.positions=positions;
    data.indices=indices;
    data.normals=normals;
    data.uvs=uvs;
    data.applyToMesh(mesh,false);
    mesh.material=this.surfaceMaterial;
    mesh.isPickable=false;
    mesh.visibility=group==="fogged"?.22:1;
    mesh.metadata={kind:"water-surface",group,tileCount:waterTiles.length};
    mesh.freezeWorldMatrix();
    this.surfaceMeshes.set(group,mesh);
    return mesh;
  }

  rebuildSurfaceMeshes(waterTiles){
    this.disposeSurfaceMeshes();
    const groups=new Map([["visible",[]],["fogged",[]]]);
    for(const tile of waterTiles)groups.get(this.surfaceGroup(tile)).push(tile);
    for(const [group,tiles] of groups)if(tiles.length)this.buildSurfaceMesh(group,tiles);
    this.surfaceSignature=this.surfaceTopologySignature(waterTiles);
  }

  syncSurfaceDynamics(waterTiles){
    if(typeof BABYLON.WaterMaterial!=="function"||!(this.surfaceMaterial instanceof BABYLON.WaterMaterial)||!waterTiles.length)return;
    const maxFlow=waterTiles.reduce((max,tile)=>Math.max(max,Number(tile.flowSpeed||0)),0);
    const averageTurbidity=waterTiles.reduce((sum,tile)=>sum+clamp(tile.waterTurbidity||0,0,1),0)/waterTiles.length;

    // Keep waves broad and subtle. Current direction is rendered by the dedicated CURRENT renderer,
    // so WaterMaterial is only the continuous visual surface, not a gameplay direction indicator.
    this.surfaceMaterial.windForce=clamp(2.2+maxFlow*.55,2.2,4.6);
    this.surfaceMaterial.waveHeight=clamp(.032+maxFlow*.009,.032,.075);
    this.surfaceMaterial.bumpHeight=clamp(.05+maxFlow*.008,.05,.095);
    this.surfaceMaterial.waveLength=clamp(.95-maxFlow*.04,.68,.95);
    this.surfaceMaterial.colorBlendFactor=clamp(.24+averageTurbidity*.07,.24,.31);
  }

  sync(state){
    const alive=new Set();
    const waterTiles=tilesOf(state).filter(tile=>Math.max(0,Number(tile.waterDepth||0))>0);
    this.syncSurfaceDynamics(waterTiles);

    for(const tile of waterTiles){
      const depth=Math.max(0,Number(tile.waterDepth||0));
      const surface=surfaceOf(tile);
      const key=`${tile.x},${tile.y}`;
      alive.add(key);

      const height=Math.max(.001,depth*ELEVATION_HEIGHT);
      const bottom=Number(tile.elevation||0)*ELEVATION_HEIGHT;
      const top=surface*ELEVATION_HEIGHT;

      const volume=this.volumes.get(key)||this.createVolume(key);
      volume.material=this.volumeMaterialFor(tile);
      volume.scaling.y=height;
      volume.position.set(tile.x*TILE_SIZE,(bottom+top)/2,tile.y*TILE_SIZE);
      volume.visibility=tile.fogged?.18:1;
    }

    for(const[key,mesh]of this.volumes){
      if(alive.has(key))continue;
      mesh.dispose();
      this.volumes.delete(key);
    }

    const signature=this.surfaceTopologySignature(waterTiles);
    if(signature!==this.surfaceSignature)this.rebuildSurfaceMeshes(waterTiles);
    if(!waterTiles.length&&this.surfaceMeshes.size)this.disposeSurfaceMeshes();
  }

  diagnostics(){
    return{
      volumes:this.volumes.size,
      surfaceMeshes:this.surfaceMeshes.size,
      surfaceTiles:[...this.surfaceMeshes.values()].reduce((sum,mesh)=>sum+Number(mesh.metadata?.tileCount||0),0),
      waterMaterial:typeof BABYLON.WaterMaterial==="function",
      materialName:this.surfaceMaterial?.name||null,
      continuousWorldUv:true
    };
  }
}
