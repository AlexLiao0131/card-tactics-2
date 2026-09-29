import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";

const keyOf=t=>`${t.x},${t.y}`;
const tilesOf=state=>state?.map?.tiles||state?.grid?.tiles||[];
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));

function phaseFor(key){
  let hash=2166136261;
  for(const ch of String(key)){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return((hash>>>0)%1000)/1000*Math.PI*2;
}

export class WaterRenderer{
  constructor(scene){
    this.scene=scene;
    this.volumes=new Map();
    this.surfaces=new Map();
    this.ripples=new Map();

    this.clearVolumeMaterial=this.makeVolumeMaterial(
      "waterVolumeClear",new BABYLON.Color3(.09,.29,.50),.34,new BABYLON.Color3(.18,.31,.42)
    );
    this.murkyVolumeMaterial=this.makeVolumeMaterial(
      "waterVolumeMurky",new BABYLON.Color3(.25,.28,.17),.50,new BABYLON.Color3(.16,.20,.12)
    );
    this.muddyVolumeMaterial=this.makeVolumeMaterial(
      "waterVolumeMuddy",new BABYLON.Color3(.31,.20,.10),.58,new BABYLON.Color3(.12,.09,.05)
    );

    this.surfaceMaterial=this.makeSurfaceMaterial();

    this.rippleMaterial=new BABYLON.StandardMaterial("waterRippleMaterial",scene);
    this.rippleMaterial.diffuseColor=new BABYLON.Color3(.50,.78,.96);
    this.rippleMaterial.emissiveColor=new BABYLON.Color3(.10,.24,.34);
    this.rippleMaterial.alpha=.25;
    this.rippleMaterial.disableLighting=true;
    this.rippleMaterial.backFaceCulling=false;

    this.beforeRender=this.scene.onBeforeRenderObservable.add(()=>{
      const time=performance.now()/1000;
      for(const ripple of this.ripples.values()){
        ripple.rings.forEach((ring,index)=>{
          const pulse=1+Math.sin(time*1.25+ripple.phase+index*Math.PI)*.055;
          ring.scaling.set(pulse,1,pulse);
        });
      }
    });
  }

  makeVolumeMaterial(name,color,alpha,specular){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;
    material.alpha=alpha;
    material.specularColor=specular;
    material.specularPower=32;
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
      material.windForce=4;
      material.waveHeight=.08;
      material.bumpHeight=.12;
      material.waveLength=.35;
      material.windDirection=new BABYLON.Vector2(1,.35);
      material.waterColor=new BABYLON.Color3(.08,.34,.58);
      material.colorBlendFactor=.34;
      material.alpha=.82;
      material.backFaceCulling=false;
      return material;
    }

    // Materials Library failed/unavailable: battle still boots with the old-style surface.
    const material=new BABYLON.StandardMaterial("waterSurfaceFallback",this.scene);
    material.diffuseColor=new BABYLON.Color3(.10,.43,.70);
    material.alpha=.62;
    material.specularColor=new BABYLON.Color3(.55,.72,.84);
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
      {width:TILE_SIZE*.88,depth:TILE_SIZE*.88,height:1},
      this.scene
    );
    mesh.material=this.clearVolumeMaterial;
    mesh.isPickable=false;
    mesh.metadata={kind:"water-volume"};
    this.volumes.set(key,mesh);
    return mesh;
  }

  createSurface(key){
    const mesh=BABYLON.MeshBuilder.CreateGround(
      `water-surface-${key}`,
      {width:TILE_SIZE*.90,height:TILE_SIZE*.90,subdivisions:4},
      this.scene
    );
    mesh.material=this.surfaceMaterial;
    mesh.isPickable=false;
    mesh.metadata={kind:"water-surface"};
    this.surfaces.set(key,mesh);
    return mesh;
  }

  createRipples(key){
    const rings=[.52,.96].map((diameter,index)=>{
      const ring=BABYLON.MeshBuilder.CreateTorus(
        `water-ripple-${key}-${index}`,
        {diameter,thickness:.025,tessellation:24},
        this.scene
      );
      ring.material=this.rippleMaterial;
      ring.isPickable=false;
      return ring;
    });
    const ripple={rings,phase:phaseFor(key)};
    this.ripples.set(key,ripple);
    return ripple;
  }

  syncSurfaceDynamics(waterTiles){
    if(typeof BABYLON.WaterMaterial!=="function"||!(this.surfaceMaterial instanceof BABYLON.WaterMaterial)||!waterTiles.length)return;
    const maxFlow=waterTiles.reduce((max,tile)=>Math.max(max,Number(tile.flowSpeed||0)),0);
    const averageTurbidity=waterTiles.reduce((sum,tile)=>sum+clamp(tile.waterTurbidity||0,0,1),0)/waterTiles.length;
    this.surfaceMaterial.windForce=clamp(3+maxFlow*1.25,3,8);
    this.surfaceMaterial.waveHeight=clamp(.055+maxFlow*.02,.055,.14);
    this.surfaceMaterial.bumpHeight=clamp(.10+maxFlow*.018,.10,.18);
    this.surfaceMaterial.colorBlendFactor=clamp(.30+averageTurbidity*.08,.30,.38);
  }

  sync(state){
    const alive=new Set();
    const waterTiles=tilesOf(state).filter(tile=>Math.max(0,Number(tile.waterDepth||0))>0);
    this.syncSurfaceDynamics(waterTiles);

    for(const tile of waterTiles){
      const depth=Math.max(0,Number(tile.waterDepth||0));
      const surface=tile.waterSurfaceZ==null
        ?Number(tile.elevation||0)+depth
        :Number(tile.waterSurfaceZ);
      const key=keyOf(tile);
      alive.add(key);

      const height=Math.max(.001,depth*ELEVATION_HEIGHT);
      const bottom=Number(tile.elevation||0)*ELEVATION_HEIGHT;
      const top=surface*ELEVATION_HEIGHT;
      const visibility=tile.fogged?.22:1;

      const volume=this.volumes.get(key)||this.createVolume(key);
      volume.material=this.volumeMaterialFor(tile);
      volume.scaling.y=height;
      volume.position.set(tile.x*TILE_SIZE,(bottom+top)/2,tile.y*TILE_SIZE);
      volume.visibility=visibility;

      const surfaceMesh=this.surfaces.get(key)||this.createSurface(key);
      surfaceMesh.position.set(tile.x*TILE_SIZE,top+.012,tile.y*TILE_SIZE);
      surfaceMesh.visibility=visibility;

      const ripple=this.ripples.get(key)||this.createRipples(key);
      ripple.rings.forEach((ring,index)=>{
        const offset=index===0?-.26:.24;
        ring.position.set(
          tile.x*TILE_SIZE+offset,
          top+.026+index*.004,
          tile.y*TILE_SIZE+(index===0?.18:-.16)
        );
        ring.visibility=tile.fogged?0:.62;
      });
    }

    for(const[key,mesh]of this.volumes){
      if(alive.has(key))continue;
      mesh.dispose();
      this.volumes.delete(key);
    }
    for(const[key,mesh]of this.surfaces){
      if(alive.has(key))continue;
      mesh.dispose();
      this.surfaces.delete(key);
    }
    for(const[key,ripple]of this.ripples){
      if(alive.has(key))continue;
      ripple.rings.forEach(ring=>ring.dispose());
      this.ripples.delete(key);
    }
  }

  diagnostics(){
    return{
      volumes:this.volumes.size,
      surfaces:this.surfaces.size,
      waterMaterial:typeof BABYLON.WaterMaterial==="function",
      materialName:this.surfaceMaterial?.name||null
    };
  }
}
