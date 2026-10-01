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
const NO_MIST=Object.freeze({
  emitRate:0,minSize:.75,maxSize:1.35,minLifeTime:1,maxLifeTime:2,
  height:.55,boxHeight:.8,drift:.16,rise:.03,
  color1:Object.freeze([.68,.76,.81,0]),color2:Object.freeze([.60,.69,.75,0])
});
const WEATHER_MIST_PROFILE=Object.freeze({
  FOG:Object.freeze({
    emitRate:44,minSize:1.05,maxSize:2.15,minLifeTime:1.7,maxLifeTime:3.2,
    height:.50,boxHeight:.92,drift:.13,rise:.024,
    color1:Object.freeze([.72,.79,.83,.15]),color2:Object.freeze([.66,.73,.78,.075])
  }),
  BLIZZARD:Object.freeze({
    emitRate:32,minSize:.62,maxSize:1.28,minLifeTime:.72,maxLifeTime:1.45,
    height:1.08,boxHeight:1.65,drift:.48,rise:.012,
    color1:Object.freeze([.84,.90,.95,.13]),color2:Object.freeze([.76,.84,.90,.060])
  }),
  HEAVY_RAIN:Object.freeze({
    emitRate:10,minSize:.68,maxSize:1.28,minLifeTime:.90,maxLifeTime:1.70,
    height:.62,boxHeight:.92,drift:.21,rise:.018,
    color1:Object.freeze([.50,.59,.65,.085]),color2:Object.freeze([.42,.51,.58,.040])
  }),
  THUNDERSTORM:Object.freeze({
    emitRate:13,minSize:.66,maxSize:1.25,minLifeTime:.82,maxLifeTime:1.55,
    height:.64,boxHeight:.96,drift:.26,rise:.016,
    color1:Object.freeze([.42,.51,.58,.095]),color2:Object.freeze([.34,.43,.50,.045])
  })
});
const SCENE_FOG_PROFILE=Object.freeze({
  FOG:Object.freeze({density:.009,color:Object.freeze([.48,.53,.57])}),
  BLIZZARD:Object.freeze({density:.008,color:Object.freeze([.64,.69,.74])}),
  RAIN:Object.freeze({density:.0018,color:Object.freeze([.28,.34,.38])}),
  HEAVY_RAIN:Object.freeze({density:.0042,color:Object.freeze([.20,.26,.31])}),
  THUNDERSTORM:Object.freeze({density:.0052,color:Object.freeze([.17,.22,.28])})
});
const VISIBILITY_HAZE_PROFILE=Object.freeze({
  FOG:Object.freeze({color:Object.freeze([.48,.53,.57]),alpha:.40,edgeFactor:.24,height:.42}),
  BLIZZARD:Object.freeze({color:Object.freeze([.68,.73,.78]),alpha:.34,edgeFactor:.28,height:.48})
});

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
    this.visibilityHazeMesh=null;
    this.visibilityHazeSignature="";
    this.lastState=null;
    this.weatherTime=0;
    this.impactAccumulator=0;
    this.lightningBursts=[];
    this.lastLightningToken="";
    this.fireLights=[];
    this.fireGlows=new Map();
    this.fireCameraKey="";
    this.friendlyMaterialSignature="";
    this.meteorBursts=[];
    this.seenPresentationSequences=new Set();


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
      groundSplash:this.mat("weather-ground-splash",new BABYLON.Color3(.80,.90,.96),.58,new BABYLON.Color3(.12,.20,.24)),
      meteorRock:this.mat("meteor-rock",new BABYLON.Color3(.20,.16,.14),1,new BABYLON.Color3(.20,.035,.005)),
      meteorHot:this.mat("meteor-hot",new BABYLON.Color3(1,.28,.035),.82,new BABYLON.Color3(1,.18,.015)),
      meteorBlast:this.mat("meteor-blast",new BABYLON.Color3(1,.48,.08),.74,new BABYLON.Color3(1,.36,.04)),
      shockwave:this.mat("meteor-shockwave",new BABYLON.Color3(1,.72,.34),.62,new BABYLON.Color3(.72,.32,.05)),
      meteorDust:this.mat("meteor-dust",new BABYLON.Color3(.31,.25,.20),.72)
    };
    this.visibilityHazeMaterial=this.makeVisibilityHazeMaterial();
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
      this.syncFriendlyVisibility(this.lastState);
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
    return{
      weather,wind,raining,
      heavy:weather==="HEAVY_RAIN"||weather==="THUNDERSTORM",
      thunder:weather==="THUNDERSTORM",
      mist:WEATHER_MIST_PROFILE[weather]||NO_MIST
    };
  }

  syncWeatherParticles(state){
    const settings=this.weatherSettings(state),tiles=state?.map?.tiles||[],width=Math.max(1,Number(state?.map?.width||1)),height=Math.max(1,Number(state?.map?.height||1));
    const centerX=(width-1)*TILE_SIZE*.5,centerZ=(height-1)*TILE_SIZE*.5,maxSurface=tiles.length?Math.max(...tiles.map(tile=>surfaceOf(tile)*ELEVATION_HEIGHT)):0;
    const windX=Number(settings.wind?.x||0),windZ=Number(settings.wind?.y||0),strength=Math.max(0,Number(settings.wind?.strength||0)),mist=settings.mist||NO_MIST;
    this.rainSystem.emitter.set(centerX,maxSurface+7.2,centerZ);this.rainSystem.minEmitBox.set(-width*TILE_SIZE*.56,0,-height*TILE_SIZE*.56);this.rainSystem.maxEmitBox.set(width*TILE_SIZE*.56,.5,height*TILE_SIZE*.56);
    const horizontal=.11+strength*.13;this.rainSystem.direction1.set(windX*horizontal,-1,windZ*horizontal);this.rainSystem.direction2.set(windX*horizontal*.82,-1,windZ*horizontal*.82);this.rainSystem.minEmitPower=10+strength*1.4;this.rainSystem.maxEmitPower=13+strength*1.8;
    this.rainSystem.emitRate=settings.weather==="RAIN"?170:settings.weather==="HEAVY_RAIN"?390:settings.weather==="THUNDERSTORM"?470:0;

    this.mistSystem.emitter.set(centerX,maxSurface+Number(mist.height||.55),centerZ);
    this.mistSystem.minEmitBox.set(-width*TILE_SIZE*.5,0,-height*TILE_SIZE*.5);
    this.mistSystem.maxEmitBox.set(width*TILE_SIZE*.5,Number(mist.boxHeight||.8),height*TILE_SIZE*.5);
    const drift=Number(mist.drift||0)*(1+strength*.22);
    this.mistSystem.direction1.set(windX*drift,Number(mist.rise||0),windZ*drift);
    this.mistSystem.direction2.set(windX*drift*1.35,Number(mist.rise||0)*1.8,windZ*drift*1.35);
    this.mistSystem.minEmitPower=.10+strength*.035;this.mistSystem.maxEmitPower=.28+strength*.09;
    this.mistSystem.minSize=Number(mist.minSize||.75);this.mistSystem.maxSize=Number(mist.maxSize||1.35);
    this.mistSystem.minLifeTime=Number(mist.minLifeTime||1);this.mistSystem.maxLifeTime=Number(mist.maxLifeTime||2);
    this.mistSystem.color1=new BABYLON.Color4(...mist.color1);this.mistSystem.color2=new BABYLON.Color4(...mist.color2);
    this.mistSystem.colorDead=new BABYLON.Color4(mist.color2[0],mist.color2[1],mist.color2[2],0);
    this.mistSystem.emitRate=Math.max(0,Number(mist.emitRate||0));

    this.weatherPresentation={
      rainActive:settings.raining,
      rainEmitRate:this.rainSystem.emitRate,
      mistActive:this.mistSystem.emitRate>0,
      mistType:this.mistSystem.emitRate>0?settings.weather:null,
      mistEmitRate:this.mistSystem.emitRate,
      globalSceneFog:false,
      wind:{x:windX,y:windZ,strength}
    };
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

  meteorTargetY(state,x,y){
    const tile=(state?.map?.tiles||[]).find(value=>Number(value.x)===Number(x)&&Number(value.y)===Number(y));
    return surfaceOf(tile||{})*ELEVATION_HEIGHT+.08;
  }

  createMeteorStrike(event,state){
    const x=Number(event?.x),y=Number(event?.y);if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const fallDuration=Math.max(.2,Number(event.fallDuration||650)/1000),impactDuration=Math.max(.25,Number(event.impactDuration||700)/1000);
    const innerRadius=Math.max(0,Number(event.innerRadius||0)),shockwaveRadius=Math.max(innerRadius,Number(event.shockwaveRadius||innerRadius));
    const target=new BABYLON.Vector3(x*TILE_SIZE,this.meteorTargetY(state,x,y),y*TILE_SIZE),angle=hash01(`meteor:${event.sequence||0}:${x}:${y}`)*Math.PI*2;
    const start=new BABYLON.Vector3(target.x+Math.cos(angle)*3.2,target.y+8.4,target.z+Math.sin(angle)*3.2),trailDirection=start.subtract(target).normalize();
    const root=this.root(`meteor-fall-${event.sequence||state?.revision||0}`);root.position.copyFrom(start);root.metadata={castShadow:false,presentationType:"METEOR_STRIKE"};
    const body=this.addMesh(root,BABYLON.MeshBuilder.CreatePolyhedron(`meteor-body-${event.sequence||0}`,{type:2,size:.46},this.scene),this.materials.meteorRock);body.metadata={castShadow:false};
    body.scaling.set(1.05,.92,1.12);
    const tails=[];
    for(let i=0;i<4;i++){
      const tail=this.addMesh(root,BABYLON.MeshBuilder.CreateSphere(`meteor-tail-${event.sequence||0}-${i}`,{diameter:.48-i*.07,segments:6},this.scene),this.materials.meteorHot);
      tail.position.copyFrom(trailDirection.scale(.38*(i+1)));tail.scaling.set(1,.78,1);tail.visibility=.78-i*.12;tail.metadata={castShadow:false};tails.push(tail);
    }

    const impactRoot=this.root(`meteor-impact-${event.sequence||state?.revision||0}`);impactRoot.position.copyFrom(target);impactRoot.metadata={castShadow:false,presentationType:"METEOR_IMPACT"};
    const blast=this.addMesh(impactRoot,BABYLON.MeshBuilder.CreateSphere(`meteor-blast-${event.sequence||0}`,{diameter:1,segments:9},this.scene),this.materials.meteorBlast);blast.position.y=.20;blast.visibility=0;blast.metadata={castShadow:false};
    const ring=this.addMesh(impactRoot,BABYLON.MeshBuilder.CreateTorus(`meteor-wave-${event.sequence||0}`,{diameter:1,thickness:.075,tessellation:28},this.scene),this.materials.shockwave);ring.position.y=.055;ring.visibility=0;ring.metadata={castShadow:false};
    const dust=[];
    for(let i=0;i<8;i++){
      const puff=this.addMesh(impactRoot,BABYLON.MeshBuilder.CreateSphere(`meteor-dust-${event.sequence||0}-${i}`,{diameter:.42+(i%3)*.08,segments:5},this.scene),this.materials.meteorDust);
      const a=i*Math.PI/4+hash01(`meteor-dust:${event.sequence||0}:${i}`)*.35;puff.metadata={castShadow:false,angle:a,reach:.55+(i%4)*.13};puff.visibility=0;dust.push(puff);
    }
    const debris=[];
    for(let i=0;i<8;i++){
      const chip=this.addMesh(impactRoot,BABYLON.MeshBuilder.CreatePolyhedron(`meteor-debris-${event.sequence||0}-${i}`,{type:2,size:.09+(i%3)*.025},this.scene),this.materials.fragments);
      const a=i*Math.PI/4+hash01(`meteor-chip:${event.sequence||0}:${i}`)*.42;chip.metadata={castShadow:false,angle:a,speed:1.15+(i%4)*.18,lift:1.5+(i%3)*.28};chip.visibility=0;debris.push(chip);
    }
    const flash=new BABYLON.PointLight(`meteor-flash-${event.sequence||0}`,target.clone(),this.scene);flash.diffuse=new BABYLON.Color3(1,.42,.08);flash.specular=new BABYLON.Color3(.32,.10,.015);flash.range=Math.max(3,(shockwaveRadius+1)*TILE_SIZE*1.8);flash.intensity=0;
    const now=globalThis.performance?.now?.()??Date.now(),startedAt=Number(event?.startedAt),age=Number.isFinite(startedAt)?Math.max(0,(now-startedAt)/1000):0;
    // Compile transparent blast/dust shaders during descent, not on impact.
    for(const mesh of [blast,ring,dust[0],debris[0]])mesh?.material?.forceCompilationAsync?.(mesh).catch(error=>console.warn("Impact material warmup",error));
    this.meteorBursts.push({event,root,body,tails,impactRoot,blast,ring,dust,debris,flash,start,target,trailDirection,age,startedAt:Number.isFinite(startedAt)?startedAt:now,fallDuration,impactDuration,innerRadius,shockwaveRadius,impacted:false});
  }

  updateMeteor(dt){
    const now=globalThis.performance?.now?.()??Date.now();
    const keep=[];
    for(const entry of this.meteorBursts){
      entry.age=Math.max(0,(now-entry.startedAt)/1000);
      if(entry.age<entry.fallDuration){
        const p=clamp(entry.age/entry.fallDuration,0,1),q=p*p;
        entry.root.position.copyFrom(BABYLON.Vector3.Lerp(entry.start,entry.target,q));
        entry.body.rotation.x+=dt*5.2;entry.body.rotation.y+=dt*7.4;entry.body.rotation.z+=dt*3.6;
        const pulse=.92+.10*Math.sin(entry.age*26);entry.body.scaling.set(1.05*pulse,.92*pulse,1.12*pulse);
        for(let i=0;i<entry.tails.length;i++)entry.tails[i].visibility=(.76-i*.11)*(.72+.28*Math.sin(entry.age*19+i));
        keep.push(entry);continue;
      }

      if(!entry.impacted){entry.impacted=true;entry.impactStartedAt=now;entry.root.setEnabled(false);entry.blast.visibility=1;entry.ring.visibility=1;for(const puff of entry.dust)puff.visibility=.72;for(const chip of entry.debris)chip.visibility=1;entry.flash.intensity=4.2;}
      const t=clamp((now-entry.impactStartedAt)/(entry.impactDuration*1000),0,1),ease=1-Math.pow(1-t,3);
      const blastScale=.35+Math.max(1,entry.innerRadius+.65)*TILE_SIZE*1.15*ease;entry.blast.scaling.setAll(blastScale);entry.blast.visibility=(1-t)*.88;
      const waveDiameter=Math.max(TILE_SIZE*1.4,(entry.shockwaveRadius*2+1)*TILE_SIZE);entry.ring.scaling.setAll(.35+waveDiameter*ease);entry.ring.visibility=(1-t)*.82;
      const seconds=t*entry.impactDuration;
      for(const puff of entry.dust){const a=puff.metadata.angle,r=puff.metadata.reach*TILE_SIZE*(.25+ease*1.65);puff.position.set(Math.cos(a)*r,.10+ease*.72,Math.sin(a)*r);puff.scaling.setAll(.55+ease*1.05);puff.visibility=(1-t)*.66;}
      for(const chip of entry.debris){const a=chip.metadata.angle,speed=chip.metadata.speed,lift=chip.metadata.lift,r=speed*seconds;chip.position.set(Math.cos(a)*r,.14+lift*seconds-2.4*seconds*seconds,Math.sin(a)*r);chip.rotation.x+=dt*8;chip.rotation.y+=dt*11;chip.visibility=1-t;}
      entry.flash.intensity=Math.max(0,4.2*(1-t*3.4));
      if(t>=1){entry.flash.dispose();entry.root.dispose();entry.impactRoot.dispose();}else keep.push(entry);
    }
    this.meteorBursts=keep;
  }

  syncPresentationEvents(events,state){
    for(const event of events||[]){
      if(event?.type==="LIGHTNING_STRIKE"){const token=`${state?.revision||0}:${event.x}:${event.y}:${event.unitId||event.unit?.id||""}`;if(token===this.lastLightningToken)continue;this.lastLightningToken=token;this.createLightningBurst(event,state);continue;}
      if(event?.type==="METEOR_STRIKE"){const token=String(event.sequence??`${state?.revision||0}:${event.x}:${event.y}`);if(this.seenPresentationSequences.has(token))continue;this.seenPresentationSequences.add(token);while(this.seenPresentationSequences.size>64)this.seenPresentationSequences.delete(this.seenPresentationSequences.values().next().value);this.createMeteorStrike(event,state);}
    }
  }

  updateLightning(dt){
    this.lightningFlash.intensity=Math.max(0,this.lightningFlash.intensity-dt*10.5);const keep=[];
    for(const burst of this.lightningBursts){burst.age+=dt;const p=clamp(burst.age/burst.duration,0,1);for(const mesh of burst.meshes)mesh.alpha=(1-p)*.95;if(p>=1){for(const mesh of burst.meshes)mesh.dispose();}else keep.push(burst);}this.lightningBursts=keep;
  }

  updateWeatherFrame(dt){
    this.updateRainImpacts(dt);this.updateLightning(dt);this.updateMeteor(dt);
    const target=this.scene.activeCamera?.getTarget?.(),cameraKey=target?`${Math.round(target.x)},${Math.round(target.z)}`:"";
    if(this.lastState&&cameraKey!==this.fireCameraKey){this.fireCameraKey=cameraKey;this.syncFireLights(this.lastState);this.syncFireGlows(this.lastState);}

    for(const light of this.fireLights)if(light.isEnabled())light.intensity=light.metadata.baseIntensity*(.94+.06*Math.sin(this.weatherTime*9+light.metadata.phase));
  }

  syncFireLights(state){
    const sources=state?.presentation?.environment?.lightSources||[],byKey=new Map((state?.map?.tiles||[]).map(t=>[`${t.x},${t.y}`,t]));
    // Four shared lights cover distinct fire clusters; never one light per tile.
    const selected=[];
    const focus=this.scene.activeCamera?.getTarget?.()||{x:0,z:0};
    const distance=source=>Math.hypot(source.x*TILE_SIZE-focus.x,source.y*TILE_SIZE-focus.z);
    for(const source of [...sources].sort((a,b)=>distance(a)-distance(b)||b.radius-a.radius||a.y-b.y||a.x-b.x)){
      if(selected.some(other=>Math.hypot(other.x-source.x,other.y-source.y)<2))continue;
      selected.push(source);if(selected.length===4)break;
    }
    for(let i=0;i<selected.length;i++){
      let light=this.fireLights[i];
      if(!light){light=new BABYLON.PointLight(`environment-fire-light-${i}`,BABYLON.Vector3.Zero(),this.scene);light.diffuse=new BABYLON.Color3(1,.40,.09);light.specular=new BABYLON.Color3(.16,.06,.01);this.fireLights.push(light);}
      const source=selected[i],tile=byKey.get(`${source.x},${source.y}`);
      light.position.set(source.x*TILE_SIZE,surfaceOf(tile||{})*ELEVATION_HEIGHT+1,source.y*TILE_SIZE);
      light.range=Math.max(1,Number(source.radius||1))*TILE_SIZE;
      light.metadata={baseIntensity:state?.presentation?.environment?.timeOfDay==="NIGHT"?1.4:1.05,phase:source.x*.7+source.y};
      light.intensity=light.metadata.baseIntensity;light.setEnabled(true);
    }
    for(let i=selected.length;i<this.fireLights.length;i++){this.fireLights[i].intensity=0;this.fireLights[i].setEnabled(false);}
    // Three scene lights + lightning flash + up to four local fire lights.
    if(selected.length)for(const material of this.scene.materials)if(Number.isFinite(material.maxSimultaneousLights)&&material.maxSimultaneousLights<8)material.maxSimultaneousLights=8;
  }

  makeFireGlowMaterial(){
    const size=64,pixels=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const r=Math.hypot((x+.5-size/2)/(size/2),(y+.5-size/2)/(size/2)),i=(y*size+x)*4;
      pixels[i]=255;pixels[i+1]=125;pixels[i+2]=30;
      pixels[i+3]=Math.round(255*Math.pow(Math.max(0,1-r),2.2));
    }
    const texture=BABYLON.RawTexture.CreateRGBATexture(pixels,size,size,this.scene,false,false,BABYLON.Texture.BILINEAR_SAMPLINGMODE);
    texture.hasAlpha=true;
    const material=new BABYLON.StandardMaterial("fire-mist-glow",this.scene);
    material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;
    material.emissiveColor=BABYLON.Color3.White();material.disableLighting=true;
    material.alphaMode=BABYLON.Engine.ALPHA_ADD;material.disableDepthWrite=true;
    material.backFaceCulling=false;material.fogEnabled=false;
    // Engine transmission already accounts for mist/smoke. Keep depth testing so
    // the soft billboard cannot draw over foreground terrain or opaque props.
    return material;
  }

  syncFireGlows(state){
    const weather=state?.presentation?.environment?.weather;
    const mist=weather==="FOG"?1:weather==="BLIZZARD"?.7:0;
    const alive=new Set(),byKey=new Map((state?.map?.tiles||[]).map(tile=>[`${tile.x},${tile.y}`,tile]));
    const focus=this.scene.activeCamera?.getTarget?.()||{x:0,z:0};
    const sources=(state?.presentation?.environment?.lightSources||[]).filter(source=>Number(source.transmission||0)>0)
      .sort((a,b)=>Math.hypot(a.x*TILE_SIZE-focus.x,a.y*TILE_SIZE-focus.z)-Math.hypot(b.x*TILE_SIZE-focus.x,b.y*TILE_SIZE-focus.z)).slice(0,48);
    for(const source of sources){
      const tile=byKey.get(`${source.x},${source.y}`),smoky=tile?.effects?.includes("SMOKE");
      if(!mist&&!smoky)continue;
      const key=`${source.x},${source.y}:${source.source}`;alive.add(key);
      let mesh=this.fireGlows.get(key);
      if(!mesh){
        this.fireGlowMaterial??=this.makeFireGlowMaterial();
        mesh=BABYLON.MeshBuilder.CreatePlane(`fire-glow-${key}`,{size:1},this.scene);
        mesh.material=this.fireGlowMaterial;mesh.billboardMode=BABYLON.Mesh.BILLBOARDMODE_ALL;
        mesh.isPickable=false;mesh.metadata={castShadow:false};this.fireGlows.set(key,mesh);
      }
      mesh.position.set(source.x*TILE_SIZE,surfaceOf(tile||{})*ELEVATION_HEIGHT+.8,source.y*TILE_SIZE);
      mesh.scaling.setAll((1.6+mist*1.7)*Math.max(1,Number(source.radius||1)/2));
      mesh.visibility=Math.min(.7,Number(source.transmission||0)*(.45+mist*.25));
    }
    for(const [key,mesh] of this.fireGlows)if(!alive.has(key)){mesh.dispose();this.fireGlows.delete(key);}
  }

  syncFriendlyVisibility(state){
    const friendly=(state?.units||[]).filter(unit=>unit?.friendlyToViewer),friendlyMaterialNames=new Set(friendly.map(unit=>`unit-billboard-mat-${unit.id}`));
    const signature=`${(this.scene.materials||[]).length}|${friendly.map(unit=>unit.id).sort().join(",")}`;
    if(signature===this.friendlyMaterialSignature)return;this.friendlyMaterialSignature=signature;
    for(const material of this.scene.materials||[]){
      if(material?.name==="player"||material?.name==="unit-facing"||material?.name==="unit-submerged"||material?.name==="unit-airborne"){material.fogEnabled=false;continue;}
      if(String(material?.name||"").startsWith("unit-billboard-mat-"))material.fogEnabled=!friendlyMaterialNames.has(material.name);
    }
  }

  mat(name,color,alpha=1,emissive=null){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;material.alpha=alpha;material.specularColor=BABYLON.Color3.Black();
    if(emissive)material.emissiveColor=emissive;return material;
  }

  makeVisibilityHazeMaterial(){
    const material=new BABYLON.StandardMaterial("weather-visibility-haze",this.scene);
    material.diffuseColor=BABYLON.Color3.White();
    material.emissiveColor=BABYLON.Color3.White();
    material.specularColor=BABYLON.Color3.Black();
    material.disableLighting=true;
    material.backFaceCulling=false;
    material.fogEnabled=false;
    material.needDepthPrePass=false;
    material.disableDepthWrite=true;
    if(BABYLON.Material?.MATERIAL_ALPHABLEND!=null)material.transparencyMode=BABYLON.Material.MATERIAL_ALPHABLEND;
    return material;
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

  effectDetail(tile,type){
    const wanted=String(type||"");
    return(tile?.effectDetails||[]).find(effect=>String(effect?.type||"")===wanted)||null;
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

  visibilityHazeProfile(state){
    const weather=String(state?.presentation?.environment?.weather||"CLEAR").toUpperCase();
    return VISIBILITY_HAZE_PROFILE[weather]||null;
  }

  visibilityHazeStateSignature(state){
    const profile=this.visibilityHazeProfile(state),weather=String(state?.presentation?.environment?.weather||"CLEAR").toUpperCase();
    if(!profile)return`${weather}|OFF`;
    return`${weather}|`+(state?.map?.tiles||[]).map(tile=>[
      tile.x,tile.y,tile.fogged?1:0,
      Number(tile.elevation||0).toFixed(3),
      tile.waterSurfaceZ==null?"n":Number(tile.waterSurfaceZ).toFixed(3)
    ].join(":" )).join("|");
  }

  disposeVisibilityHaze(){
    this.visibilityHazeMesh?.dispose();
    this.visibilityHazeMesh=null;
  }

  visibilityHazeAlpha(tile,byKey,ox,oz,profile){
    if(!tile?.fogged)return 0;
    let factor=1;
    const edgeX=Math.abs(Math.abs(Number(ox||0))-.5)<=1e-6?Math.sign(Number(ox||0)):0;
    const edgeZ=Math.abs(Math.abs(Number(oz||0))-.5)<=1e-6?Math.sign(Number(oz||0)):0;
    const visibleNeighbor=(dx,dy)=>{
      const neighbor=byKey.get(this.surfaceResolver.keyOf(Number(tile.x)+dx,Number(tile.y)+dy));
      return !!neighbor&&!neighbor.fogged;
    };
    if(edgeX&&visibleNeighbor(edgeX,0))factor*=Number(profile.edgeFactor||.25);
    if(edgeZ&&visibleNeighbor(0,edgeZ))factor*=Number(profile.edgeFactor||.25);
    if(edgeX&&edgeZ&&visibleNeighbor(edgeX,edgeZ))factor*=.72;
    return clamp(Number(profile.alpha||0)*factor,0,1);
  }

  buildVisibilityHaze(state,profile){
    const tiles=state?.map?.tiles||[],foggedTiles=tiles.filter(tile=>tile?.fogged);
    if(!foggedTiles.length)return null;
    const byKey=new Map(tiles.map(tile=>[this.surfaceResolver.keyOf(tile.x,tile.y),tile]));
    const positions=[],indices=[],colors=[];
    let activeTiles=0;

    for(const tile of foggedTiles){
      const patch=this.surfaceResolver.resolveTile(tile,byKey).patchGrid;
      const baseIndex=positions.length/3;
      const waterSurface=this.surfaceResolver.waterSurfaceOf(tile);
      activeTiles++;
      for(let row=0;row<4;row++)for(let col=0;col<4;col++){
        const sample=patch[row][col],sampleHeight=Number(sample.height||0);
        const visualHeight=Math.max(sampleHeight,waterSurface==null?sampleHeight:Number(waterSurface));
        const alpha=this.visibilityHazeAlpha(tile,byKey,sample.ox,sample.oz,profile);
        positions.push(sample.x,visualHeight*ELEVATION_HEIGHT+Number(profile.height||.4),sample.z);
        colors.push(profile.color[0],profile.color[1],profile.color[2],alpha);
      }
      for(let row=0;row<3;row++)for(let col=0;col<3;col++){
        const nw=baseIndex+row*4+col,ne=nw+1,sw=baseIndex+(row+1)*4+col,se=sw+1;
        const alternate=(Number(tile.x)+Number(tile.y)+row+col)&1;
        if(alternate===0)indices.push(nw,ne,se,nw,se,sw);
        else indices.push(nw,ne,sw,ne,se,sw);
      }
    }

    if(!indices.length)return null;
    const mesh=new BABYLON.Mesh("weather-visibility-haze",this.scene),data=new BABYLON.VertexData();
    data.positions=positions;data.indices=indices;data.colors=colors;data.applyToMesh(mesh,false);
    mesh.material=this.visibilityHazeMaterial;
    mesh.useVertexColors=true;mesh.hasVertexAlpha=true;mesh.isPickable=false;
    mesh.metadata={
      kind:"weather-visibility-haze",
      activeTiles,
      fovDriven:true,
      mergedMesh:true,
      softBoundary:true,
      gameplayVisibilityOwner:"TacticalEngine"
    };
    return mesh;
  }

  syncVisibilityHaze(state){
    const signature=this.visibilityHazeStateSignature(state);
    if(signature===this.visibilityHazeSignature)return;
    this.disposeVisibilityHaze();
    const profile=this.visibilityHazeProfile(state);
    if(profile)this.visibilityHazeMesh=this.buildVisibilityHaze(state,profile);
    this.visibilityHazeSignature=signature;
  }

  syncAtmosphere(state){
    const environment=state?.presentation?.environment||{},weather=String(environment.weather||"CLEAR").toUpperCase(),night=environment.timeOfDay==="NIGHT";
    this.scene.clearColor=night?new BABYLON.Color4(.018,.027,.055,1):new BABYLON.Color4(.035,.055,.08,1);

    // Atmosphere is allowed to tint the whole battlefield, but it no longer owns
    // visibility. TacticalEngine/FOV decides what is visible; fogged tiles receive
    // an additional soft haze mesh so the old thick-weather mood survives outside
    // the player's sight without washing out the readable area around observers.
    const profile=SCENE_FOG_PROFILE[weather]||null;
    if(profile){
      this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;
      this.scene.fogDensity=Number(profile.density||0);
      this.scene.fogColor=new BABYLON.Color3(...profile.color);
    }else{
      this.scene.fogMode=BABYLON.Scene.FOGMODE_NONE;
      this.scene.fogDensity=0;
    }
    this.atmosphereState={
      weather,
      globalSceneFog:!!profile,
      sceneFogDensity:profile?Number(profile.density||0):0,
      visibilityOwner:"FOV",
      layeredVisibilityHaze:!!this.visibilityHazeProfile(state)
    };
  }

  sync(state,presentationEvents=[]){
    this.lastState=state;
    this.syncAtmosphere(state);
    this.syncSurfaceLayers(state);
    this.syncVisibilityHaze(state);
    this.syncWeatherParticles(state);
    this.syncPresentationEvents(presentationEvents,state);
    this.syncFriendlyVisibility(state);
    this.syncFireLights(state);
    this.syncFireGlows(state);
    const visibleLights=new Set((state?.presentation?.environment?.lightSources||[]).filter(light=>light.visible).map(light=>`${light.x},${light.y}:${light.source}`));
    const luminousTiles=new Set((state?.presentation?.environment?.lightSources||[]).filter(light=>light.visible||light.transmission>0).map(light=>`${light.x},${light.y}`));
    const friendlyUnits=(state?.units||[]).filter(unit=>unit?.friendlyToViewer),friendlyDistance=(tile)=>friendlyUnits.reduce((best,unit)=>Math.min(best,Math.abs(Number(unit.x)-Number(tile.x))+Math.abs(Number(unit.y)-Number(tile.y))),Infinity);
    const alive=new Set();
    for(const tile of state?.map?.tiles||[]){
      const surface=surfaceOf(tile)*ELEVATION_HEIGHT;
      for(const type of this.desiredNodeTypes(tile)){
        const key=keyOf(tile,type);alive.add(key);let node=this.nodes.get(key);
        if(!node){node=this.create(type,key,tile);if(!node)continue;this.nodes.set(key,node);}
        node.position.set(tile.x*TILE_SIZE,surface,tile.y*TILE_SIZE);
        let visible=tile.fogged?(visibleLights.has(key)?.70:type==="SMOKE"&&luminousTiles.has(`${tile.x},${tile.y}`)?.45:0):1;
        const friendlyRange=friendlyDistance(tile);
        if(type==="SMOKE"){
          const detail=this.effectDetail(tile,type),intensity=clamp(detail?.intensity??.8,0,2.5);
          const density=clamp(.48+intensity*.20,.48,.94),size=clamp(.86+intensity*.20,.90,1.36);
          node.scaling.setAll(size);
          visible*=density;
          if(friendlyRange<=1)visible=Math.min(visible,friendlyRange===0?.38:.56);
        }else if(type==="STEAM"&&friendlyRange===0)visible=Math.min(visible,.38);
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
      weatherParticles:this.weatherPresentation||{rainActive:false,rainEmitRate:0,mistActive:false,mistEmitRate:0,globalSceneFog:false},
      atmosphere:this.atmosphereState||{globalSceneFog:false,visibilityOwner:"FOV"},
      visibilityHaze:this.visibilityHazeMesh?{active:true,tiles:Number(this.visibilityHazeMesh.metadata?.activeTiles||0),softBoundary:true}:{active:false,tiles:0,softBoundary:true},
      smokeDensityFromEffectDetails:true,
      rainImpactPool:{size:this.rainImpacts.length,active:this.rainImpacts.filter(item=>item.active).length},
      lightningBursts:this.lightningBursts.length,
      meteorBursts:this.meteorBursts.length,
      fireGlows:this.fireGlows.size,
      fireLights:{active:this.fireLights.filter(light=>light.isEnabled()).length,maximum:4},
      electrifiedPresentation:"sparse-surface-arcs",
      perTileElectricRings:false
    };
  }
}
