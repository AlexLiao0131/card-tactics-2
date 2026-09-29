import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";

const tilesOf=state=>state?.map?.tiles||state?.grid?.tiles||[];
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));
const keyOf=(x,y)=>`${x},${y}`;
const surfaceOf=tile=>tile?.waterSurfaceZ==null
  ?Number(tile?.elevation||0)+Math.max(0,Number(tile?.waterDepth||0))
  :Number(tile.waterSurfaceZ);

const UV_WORLD_SCALE=TILE_SIZE*3.25;
const SURFACE_OFFSET=.014;
const EPSILON=.001;
const DIRS=Object.freeze([
  {dx:1,dy:0,edge:"E"},
  {dx:-1,dy:0,edge:"W"},
  {dx:0,dy:1,edge:"S"},
  {dx:0,dy:-1,edge:"N"}
]);

export class WaterRenderer{
  constructor(scene){
    this.scene=scene;
    this.surfaceMeshes=new Map();
    this.skirtMeshes=new Map();
    this.surfaceSignature="";
    this.skirtSignature="";

    this.surfaceMaterial=this.makeSurfaceMaterial();

    this.clearSkirtMaterial=this.makeSkirtMaterial(
      "waterSkirtClear",
      new BABYLON.Color3(.055,.23,.40),
      .34
    );
    this.murkySkirtMaterial=this.makeSkirtMaterial(
      "waterSkirtMurky",
      new BABYLON.Color3(.22,.24,.14),
      .46
    );
    this.muddySkirtMaterial=this.makeSkirtMaterial(
      "waterSkirtMuddy",
      new BABYLON.Color3(.28,.17,.08),
      .56
    );
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
      material.bumpTexture.uScale=.42;
      material.bumpTexture.vScale=.42;

      // WaterMaterial is now the actual water body surface, not an overlay on top
      // of per-tile translucent boxes.
      material.windForce=2.0;
      material.waveHeight=.028;
      material.bumpHeight=.045;
      material.waveLength=1.15;
      material.windDirection=new BABYLON.Vector2(1,.24);
      material.waterColor=new BABYLON.Color3(.045,.27,.46);
      material.colorBlendFactor=.34;
      material.alpha=.78;
      material.backFaceCulling=false;
      return material;
    }

    const material=new BABYLON.StandardMaterial("waterSurfaceFallback",this.scene);
    material.diffuseColor=new BABYLON.Color3(.065,.33,.55);
    material.alpha=.68;
    material.specularColor=new BABYLON.Color3(.46,.67,.82);
    material.specularPower=64;
    material.backFaceCulling=false;
    return material;
  }

  makeSkirtMaterial(name,color,alpha){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;
    material.emissiveColor=color.scale(.08);
    material.alpha=alpha;
    material.specularColor=new BABYLON.Color3(.10,.16,.22);
    material.specularPower=18;
    material.backFaceCulling=false;
    material.needDepthPrePass=true;
    return material;
  }

  surfaceGroup(tile){return tile?.fogged?"fogged":"visible";}
  turbidityGroup(tile){
    const value=clamp(tile?.waterTurbidity||0,0,1);
    return value>=.6?"muddy":value>=.18?"murky":"clear";
  }

  waterTiles(state){
    return tilesOf(state).filter(tile=>Math.max(0,Number(tile?.waterDepth||0))>EPSILON);
  }

  waterByKey(waterTiles){
    return new Map(waterTiles.map(tile=>[keyOf(tile.x,tile.y),tile]));
  }

  disposeMap(map){
    for(const mesh of map.values())mesh.dispose();
    map.clear();
  }

  surfaceTopologySignature(waterTiles){
    return waterTiles
      .map(tile=>`${tile.x},${tile.y}:${surfaceOf(tile).toFixed(4)}:${this.surfaceGroup(tile)}`)
      .sort()
      .join("|");
  }

  skirtTopologySignature(waterTiles){
    return waterTiles
      .map(tile=>`${tile.x},${tile.y}:${Number(tile.elevation||0).toFixed(4)}:${surfaceOf(tile).toFixed(4)}:${this.surfaceGroup(tile)}:${this.turbidityGroup(tile)}`)
      .sort()
      .join("|");
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
        // World-space UVs keep the bump map continuous across grid cells.
        uvs.push(x/UV_WORLD_SCALE,z/UV_WORLD_SCALE);
      }

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

  sideCorners(tile,edge,topY,bottomY){
    const cx=Number(tile.x)*TILE_SIZE;
    const cz=Number(tile.y)*TILE_SIZE;
    const h=TILE_SIZE*.5;

    if(edge==="E")return[
      [cx+h,bottomY,cz-h],[cx+h,bottomY,cz+h],
      [cx+h,topY,cz+h],[cx+h,topY,cz-h]
    ];
    if(edge==="W")return[
      [cx-h,bottomY,cz+h],[cx-h,bottomY,cz-h],
      [cx-h,topY,cz-h],[cx-h,topY,cz+h]
    ];
    if(edge==="S")return[
      [cx+h,bottomY,cz+h],[cx-h,bottomY,cz+h],
      [cx-h,topY,cz+h],[cx+h,topY,cz+h]
    ];
    return[
      [cx-h,bottomY,cz-h],[cx+h,bottomY,cz-h],
      [cx+h,topY,cz-h],[cx-h,topY,cz-h]
    ];
  }

  buildSkirtMesh(group,turbidity,tiles,waterMap){
    const positions=[],indices=[],normals=[],uvs=[];

    for(const tile of tiles){
      const top=surfaceOf(tile)*ELEVATION_HEIGHT;
      const bed=Number(tile.elevation||0)*ELEVATION_HEIGHT;

      for(const {dx,dy,edge} of DIRS){
        const neighbor=waterMap.get(keyOf(Number(tile.x)+dx,Number(tile.y)+dy));
        const neighborTop=neighbor?surfaceOf(neighbor)*ELEVATION_HEIGHT:null;

        // Interior water at the same/higher level has no visible vertical side.
        if(neighbor&&neighborTop>=top-EPSILON)continue;

        // At a shoreline, the visible water wall runs down to this tile's bed.
        // Against lower water, only the exposed difference is rendered.
        const bottom=neighbor
          ?Math.max(bed,neighborTop)
          :bed;

        if(top-bottom<=EPSILON)continue;

        const corners=this.sideCorners(tile,edge,top,bottom);
        const base=positions.length/3;

        for(const [x,y,z] of corners){
          positions.push(x,y,z);
          // Babylon can calculate exact normals later; placeholders keep arrays aligned.
          normals.push(0,0,0);
          uvs.push(x/UV_WORLD_SCALE,y/UV_WORLD_SCALE);
        }

        indices.push(base,base+1,base+2,base,base+2,base+3);
      }
    }

    if(!positions.length)return null;

    BABYLON.VertexData.ComputeNormals(positions,indices,normals);
    const mesh=new BABYLON.Mesh(`water-skirt-${group}-${turbidity}`,this.scene);
    const data=new BABYLON.VertexData();
    data.positions=positions;
    data.indices=indices;
    data.normals=normals;
    data.uvs=uvs;
    data.applyToMesh(mesh,false);

    mesh.material=turbidity==="muddy"
      ?this.muddySkirtMaterial
      :turbidity==="murky"
        ?this.murkySkirtMaterial
        :this.clearSkirtMaterial;

    mesh.isPickable=false;
    mesh.visibility=group==="fogged"?.18:1;
    mesh.metadata={kind:"water-skirt",group,turbidity,segmentCount:indices.length/6};
    mesh.freezeWorldMatrix();
    this.skirtMeshes.set(`${group}:${turbidity}`,mesh);
    return mesh;
  }

  rebuildSurfaceMeshes(waterTiles){
    this.disposeMap(this.surfaceMeshes);
    const groups=new Map([["visible",[]],["fogged",[]]]);
    for(const tile of waterTiles)groups.get(this.surfaceGroup(tile)).push(tile);
    for(const [group,tiles] of groups)if(tiles.length)this.buildSurfaceMesh(group,tiles);
    this.surfaceSignature=this.surfaceTopologySignature(waterTiles);
  }

  rebuildSkirtMeshes(waterTiles){
    this.disposeMap(this.skirtMeshes);
    const waterMap=this.waterByKey(waterTiles);
    const groups=new Map();

    for(const tile of waterTiles){
      const id=`${this.surfaceGroup(tile)}:${this.turbidityGroup(tile)}`;
      if(!groups.has(id))groups.set(id,[]);
      groups.get(id).push(tile);
    }

    for(const [id,tiles] of groups){
      const [group,turbidity]=id.split(":");
      this.buildSkirtMesh(group,turbidity,tiles,waterMap);
    }

    this.skirtSignature=this.skirtTopologySignature(waterTiles);
  }

  syncSurfaceDynamics(waterTiles){
    if(typeof BABYLON.WaterMaterial!=="function"||
       !(this.surfaceMaterial instanceof BABYLON.WaterMaterial)||
       !waterTiles.length)return;

    const maxFlow=waterTiles.reduce(
      (max,tile)=>Math.max(max,Number(tile?.flowSpeed||0)),0
    );
    const averageTurbidity=waterTiles.reduce(
      (sum,tile)=>sum+clamp(tile?.waterTurbidity||0,0,1),0
    )/waterTiles.length;

    this.surfaceMaterial.windForce=clamp(1.9+maxFlow*.42,1.9,4.0);
    this.surfaceMaterial.waveHeight=clamp(.026+maxFlow*.007,.026,.060);
    this.surfaceMaterial.bumpHeight=clamp(.042+maxFlow*.006,.042,.080);
    this.surfaceMaterial.waveLength=clamp(1.18-maxFlow*.035,.80,1.18);

    // Turbidity is still data-driven. The top surface changes gently, while the
    // exposed side walls carry the stronger local clear/murky/muddy distinction.
    this.surfaceMaterial.colorBlendFactor=clamp(.32+averageTurbidity*.10,.32,.42);
  }

  sync(state){
    const waterTiles=this.waterTiles(state);
    this.syncSurfaceDynamics(waterTiles);

    const surfaceSignature=this.surfaceTopologySignature(waterTiles);
    if(surfaceSignature!==this.surfaceSignature){
      this.rebuildSurfaceMeshes(waterTiles);
    }

    const skirtSignature=this.skirtTopologySignature(waterTiles);
    if(skirtSignature!==this.skirtSignature){
      this.rebuildSkirtMeshes(waterTiles);
    }

    if(!waterTiles.length){
      if(this.surfaceMeshes.size)this.disposeMap(this.surfaceMeshes);
      if(this.skirtMeshes.size)this.disposeMap(this.skirtMeshes);
      this.surfaceSignature="";
      this.skirtSignature="";
    }
  }

  diagnostics(){
    return{
      surfaceMeshes:this.surfaceMeshes.size,
      skirtMeshes:this.skirtMeshes.size,
      surfaceTiles:[...this.surfaceMeshes.values()].reduce(
        (sum,mesh)=>sum+Number(mesh.metadata?.tileCount||0),0
      ),
      skirtSegments:[...this.skirtMeshes.values()].reduce(
        (sum,mesh)=>sum+Number(mesh.metadata?.segmentCount||0),0
      ),
      waterMaterial:typeof BABYLON.WaterMaterial==="function",
      materialName:this.surfaceMaterial?.name||null,
      perTileWaterBoxes:false,
      continuousWorldUv:true,
      boundaryDepthSkirts:true
    };
  }
}
