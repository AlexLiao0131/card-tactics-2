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
const isSolidIce=tile=>waterDepth(tile)>0&&iceThickness(tile)>=.45;
const SURFACE_TYPES=new Set(["SNOW","ICE","CURRENT"]);
const SURFACE_EPSILON=.001;
const RAIN_PARTICLE_CAPACITY=760;
const MIST_PARTICLE_CAPACITY=120;
const IMPACT_POOL_SIZE=18;

function hash01(value){
  const text=String(value||"");let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return(h>>>0)/4294967295;
}


export class EnvironmentRenderer{
  constructor(scene,surfaceResolver=null){
    this.scene=scene;
    this.surfaceResolver=surfaceResolver||new VisualSurfaceResolver();
    this.nodes=new Map();
    this.animated=new Map();
    this.surfaceMeshes=new Map();
    this.surfaceSignature="";
    this.lastState=null;
    this.weatherTime=0;
    this.impactAccumulator=0;
    this.lightningBursts=[];
    this.lastLightningToken="";


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
      boiling:this.mat("env-boiling",new BABYLON.Color3(.72,.90,1),.48,new BABYLON.Color3(.16,.36,.5)),
      rainRipple:this.mat("weather-rain-ripple",new BABYLON.Color3(.66,.90,1),.72,new BABYLON.Color3(.18,.42,.58)),
      groundSplash:this.mat("weather-ground-splash",new BABYLON.Color3(.80,.90,.96),.58,new BABYLON.Color3(.12,.20,.24))
    };
    this.rainTexture=this.makeRainTexture();
    this.mistTexture=this.makeMistTexture();
    this.rainSystem=this.makeRainSystem();
    this.mistSystem=this.makeMistSystem();
    this.rainImpacts=this.makeRainImpactPool();
    this.lightningFlash=new BABYLON.HemisphericLight("weather-lightning-flash",new BABYLON.Vector3(0,1,0),this.scene);
    this.lightningFlash.diffuse=new BABYLON.Color3(.72,.88,1);
    this.lightningFlash.groundColor=new BABYLON.Color3(.30,.38,.52);
    this.lightningFlash.intensity=0;

    this.beforeRender=this.scene.onBeforeRenderObservable.add(()=>{
      const dt=Math.min(.05,Math.max(0,Number(this.scene.getEngine().getDeltaTime()||16)/1000));
      this.weatherTime+=dt;
      for(const entry of this.animated.values()){
        const {node,speed=0,spin=true}=entry;if(spin)node.rotation.y+=speed*dt;
        if(entry.electricArc){
          const pulse=.72+Math.sin(this.weatherTime*13+entry.phase)*.22;
          node.scaling.setAll(.88+pulse*.16);
          for(const mesh of node.getChildMeshes())mesh.visibility=clamp(.38+pulse*.58,0,1);
        }
      }
      this.updateWeatherFrame(dt);
    });
  }

  makeRainTexture(){
    const texture=new BABYLON.DynamicTexture("weather-rain-streak",{width:24,height:96},this.scene,false);
    texture.hasAlpha=true;const ctx=texture.getContext();ctx.clearRect(0,0,24,96);
    const gradient=ctx.createLinearGradient(12,0,12,96);gradient.addColorStop(0,"rgba(220,242,255,0)");gradient.addColorStop(.18,"rgba(220,242,255,.35)");gradient.addColorStop(.72,"rgba(235,248,255,.92)");gradient.addColorStop(1,"rgba(235,248,255,0)");
    ctx.strokeStyle=gradient;ctx.lineWidth=3;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(12,4);ctx.lineTo(12,91);ctx.stroke();texture.update();return texture;
  }

  makeMistTexture(){
    const texture=new BABYLON.DynamicTexture("weather-mist-soft",{width:64,height:64},this.scene,false);texture.hasAlpha=true;
    const ctx=texture.getContext(),g=ctx.createRadialGradient(32,32,2,32,32,31);g.addColorStop(0,"rgba(205,222,232,.32)");g.addColorStop(.55,"rgba(190,210,222,.14)");g.addColorStop(1,"rgba(180,200,214,0)");ctx.fillStyle=g;ctx.fillRect(0,0,64,64);texture.update();return texture;
  }

  makeRainSystem(){
    const system=new BABYLON.ParticleSystem("weather-rain",RAIN_PARTICLE_CAPACITY,this.scene);system.particleTexture=this.rainTexture;
    system.emitter=new BABYLON.Vector3(0,7,0);system.minEmitBox=new BABYLON.Vector3(-4,0,-4);system.maxEmitBox=new BABYLON.Vector3(4,.4,4);
    system.color1=new BABYLON.Color4(.72,.88,1,.72);system.color2=new BABYLON.Color4(.88,.96,1,.86);system.colorDead=new BABYLON.Color4(.7,.85,1,0);
    system.minSize=.09;system.maxSize=.16;system.minLifeTime=.34;system.maxLifeTime=.62;system.emitRate=0;system.minEmitPower=10;system.maxEmitPower=14;system.updateSpeed=.012;system.blendMode=BABYLON.ParticleSystem.BLENDMODE_STANDARD;system.start();return system;
  }

  makeMistSystem(){
    const system=new BABYLON.ParticleSystem("weather-heavy-mist",MIST_PARTICLE_CAPACITY,this.scene);system.particleTexture=this.mistTexture;
    system.emitter=new BABYLON.Vector3(0,1.2,0);system.minEmitBox=new BABYLON.Vector3(-4,0,-4);system.maxEmitBox=new BABYLON.Vector3(4,.5,4);
    system.color1=new BABYLON.Color4(.72,.80,.84,.18);system.color2=new BABYLON.Color4(.62,.72,.78,.10);system.colorDead=new BABYLON.Color4(.6,.7,.76,0);
    system.minSize=.75;system.maxSize=1.55;system.minLifeTime=1.1;system.maxLifeTime=2.3;system.emitRate=0;system.minEmitPower=.12;system.maxEmitPower=.45;system.updateSpeed=.018;system.blendMode=BABYLON.ParticleSystem.BLENDMODE_STANDARD;system.start();return system;
  }

  makeRainImpactPool(){
    const pool=[];
    for(let i=0;i<IMPACT_POOL_SIZE;i++){
      const ring=BABYLON.MeshBuilder.CreateTorus(`rain-impact-ring-${i}`,{diameter:.16,thickness:.012,tessellation:12},this.scene);ring.material=this.materials.rainRipple;ring.isPickable=false;ring.visibility=0;
      const splash=BABYLON.MeshBuilder.CreateCylinder(`rain-impact-splash-${i}`,{height:.055,diameterTop:.025,diameterBottom:.08,tessellation:6},this.scene);splash.material=this.materials.groundSplash;splash.isPickable=false;splash.visibility=0;
      pool.push({ring,splash,age:0,duration:0,active:false,water:false});
    }
    return pool;
  }

  weatherSettings(state){
    const environment=state?.presentation?.environment||{},weather=String(environment.weather||"CLEAR").toUpperCase(),wind=environment.wind||{};
    const raining=weather==="RAIN"||weather==="HEAVY_RAIN"||weather==="THUNDERSTORM";
    return{weather,wind,raining,heavy:weather==="HEAVY_RAIN"||weather==="THUNDERSTORM",thunder:weather==="THUNDERSTORM"};
  }

  syncWeatherParticles(state){
    const settings=this.weatherSettings(state),tiles=state?.map?.tiles||[],width=Math.max(1,Number(state?.map?.width||1)),height=Math.max(1,Number(state?.map?.height||1));
    const centerX=(width-1)*TILE_SIZE*.5,centerZ=(height-1)*TILE_SIZE*.5,maxSurface=tiles.length?Math.max(...tiles.map(tile=>surfaceOf(tile)*ELEVATION_HEIGHT)):0;
    const windX=Number(settings.wind?.x||0),windZ=Number(settings.wind?.y||0),strength=Math.max(0,Number(settings.wind?.strength||0));
    this.rainSystem.emitter.set(centerX,maxSurface+7.2,centerZ);this.rainSystem.minEmitBox.set(-width*TILE_SIZE*.56,0,-height*TILE_SIZE*.56);this.rainSystem.maxEmitBox.set(width*TILE_SIZE*.56,.5,height*TILE_SIZE*.56);
    const horizontal=.11+strength*.13;this.rainSystem.direction1.set(windX*horizontal,-1,windZ*horizontal);this.rainSystem.direction2.set(windX*horizontal*.82,-1,windZ*horizontal*.82);this.rainSystem.minEmitPower=10+strength*1.4;this.rainSystem.maxEmitPower=13+strength*1.8;
    this.rainSystem.emitRate=settings.weather==="RAIN"?170:settings.weather==="HEAVY_RAIN"?390:settings.weather==="THUNDERSTORM"?470:0;
    this.mistSystem.emitter.set(centerX,maxSurface+.6,centerZ);this.mistSystem.minEmitBox.set(-width*TILE_SIZE*.5,0,-height*TILE_SIZE*.5);this.mistSystem.maxEmitBox.set(width*TILE_SIZE*.5,.8,height*TILE_SIZE*.5);this.mistSystem.direction1.set(windX*.18,.03,windZ*.18);this.mistSystem.direction2.set(windX*.28,.08,windZ*.28);this.mistSystem.emitRate=settings.heavy?14:0;
    this.weatherPresentation={rainActive:settings.raining,rainEmitRate:this.rainSystem.emitRate,mistActive:settings.heavy,mistEmitRate:this.mistSystem.emitRate,wind:{x:windX,y:windZ,strength}};
  }

  spawnRainImpact(){
    const state=this.lastState,settings=this.weatherSettings(state);if(!settings.raining)return;
    const tiles=(state?.map?.tiles||[]).filter(tile=>!tile.fogged);if(!tiles.length)return;
    const slot=this.rainImpacts.find(item=>!item.active)||this.rainImpacts.reduce((oldest,item)=>item.age>oldest.age?item:oldest,this.rainImpacts[0]);if(!slot)return;
    const tile=tiles[Math.floor(Math.random()*tiles.length)],water=waterDepth(tile)>.025&&!isSolidIce(tile),surface=surfaceOf(tile)*ELEVATION_HEIGHT;
    slot.active=true;slot.age=0;slot.duration=water?.48:.24;slot.water=water;slot.ring.visibility=water?1:0;slot.splash.visibility=water?0:1;
    slot.ring.position.set(tile.x*TILE_SIZE+(Math.random()-.5)*TILE_SIZE*.64,surface+.035,tile.y*TILE_SIZE+(Math.random()-.5)*TILE_SIZE*.64);slot.ring.scaling.setAll(.65);
    slot.splash.position.copyFrom(slot.ring.position);slot.splash.position.y=surface+.04;slot.splash.scaling.setAll(.75);
  }

  updateRainImpacts(dt){
    const settings=this.weatherSettings(this.lastState),rate=settings.weather==="RAIN"?5:settings.heavy?11:0;this.impactAccumulator+=dt*rate;
    while(this.impactAccumulator>=1){this.impactAccumulator-=1;this.spawnRainImpact();}
    for(const slot of this.rainImpacts){if(!slot.active)continue;slot.age+=dt;const p=clamp(slot.age/Math.max(.01,slot.duration),0,1),visibility=1-p;if(slot.water){slot.ring.visibility=visibility*.78;slot.ring.scaling.setAll(.65+p*1.9);}else{slot.splash.visibility=visibility*.70;slot.splash.scaling.set(.75+p*.35,.75+p*.85,.75+p*.35);}if(p>=1){slot.active=false;slot.ring.visibility=0;slot.splash.visibility=0;}}
  }

  lightningTargetY(state,x,y){const tile=(state?.map?.tiles||[]).find(value=>value.x===x&&value.y===y);return surfaceOf(tile||{})*ELEVATION_HEIGHT+.08;}

  createLightningBurst(event,state){
    const x=Number(event?.x),y=Number(event?.y);if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const wx=x*TILE_SIZE,wz=y*TILE_SIZE,targetY=this.lightningTargetY(state,x,y),points=[],segments=10;
    for(let i=0;i<=segments;i++){const t=i/segments,envelope=Math.sin(Math.PI*t),seed=hash01(`${state?.revision||0}:${x}:${y}:${i}`),seed2=hash01(`z:${state?.revision||0}:${x}:${y}:${i}`);points.push(new BABYLON.Vector3(wx+(seed-.5)*.42*envelope,targetY+6.3*(1-t),wz+(seed2-.5)*.42*envelope));}
    const bolt=BABYLON.MeshBuilder.CreateLines(`weather-lightning-${state?.revision||0}-${x}-${y}`,{points},this.scene);bolt.color=new BABYLON.Color3(.78,.91,1);bolt.alpha=.98;bolt.isPickable=false;
    const branchPoints=[points[6],new BABYLON.Vector3(points[6].x+.34,targetY+1.65,points[6].z-.22),new BABYLON.Vector3(points[6].x+.55,targetY+1.18,points[6].z-.33)];const branch=BABYLON.MeshBuilder.CreateLines(`weather-lightning-branch-${state?.revision||0}-${x}-${y}`,{points:branchPoints},this.scene);branch.color=new BABYLON.Color3(.58,.82,1);branch.alpha=.72;branch.isPickable=false;
    this.lightningBursts.push({meshes:[bolt,branch],age:0,duration:.20});this.lightningFlash.intensity=Math.max(this.lightningFlash.intensity,2.35);
  }

  syncPresentationEvents(events,state){
    for(const event of events||[]){if(event?.type!=="LIGHTNING_STRIKE")continue;const token=`${state?.revision||0}:${event.x}:${event.y}:${event.unitId||event.unit?.id||""}`;if(token===this.lastLightningToken)continue;this.lastLightningToken=token;this.createLightningBurst(event,state);}
  }

  updateLightning(dt){
    this.lightningFlash.intensity=Math.max(0,this.lightningFlash.intensity-dt*10.5);const keep=[];
    for(const burst of this.lightningBursts){burst.age+=dt;const p=clamp(burst.age/burst.duration,0,1);for(const mesh of burst.meshes)mesh.alpha=(1-p)*.95;if(p>=1){for(const mesh of burst.meshes)mesh.dispose();}else keep.push(burst);}this.lightningBursts=keep;
  }

  updateWeatherFrame(dt){this.updateRainImpacts(dt);this.updateLightning(dt);}

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
      const phase=hash01(`electric:${key}`)*Math.PI*2;
      for(let i=0;i<3;i++){
        const a=phase+i*2.08,r=.12+i*.055,points=[new BABYLON.Vector3(Math.cos(a)*r,.10,Math.sin(a)*r),new BABYLON.Vector3(Math.cos(a+.52)*(r+.13),.14+(i%2)*.035,Math.sin(a+.52)*(r+.13)),new BABYLON.Vector3(Math.cos(a+.94)*(r+.25),.095,Math.sin(a+.94)*(r+.25))];
        const arc=BABYLON.MeshBuilder.CreateLines(`electric-arc-${key}-${i}`,{points},this.scene);arc.parent=root;arc.color=i===0?new BABYLON.Color3(.72,.91,1):new BABYLON.Color3(.38,.72,1);arc.alpha=.48+i*.12;arc.isPickable=false;
      }
      this.animated.set(key,{node:root,speed:0,spin:false,electricArc:true,phase});
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
    return 0;
  }

  layerConnect(type,a,b){
    if(!a||!b)return false;
    if(type==="SNOW")return this.surfaceResolver.canSlope(a,b);
    if(type==="ICE"){
      if(waterDepth(a)<=0||waterDepth(b)<=0)return false;
      const sa=this.surfaceResolver.waterSurfaceOf(a),sb=this.surfaceResolver.waterSurfaceOf(b);
      return sa!=null&&sb!=null&&Math.abs(sa-sb)<=.18;
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
    return Number(sample.height||0)*ELEVATION_HEIGHT+.006;
  }

  buildSurfaceLayer(type,tiles,byKey){
    const positions=[],indices=[],normals=[],colors=[],uvs=[];
    let activeTiles=0;

    for(const tile of tiles){
      const localAmount=this.surfaceLayerAmount(type,tile);
      if(localAmount<=SURFACE_EPSILON)continue;
      activeTiles++;
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
        uvs.push(sample.x/TILE_SIZE,sample.z/TILE_SIZE);
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
    const mesh=new BABYLON.Mesh(`environment-surface-${type.toLowerCase()}`,this.scene);
    const data=new BABYLON.VertexData();
    data.positions=positions;data.indices=indices;data.normals=normals;data.colors=colors;data.uvs=uvs;
    data.applyToMesh(mesh,false);
    mesh.material=this.materials[type.toLowerCase()];
    mesh.useVertexColors=true;
    mesh.hasVertexAlpha=true;
    mesh.isPickable=false;
    mesh.receiveShadows=true;
    mesh.metadata={
      kind:"environment-surface-layer",
      effectType:type,
      activeTiles,
      visualSurfaceResolver:true,
      microRegionsPerTile:9,
      mergedMesh:true,
      perTilePlate:false,
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
    this.surfaceSignature=signature;
  }

  syncAtmosphere(state){
    const environment=state?.presentation?.environment||{},weather=String(environment.weather||"CLEAR"),night=environment.timeOfDay==="NIGHT";
    this.scene.clearColor=night?new BABYLON.Color4(.018,.027,.055,1):new BABYLON.Color4(.035,.055,.08,1);
    if(weather==="FOG"){this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;this.scene.fogDensity=.022;this.scene.fogColor=new BABYLON.Color3(.48,.53,.57);}
    else if(weather==="BLIZZARD"){this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;this.scene.fogDensity=.017;this.scene.fogColor=new BABYLON.Color3(.64,.69,.74);}
    else if(weather==="RAIN"){this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;this.scene.fogDensity=.0025;this.scene.fogColor=new BABYLON.Color3(.28,.34,.38);}
    else if(weather==="HEAVY_RAIN"){this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;this.scene.fogDensity=.009;this.scene.fogColor=new BABYLON.Color3(.20,.26,.31);}
    else if(weather==="THUNDERSTORM"){this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;this.scene.fogDensity=.011;this.scene.fogColor=new BABYLON.Color3(.17,.22,.28);}
    else{this.scene.fogMode=BABYLON.Scene.FOGMODE_NONE;this.scene.fogDensity=0;}
  }

  sync(state,presentationEvents=[]){
    this.lastState=state;
    this.syncAtmosphere(state);
    this.syncSurfaceLayers(state);
    this.syncWeatherParticles(state);
    this.syncPresentationEvents(presentationEvents,state);
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
      mergedMesh:mesh.metadata?.mergedMesh===true
    };
    return{
      total:this.nodes.size,
      byType,
      currentOverlay:false,
      currentVisualOwner:"WaterRenderer",
      waterFlowPresentation:"animated-water-surface",
      surfaceLayers,
      visualSurfaceResolver:true,
      microRegionSurfaceLayers:true,
      perTileSnowBoxes:false,
      perTileIceGrounds:false,
      perTileCurrentGrounds:false,
      mudIntegratedIntoTerrain:true,
      weatherParticles:this.weatherPresentation||{rainActive:false,rainEmitRate:0,mistActive:false,mistEmitRate:0},
      rainImpactPool:{size:this.rainImpacts.length,active:this.rainImpacts.filter(item=>item.active).length},
      lightningBursts:this.lightningBursts.length,
      electrifiedPresentation:"sparse-surface-arcs",
      perTileElectricRings:false
    };
  }
}
