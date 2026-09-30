import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";
import { VisualSurfaceResolver } from "./visual-surface-resolver.js";

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));
const keyOf=(tile,type)=>`${tile.x},${tile.y}:${type}`;
const surfaceOf=tile=>tile.waterSurfaceZ==null
  ?Number(tile.elevation||0)
  :Math.max(Number(tile.elevation||0),Number(tile.waterSurfaceZ));
const waterDepth=tile=>Math.max(0,Number(tile?.waterDepth||0));
const snowDepth=tile=>Math.max(0,Number(tile?.snowDepth||0));
const iceThickness=tile=>Math.max(0,Number(tile?.iceThickness||0));
const flowSpeed=tile=>Math.max(0,Number(tile?.flowSpeed||0));
const isSolidIce=tile=>waterDepth(tile)>0&&iceThickness(tile)>=.45;
const SURFACE_TYPES=new Set(["SNOW","ICE","CURRENT"]);
const SURFACE_EPSILON=.001;
const CURRENT_BANDS=Object.freeze([
  Object.freeze({id:"SLOW",min:0,max:1.15,scroll:.18}),
  Object.freeze({id:"MEDIUM",min:1.15,max:1.85,scroll:.31}),
  Object.freeze({id:"FAST",min:1.85,max:Infinity,scroll:.48})
]);

export class EnvironmentRenderer{
  constructor(scene,surfaceResolver=null){
    this.scene=scene;
    this.surfaceResolver=surfaceResolver||new VisualSurfaceResolver();
    this.nodes=new Map();
    this.animated=new Map();
    this.surfaceMeshes=new Map();
    this.surfaceSignature="";

    this.currentResources=this.makeCurrentResources();

    this.materials={
      fire:this.mat("env-fire",new BABYLON.Color3(1,.28,.04),.76,new BABYLON.Color3(.9,.12,.01)),
      fireWind:this.mat("env-fire-wind",new BABYLON.Color3(1,.32,.05),.56,new BABYLON.Color3(.75,.08,.01)),
      wind:this.mat("env-wind",new BABYLON.Color3(.68,.82,.90),.23,new BABYLON.Color3(.12,.18,.22)),
      steam:this.mat("env-steam",new BABYLON.Color3(.80,.86,.88),.26),
      smoke:this.mat("env-smoke",new BABYLON.Color3(.12,.13,.14),.42),
      electric:this.mat("env-electric",new BABYLON.Color3(.45,.80,1),.68,new BABYLON.Color3(.22,.55,.95)),
      snow:this.surfaceMat("env-snow",new BABYLON.Color3(.92,.96,1),.94),
      ice:this.surfaceMat("env-ice",new BABYLON.Color3(.48,.82,.96),.45,new BABYLON.Color3(.12,.28,.36)),
      fragments:this.mat("env-fragments",new BABYLON.Color3(.48,.46,.43),.9),
      boiling:this.mat("env-boiling",new BABYLON.Color3(.72,.90,1),.48,new BABYLON.Color3(.16,.36,.5))
    };

    this.beforeRender=this.scene.onBeforeRenderObservable.add(()=>{
      const dt=Math.min(.05,Math.max(0,Number(this.scene.getEngine().getDeltaTime()||16)/1000));
      for(const resource of this.currentResources.values()){
        resource.texture.vOffset=(resource.texture.vOffset-dt*resource.band.scroll)%1;
      }
      for(const {node,speed=0,spin=true} of this.animated.values())if(spin)node.rotation.y+=speed*dt;
    });
  }

  makeCurrentTexture(name,phase=0){
    // Mipmaps keep the broad current strokes readable after the battlefield is
    // downsampled on phones. Thin non-mipmapped lines vanished almost completely.
    const texture=new BABYLON.DynamicTexture(name,{width:256,height:256},this.scene,true);
    texture.hasAlpha=true;
    const ctx=texture.getContext();
    ctx.clearRect(0,0,256,256);
    ctx.lineCap="round";

    // Four broad hand-painted strokes. UV V is aligned to Hydrology flow, so
    // scrolling the texture translates these marks downstream instead of pulsing.
    [32,96,160,224].forEach((x,index)=>{
      const offset=((index*61+phase*97)%128)-128;
      for(let y=offset-128;y<300;y+=128){
        ctx.strokeStyle="rgba(240,253,255,0.95)";
        ctx.lineWidth=11;
        ctx.beginPath();
        ctx.moveTo(x,y);
        ctx.bezierCurveTo(x+10,y+22,x-10,y+44,x,y+70);
        ctx.stroke();
      }
    });

    texture.update();
    texture.wrapU=BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.wrapV=BABYLON.Texture.WRAP_ADDRESSMODE;
    return texture;
  }

  makeCurrentMaterial(name,texture){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseTexture=texture;
    // One alpha path only. Using the same translucent texture again as opacityTexture
    // multiplied alpha twice and made Safari/mobile currents effectively invisible.
    material.useAlphaFromDiffuseTexture=true;
    material.diffuseColor=new BABYLON.Color3(.74,.91,.96);
    material.ambientColor=new BABYLON.Color3(.20,.28,.31);
    material.emissiveColor=BABYLON.Color3.Black();
    material.specularColor=new BABYLON.Color3(.06,.10,.12);
    material.specularPower=12;
    material.alpha=1;
    material.backFaceCulling=false;
    material.needDepthPrePass=false;
    if(BABYLON.Material?.MATERIAL_ALPHABLEND!=null)material.transparencyMode=BABYLON.Material.MATERIAL_ALPHABLEND;
    return material;
  }

  makeCurrentResources(){
    const resources=new Map();
    CURRENT_BANDS.forEach((band,index)=>{
      const texture=this.makeCurrentTexture(`current-flow-${band.id.toLowerCase()}`,index/3);
      const material=this.makeCurrentMaterial(`env-current-${band.id.toLowerCase()}`,texture);
      resources.set(band.id,{band,texture,material});
    });
    return resources;
  }

  currentBand(tile){
    const speed=flowSpeed(tile);
    return CURRENT_BANDS.find(band=>speed>=band.min&&speed<band.max)||CURRENT_BANDS[CURRENT_BANDS.length-1];
  }

  mat(name,color,alpha=1,emissive=null){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;material.alpha=alpha;material.specularColor=BABYLON.Color3.Black();
    if(emissive)material.emissiveColor=emissive;return material;
  }

  surfaceMat(name,color,alpha=1,emissive=null){
    const material=this.mat(name,color,alpha,emissive);
    material.backFaceCulling=false;
    material.needDepthPrePass=false;
    if(BABYLON.Material?.MATERIAL_ALPHABLEND!=null)material.transparencyMode=BABYLON.Material.MATERIAL_ALPHABLEND;
    return material;
  }

  root(name){return new BABYLON.TransformNode(name,this.scene);}
  addMesh(root,mesh,material){mesh.parent=root;mesh.material=material;mesh.isPickable=false;return mesh;}

  create(type,key,tile){
    const root=this.root(`environment-${key}`);
    if(type==="BURNING"){
      const flame=this.addMesh(root,BABYLON.MeshBuilder.CreateCylinder(`burn-${key}`,{height:.88,diameterTop:.08,diameterBottom:.70,tessellation:8},this.scene),this.materials.fire);flame.position.y=.44;this.animated.set(key,{node:root,speed:2.8});
    }else if(type==="TORNADO"||type==="FIRE_TORNADO"){
      const material=type==="FIRE_TORNADO"?this.materials.fireWind:this.materials.wind;
      for(let i=0;i<3;i++){const ring=this.addMesh(root,BABYLON.MeshBuilder.CreateTorus(`wind-${key}-${i}`,{diameter:.52+i*.28,thickness:.055,tessellation:16},this.scene),material);ring.position.y=.28+i*.38;}
      const cone=this.addMesh(root,BABYLON.MeshBuilder.CreateCylinder(`wind-core-${key}`,{height:1.35,diameterTop:1.05,diameterBottom:.22,tessellation:12},this.scene),material);cone.position.y=.68;this.animated.set(key,{node:root,speed:type==="FIRE_TORNADO"?4.2:3.4});
    }else if(type==="STEAM"){
      const cloud=this.addMesh(root,BABYLON.MeshBuilder.CreateSphere(`steam-${key}`,{diameter:.95,segments:8},this.scene),this.materials.steam);cloud.position.y=.62;cloud.scaling.set(1,.72,1);this.animated.set(key,{node:root,speed:.45});
    }else if(type==="SMOKE"){
      for(let i=0;i<4;i++){const puff=this.addMesh(root,BABYLON.MeshBuilder.CreateSphere(`smoke-${key}-${i}`,{diameter:.72+i*.08,segments:7},this.scene),this.materials.smoke),side=(i%2?1:-1)*(.10+i*.035);puff.position.set(side,.48+i*.30,(i%3-1)*.08);puff.scaling.set(1.05,.76,1.05);}this.animated.set(key,{node:root,speed:.18});
    }else if(type==="ELECTRIFIED"){
      const ring=this.addMesh(root,BABYLON.MeshBuilder.CreateTorus(`electric-${key}`,{diameter:1.05,thickness:.065,tessellation:20},this.scene),this.materials.electric);ring.position.y=.11;this.animated.set(key,{node:root,speed:5.2});
    }else if(type==="BOILING"){
      const ring=this.addMesh(root,BABYLON.MeshBuilder.CreateTorus(`boiling-${key}`,{diameter:.8,thickness:.05,tessellation:18},this.scene),this.materials.boiling);ring.position.y=.08;this.animated.set(key,{node:root,speed:1.7});
    }else if(type==="FRAGMENTS"){
      for(let i=0;i<4;i++){const chip=this.addMesh(root,BABYLON.MeshBuilder.CreatePolyhedron(`fragment-${key}-${i}`,{type:2,size:.12},this.scene),this.materials.fragments),a=i*Math.PI/2+.35;chip.position.set(Math.cos(a)*.34,.10+(i%2)*.12,Math.sin(a)*.34);}
    }else{root.dispose();return null;}
    root.metadata={...(root.metadata||{}),effectType:type,tileX:tile.x,tileY:tile.y};return root;
  }

  desiredNodeTypes(tile){
    return new Set([...(tile.effects||[])].filter(type=>!SURFACE_TYPES.has(String(type))));
  }

  surfaceLayerAmount(type,tile){
    if(type==="SNOW")return snowDepth(tile);
    if(type==="ICE")return waterDepth(tile)>0?iceThickness(tile):0;
    if(type==="CURRENT"){
      const vector=Math.hypot(Number(tile?.flowX||0),Number(tile?.flowY||0));
      return waterDepth(tile)>0&&!isSolidIce(tile)&&vector>SURFACE_EPSILON?flowSpeed(tile):0;
    }
    return 0;
  }

  layerConnect(type,a,b){
    if(!a||!b)return false;
    if(type==="SNOW")return this.surfaceResolver.canSlope(a,b);
    if(type==="ICE"||type==="CURRENT"){
      if(waterDepth(a)<=0||waterDepth(b)<=0)return false;
      const sa=this.surfaceResolver.waterSurfaceOf(a),sb=this.surfaceResolver.waterSurfaceOf(b);
      if(sa==null||sb==null||Math.abs(sa-sb)>.18)return false;
      if(type==="CURRENT"&&(this.surfaceLayerAmount("CURRENT",a)<=SURFACE_EPSILON||this.surfaceLayerAmount("CURRENT",b)<=SURFACE_EPSILON))return false;
      return true;
    }
    return false;
  }

  layerAmountAt(type,tile,byKey,ox,oz){
    return this.surfaceResolver.sharedScalarAt(
      tile,byKey,ox,oz,
      value=>this.surfaceLayerAmount(type,value),
      {connect:(a,b)=>this.layerConnect(type,a,b)}
    );
  }

  waterClearance(tile,sample){
    const surface=this.surfaceResolver.waterSurfaceOf(tile);
    if(surface==null)return 0;
    return surface-Number(sample.height||0);
  }

  vertexLayerAlpha(type,tile,sample,amount){
    if(tile?.fogged)return 0;
    if(type==="SNOW")return clamp(amount/.55,0,1);
    if(type==="ICE"){
      if(this.waterClearance(tile,sample)<=SURFACE_EPSILON)return 0;
      return clamp(amount/.45,0,1);
    }
    if(type==="CURRENT"){
      if(this.waterClearance(tile,sample)<=SURFACE_EPSILON)return 0;
      // Keep a stable directional trace at low flow and strengthen it gradually.
      // Alpha no longer pulses; only the texture coordinates move each frame.
      return clamp(.70+amount*.08,.70,.92);
    }
    return 0;
  }

  layerVertexY(type,tile,sample,amount){
    if(type==="SNOW"){
      const base=isSolidIce(tile)
        ?Number(this.surfaceResolver.waterSurfaceOf(tile))*ELEVATION_HEIGHT
        :Number(sample.height||0)*ELEVATION_HEIGHT;
      return base+Math.max(.006,amount*ELEVATION_HEIGHT);
    }
    const waterSurface=this.surfaceResolver.waterSurfaceOf(tile);
    if(type==="ICE")return Number(waterSurface??sample.height)*ELEVATION_HEIGHT+.034;
    return Number(waterSurface??sample.height)*ELEVATION_HEIGHT+.09;
  }

  currentUV(tile,sample){
    let fx=Number(tile?.flowX||0),fz=Number(tile?.flowY||0);
    const length=Math.hypot(fx,fz)||1;fx/=length;fz/=length;
    const px=-fz,pz=fx;
    const lx=Number(sample.ox||0)*TILE_SIZE,lz=Number(sample.oz||0)*TILE_SIZE;
    // UV V always follows hydrology flow direction. A stable tile phase prevents
    // repeated streaks from lining up into a flashing cross-map band.
    const phase=((Number(tile.x)*37+Number(tile.y)*19)%97)/97;
    return{
      u:(lx*px+lz*pz)/(TILE_SIZE*.78)+.5,
      v:(lx*fx+lz*fz)/(TILE_SIZE*.76)+phase
    };
  }

  buildSurfaceLayer(type,tiles,byKey,{currentBand=null}={}){
    const positions=[],indices=[],normals=[],colors=[],uvs=[];
    let activeTiles=0;
    let speedSum=0;

    for(const tile of tiles){
      const localAmount=this.surfaceLayerAmount(type,tile);
      if(localAmount<=SURFACE_EPSILON)continue;
      if(type==="CURRENT"&&currentBand&&this.currentBand(tile).id!==currentBand.id)continue;
      activeTiles++;
      if(type==="CURRENT")speedSum+=flowSpeed(tile);
      const patch=this.surfaceResolver.resolveTile(tile,byKey).patchGrid;
      const baseIndex=positions.length/3;
      const alpha=[];

      for(let row=0;row<4;row++)for(let col=0;col<4;col++){
        const sample=patch[row][col];
        const amount=this.layerAmountAt(type,tile,byKey,sample.ox,sample.oz);
        const a=this.vertexLayerAlpha(type,tile,sample,amount);
        alpha.push(a);
        positions.push(sample.x,this.layerVertexY(type,tile,sample,amount),sample.z);
        colors.push(1,1,1,a);
        if(type==="CURRENT"){
          const uv=this.currentUV(tile,sample);uvs.push(uv.u,uv.v);
        }else uvs.push(sample.x/TILE_SIZE,sample.z/TILE_SIZE);
      }

      for(let row=0;row<3;row++)for(let col=0;col<3;col++){
        const nw=baseIndex+row*4+col,ne=nw+1,sw=baseIndex+(row+1)*4+col,se=sw+1;
        const local=[row*4+col,row*4+col+1,(row+1)*4+col,(row+1)*4+col+1];
        if(Math.max(...local.map(i=>alpha[i]))<=SURFACE_EPSILON)continue;
        const alternate=(Number(tile.x)+Number(tile.y)+row+col)&1;
        if(alternate===0)indices.push(nw,ne,se,nw,se,sw);
        else indices.push(nw,ne,sw,ne,se,sw);
      }
    }

    if(!indices.length)return null;
    BABYLON.VertexData.ComputeNormals(positions,indices,normals);
    const suffix=type==="CURRENT"&&currentBand?`-${currentBand.id.toLowerCase()}`:"";
    const mesh=new BABYLON.Mesh(`environment-surface-${type.toLowerCase()}${suffix}`,this.scene);
    const data=new BABYLON.VertexData();
    data.positions=positions;data.indices=indices;data.normals=normals;data.colors=colors;data.uvs=uvs;
    data.applyToMesh(mesh,false);
    mesh.material=type==="CURRENT"&&currentBand
      ?this.currentResources.get(currentBand.id).material
      :this.materials[type.toLowerCase()];
    mesh.useVertexColors=true;
    mesh.hasVertexAlpha=true;
    mesh.isPickable=false;
    mesh.receiveShadows=true;
    if(type==="CURRENT")mesh.alphaIndex=20;
    mesh.metadata={
      kind:"environment-surface-layer",
      effectType:type,
      activeTiles,
      visualSurfaceResolver:true,
      microRegionsPerTile:9,
      mergedMesh:true,
      perTilePlate:false,
      currentBand:currentBand?.id||null,
      averageFlowSpeed:type==="CURRENT"&&activeTiles?speedSum/activeTiles:0,
      meshRebuildPerFrame:false
    };
    return mesh;
  }

  surfaceLayerSignature(tiles){
    return tiles.map(tile=>[
      tile.x,tile.y,
      Number(tile.elevation||0).toFixed(3),
      waterDepth(tile).toFixed(3),
      tile.waterSurfaceZ==null?"n":Number(tile.waterSurfaceZ).toFixed(3),
      snowDepth(tile).toFixed(3),
      iceThickness(tile).toFixed(3),
      flowSpeed(tile).toFixed(3),
      Number(tile.flowX||0),Number(tile.flowY||0),
      tile.fogged?1:0
    ].join(":")).join("|");
  }

  disposeSurfaceLayers(){
    for(const mesh of this.surfaceMeshes.values())mesh.dispose();
    this.surfaceMeshes.clear();
  }

  syncSurfaceLayers(state){
    const tiles=state?.map?.tiles||[];
    const signature=this.surfaceLayerSignature(tiles);
    if(signature===this.surfaceSignature)return;
    this.disposeSurfaceLayers();
    const byKey=new Map(tiles.map(tile=>[this.surfaceResolver.keyOf(tile.x,tile.y),tile]));

    for(const type of ["SNOW","ICE"]){
      const mesh=this.buildSurfaceLayer(type,tiles,byKey);
      if(mesh)this.surfaceMeshes.set(type,mesh);
    }
    for(const band of CURRENT_BANDS){
      const mesh=this.buildSurfaceLayer("CURRENT",tiles,byKey,{currentBand:band});
      if(mesh)this.surfaceMeshes.set(`CURRENT_${band.id}`,mesh);
    }
    this.surfaceSignature=signature;
  }

  syncAtmosphere(state){
    const environment=state?.presentation?.environment||{},weather=String(environment.weather||"CLEAR"),night=environment.timeOfDay==="NIGHT";
    this.scene.clearColor=night?new BABYLON.Color4(.018,.027,.055,1):new BABYLON.Color4(.035,.055,.08,1);
    if(weather==="FOG"){this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;this.scene.fogDensity=.022;this.scene.fogColor=new BABYLON.Color3(.48,.53,.57);}
    else if(weather==="BLIZZARD"){this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;this.scene.fogDensity=.017;this.scene.fogColor=new BABYLON.Color3(.64,.69,.74);}
    else if(weather==="HEAVY_RAIN"||weather==="THUNDERSTORM"){this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;this.scene.fogDensity=.006;this.scene.fogColor=new BABYLON.Color3(.20,.26,.31);}
    else{this.scene.fogMode=BABYLON.Scene.FOGMODE_NONE;this.scene.fogDensity=0;}
  }

  sync(state){
    this.syncAtmosphere(state);
    this.syncSurfaceLayers(state);
    const alive=new Set();
    for(const tile of state?.map?.tiles||[]){
      const surface=surfaceOf(tile)*ELEVATION_HEIGHT;
      for(const type of this.desiredNodeTypes(tile)){
        const key=keyOf(tile,type);alive.add(key);let node=this.nodes.get(key);
        if(!node){node=this.create(type,key,tile);if(!node)continue;this.nodes.set(key,node);}
        node.position.set(tile.x*TILE_SIZE,surface,tile.y*TILE_SIZE);
        const visible=tile.fogged?0:1;
        node.getChildMeshes().forEach(mesh=>mesh.visibility=visible);
      }
    }
    for(const[key,node]of this.nodes){
      if(alive.has(key))continue;
      this.animated.delete(key);node.dispose();this.nodes.delete(key);
    }
  }

  diagnostics(){
    const byType={};
    for(const node of this.nodes.values()){const type=node.metadata?.effectType||"UNKNOWN";byType[type]=(byType[type]||0)+1;}
    const surfaceLayers={};
    for(const[type,mesh]of this.surfaceMeshes)surfaceLayers[type]={
      activeTiles:Number(mesh.metadata?.activeTiles||0),
      mergedMesh:mesh.metadata?.mergedMesh===true,
      currentBand:mesh.metadata?.currentBand||null,
      averageFlowSpeed:Number(mesh.metadata?.averageFlowSpeed||0)
    };
    return{
      total:this.nodes.size,
      byType,
      currentWaveTexture:true,
      currentDirectionalUV:true,
      currentEmissive:false,
      currentSingleAlphaPath:true,
      currentMipmaps:true,
      currentAlphaIndex:20,
      currentSourceOfTruth:"flow-vector-and-speed",
      currentSpeedBands:CURRENT_BANDS.map(band=>band.id),
      currentAnimation:"texture-offset-only",
      currentMeshRebuildPerFrame:false,
      surfaceLayers,
      visualSurfaceResolver:true,
      microRegionSurfaceLayers:true,
      perTileSnowBoxes:false,
      perTileIceGrounds:false,
      perTileCurrentGrounds:false,
      mudIntegratedIntoTerrain:true
    };
  }
}
