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
const SNOW_PARTICLE_CAPACITY=920;
const MIST_PARTICLE_CAPACITY=120;
const SMOKE_PARTICLE_CAPACITY=260;
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
  }),
  TYPHOON:Object.freeze({
    emitRate:18,minSize:.68,maxSize:1.38,minLifeTime:.78,maxLifeTime:1.48,
    height:.68,boxHeight:1.04,drift:.34,rise:.014,
    color1:Object.freeze([.35,.44,.51,.11]),color2:Object.freeze([.27,.36,.43,.055])
  })
});
const SCENE_FOG_PROFILE=Object.freeze({
  FOG:Object.freeze({density:.009,color:Object.freeze([.48,.53,.57])}),
  BLIZZARD:Object.freeze({density:.008,color:Object.freeze([.64,.69,.74])}),
  RAIN:Object.freeze({density:.0018,color:Object.freeze([.28,.34,.38])}),
  HEAVY_RAIN:Object.freeze({density:.0042,color:Object.freeze([.20,.26,.31])}),
  THUNDERSTORM:Object.freeze({density:.0052,color:Object.freeze([.17,.22,.28])}),
  TYPHOON:Object.freeze({density:.0062,color:Object.freeze([.14,.19,.24])})
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
    this.tornadoClusters=new Map();
    this.tornadoClusterSignature="";
    this.smokeClusters=new Map();
    this.smokeClusterSignature="";
    this.fireFields=new Map();
    this.fireFieldSignature="";


    this.materials={
      fire:this.mat("env-fire",new BABYLON.Color3(1,.28,.04),.76,new BABYLON.Color3(.9,.12,.01)),
      fireWind:this.mat("env-fire-wind",new BABYLON.Color3(1,.32,.05),.56,new BABYLON.Color3(.75,.08,.01)),
      waterWind:this.mat("env-water-wind",new BABYLON.Color3(.30,.74,1),.48,new BABYLON.Color3(.08,.32,.52)),
      wind:this.mat("env-wind",new BABYLON.Color3(.68,.82,.90),.36,new BABYLON.Color3(.14,.22,.28)),
      woodDebris:this.mat("env-tornado-wood",new BABYLON.Color3(.28,.16,.075),.96,new BABYLON.Color3(.035,.018,.006)),
      steam:this.mat("env-steam",new BABYLON.Color3(.80,.86,.88),.26),
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
    this.snowTexture=this.makeSnowTexture();
    this.mistTexture=this.makeMistTexture();
    this.smokeTexture=this.makeSmokeTexture();
    this.smokeHazeMaterial=this.makeSmokeHazeMaterial();
    this.fireFieldMaterial=this.makeFireFieldMaterial();
    this.rainSystem=this.makeRainSystem();
    this.snowSystem=this.makeSnowSystem();
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
        const {node,speed=0,spin=true}=entry;
        if(entry.tornadoCluster){
          if(entry.moveTarget){const q=1-Math.exp(-dt*8);node.position.x+=(entry.moveTarget.x-node.position.x)*q;node.position.y+=(entry.moveTarget.y-node.position.y)*q;node.position.z+=(entry.moveTarget.z-node.position.z)*q;if(BABYLON.Vector3.DistanceSquared(node.position,entry.moveTarget)<.0004){node.position.copyFrom(entry.moveTarget);entry.moveTarget=null;}}
          const pulse=.96+Math.sin(this.weatherTime*4.2+Number(entry.phase||0))*.035;
          node.scaling.set(pulse,1,pulse);
          for(let i=0;i<(entry.rings||[]).length;i++){
            const ring=entry.rings[i];
            ring.rotation.y+=Number(entry.ringSpeeds?.[i]||speed)*(i%2?-1:1)*dt;
            ring.rotation.x=Math.sin(this.weatherTime*2.1+i*.8)*.045;
          }
          for(let i=0;i<(entry.orbiters||[]).length;i++){
            const orb=entry.orbiters[i],meta=orb.metadata||{},a=this.weatherTime*Number(meta.speed||1.5)+Number(meta.phase||0),r=Number(meta.radius||.5);
            orb.position.x=Math.cos(a)*r;orb.position.z=Math.sin(a)*r;
            orb.position.y=Number(meta.baseY||.6)+Math.sin(a*1.7)*Number(meta.bob||.12);
            orb.rotation.x+=dt*(meta.tornadoLog?7.2:4.2);orb.rotation.y+=dt*(meta.tornadoLog?8.4:6.1);if(meta.tornadoLog)orb.rotation.z+=dt*5.6;
          }
        }else if(entry.fire){
          for(let i=0;i<(entry.flames||[]).length;i++){
            const flame=entry.flames[i],meta=flame.metadata||{},wave=Math.sin(this.weatherTime*Number(meta.speed||8)+Number(meta.phase||0)),flutter=Math.sin(this.weatherTime*(Number(meta.speed||8)*1.73)+Number(meta.phase||0)*.7);
            const sx=Number(meta.scaleX||1),sy=Number(meta.scaleY||1),sz=Number(meta.scaleZ||1);
            flame.scaling.set(sx*(.88+wave*.10),sy*(.92+wave*.16+flutter*.055),sz*(.90-wave*.07));
            flame.position.y=Number(meta.baseY||.35)+wave*.045;
            flame.rotation.z=Number(meta.baseTilt||0)+flutter*.10;
            flame.visibility=clamp(Number(meta.baseVisibility||1)*(.86+wave*.11),.25,1);
          }
        }else if(entry.smokeCluster){
          for(let i=0;i<(entry.hazes||[]).length;i++){
            const haze=entry.hazes[i],meta=haze.metadata||{},wave=Math.sin(this.weatherTime*Number(meta.speed||.55)+Number(meta.phase||0));
            haze.position.y=Number(meta.baseY||1)+wave*.06;
            haze.scaling.x=Number(meta.baseScaleX||1)*(1+wave*.045);
            haze.scaling.y=Number(meta.baseScaleY||1)*(1-wave*.025);
            const age=Math.max(0,this.weatherTime-Number(entry.startedAt||0)),gather=.32+.68*clamp((age-.18)/1.35,0,1);haze.visibility=clamp(Number(meta.baseVisibility||.35)*gather*(1+wave*.08),0,.78);
          }
        }else if(entry.fireField){
          const pulse=.93+Math.sin(this.weatherTime*Number(entry.speed||3.6)+Number(entry.phase||0))*.07;
          for(const field of entry.fields||[]){const meta=field.metadata||{};field.scaling.x=Number(meta.baseScaleX||1)*pulse;field.scaling.y=Number(meta.baseScaleY||1)*pulse;field.visibility=clamp(Number(meta.baseVisibility||.2)*(1.02+Math.sin(this.weatherTime*5.7+Number(meta.phase||0))*.13),0,.55);}
        }else if(spin)node.rotation.y+=speed*dt;
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

  makeSnowTexture(){
    const texture=new BABYLON.DynamicTexture("weather-snow-flake",{width:48,height:48},this.scene,false);texture.hasAlpha=true;
    const ctx=texture.getContext();ctx.clearRect(0,0,48,48);
    const g=ctx.createRadialGradient(24,24,1,24,24,20);g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(.35,"rgba(244,250,255,.92)");g.addColorStop(1,"rgba(220,238,255,0)");
    ctx.fillStyle=g;ctx.fillRect(0,0,48,48);
    ctx.strokeStyle="rgba(248,253,255,.72)";ctx.lineWidth=2;ctx.lineCap="round";
    for(let i=0;i<3;i++){const a=i*Math.PI/3,dx=Math.cos(a)*15,dy=Math.sin(a)*15;ctx.beginPath();ctx.moveTo(24-dx,24-dy);ctx.lineTo(24+dx,24+dy);ctx.stroke();}
    texture.update();return texture;
  }

  makeMistTexture(){
    const texture=new BABYLON.DynamicTexture("weather-mist-soft",{width:64,height:64},this.scene,false);texture.hasAlpha=true;
    const ctx=texture.getContext(),g=ctx.createRadialGradient(32,32,2,32,32,31);g.addColorStop(0,"rgba(205,222,232,.32)");g.addColorStop(.55,"rgba(190,210,222,.14)");g.addColorStop(1,"rgba(180,200,214,0)");ctx.fillStyle=g;ctx.fillRect(0,0,64,64);texture.update();return texture;
  }

  makeSmokeTexture(){
    const texture=new BABYLON.DynamicTexture("environment-smoke-soft",{width:96,height:96},this.scene,false);texture.hasAlpha=true;
    const ctx=texture.getContext();ctx.clearRect(0,0,96,96);
    const blobs=[[48,52,40,.82],[32,48,25,.54],[64,43,28,.52],[54,30,22,.36]];
    for(const [x,y,r,a] of blobs){const g=ctx.createRadialGradient(x,y,2,x,y,r);g.addColorStop(0,`rgba(255,255,255,${a})`);g.addColorStop(.52,`rgba(240,244,246,${a*.52})`);g.addColorStop(1,"rgba(225,232,236,0)");ctx.fillStyle=g;ctx.fillRect(0,0,96,96);}
    texture.update();return texture;
  }

  makeSmokeHazeMaterial(){
    const material=new BABYLON.StandardMaterial("environment-smoke-haze",this.scene);
    material.diffuseTexture=this.smokeTexture;material.opacityTexture=this.smokeTexture;material.useAlphaFromDiffuseTexture=true;
    material.diffuseColor=new BABYLON.Color3(.12,.13,.14);material.emissiveColor=new BABYLON.Color3(.035,.038,.042);
    material.specularColor=BABYLON.Color3.Black();material.alpha=.72;material.disableDepthWrite=true;material.backFaceCulling=false;
    if(BABYLON.Material?.MATERIAL_ALPHABLEND!=null)material.transparencyMode=BABYLON.Material.MATERIAL_ALPHABLEND;
    return material;
  }

  makeFireFieldMaterial(){
    const texture=new BABYLON.DynamicTexture("environment-fire-radiance-soft",{width:96,height:96},this.scene,false);texture.hasAlpha=true;
    const ctx=texture.getContext(),g=ctx.createRadialGradient(48,48,2,48,48,47);g.addColorStop(0,"rgba(255,255,255,.92)");g.addColorStop(.38,"rgba(255,220,170,.48)");g.addColorStop(.72,"rgba(255,170,90,.18)");g.addColorStop(1,"rgba(255,120,40,0)");ctx.fillStyle=g;ctx.fillRect(0,0,96,96);texture.update();
    const material=new BABYLON.StandardMaterial("environment-fire-radiance",this.scene);material.diffuseTexture=texture;material.opacityTexture=texture;material.useAlphaFromDiffuseTexture=true;
    material.diffuseColor=new BABYLON.Color3(1,.22,.025);material.emissiveColor=new BABYLON.Color3(1,.16,.015);material.specularColor=BABYLON.Color3.Black();
    material.alpha=.34;material.disableLighting=true;material.disableDepthWrite=true;material.backFaceCulling=false;material.fogEnabled=true;material.alphaMode=BABYLON.Engine.ALPHA_ADD;
    return material;
  }

  makeRainSystem(){
    const system=new BABYLON.ParticleSystem("weather-rain",RAIN_PARTICLE_CAPACITY,this.scene);system.particleTexture=this.rainTexture;
    system.emitter=new BABYLON.Vector3(0,7,0);system.minEmitBox=new BABYLON.Vector3(-4,0,-4);system.maxEmitBox=new BABYLON.Vector3(4,.4,4);
    system.color1=new BABYLON.Color4(.72,.88,1,.72);system.color2=new BABYLON.Color4(.88,.96,1,.86);system.colorDead=new BABYLON.Color4(.7,.85,1,0);
    system.minSize=.09;system.maxSize=.16;system.minLifeTime=.34;system.maxLifeTime=.62;system.emitRate=0;system.minEmitPower=10;system.maxEmitPower=14;system.updateSpeed=.012;system.blendMode=BABYLON.ParticleSystem.BLENDMODE_STANDARD;system.start();return system;
  }

  makeSnowSystem(){
    const system=new BABYLON.ParticleSystem("weather-snow",SNOW_PARTICLE_CAPACITY,this.scene);system.particleTexture=this.snowTexture;
    system.emitter=new BABYLON.Vector3(0,7,0);system.minEmitBox=new BABYLON.Vector3(-4,0,-4);system.maxEmitBox=new BABYLON.Vector3(4,.6,4);
    system.color1=new BABYLON.Color4(.94,.98,1,.95);system.color2=new BABYLON.Color4(.82,.92,1,.80);system.colorDead=new BABYLON.Color4(.84,.92,1,0);
    system.minSize=.055;system.maxSize=.13;system.minLifeTime=2.1;system.maxLifeTime=4.2;system.emitRate=0;
    system.minEmitPower=1.2;system.maxEmitPower=2.2;system.updateSpeed=.016;system.blendMode=BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    system.gravity=new BABYLON.Vector3(0,-.22,0);system.start();return system;
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
    const raining=weather==="RAIN"||weather==="HEAVY_RAIN"||weather==="THUNDERSTORM"||weather==="TYPHOON";
    const snowing=weather==="SNOW"||weather==="BLIZZARD";
    return{
      weather,wind,raining,snowing,blizzard:weather==="BLIZZARD",
      heavy:weather==="HEAVY_RAIN"||weather==="THUNDERSTORM"||weather==="TYPHOON",
      thunder:weather==="THUNDERSTORM"||weather==="TYPHOON",
      mist:WEATHER_MIST_PROFILE[weather]||NO_MIST
    };
  }

  syncWeatherParticles(state){
    const settings=this.weatherSettings(state),tiles=state?.map?.tiles||[],width=Math.max(1,Number(state?.map?.width||1)),height=Math.max(1,Number(state?.map?.height||1));
    const centerX=(width-1)*TILE_SIZE*.5,centerZ=(height-1)*TILE_SIZE*.5,maxSurface=tiles.length?Math.max(...tiles.map(tile=>surfaceOf(tile)*ELEVATION_HEIGHT)):0;
    const windX=Number(settings.wind?.x||0),windZ=Number(settings.wind?.y||0),rawStrength=Math.max(0,Number(settings.wind?.strength||0)),strength=globalThis.EnvironmentEngine?.windVisualStrength?.(rawStrength)??Math.min(8,rawStrength),mist=settings.mist||NO_MIST;
    this.rainSystem.emitter.set(centerX,maxSurface+7.2,centerZ);this.rainSystem.minEmitBox.set(-width*TILE_SIZE*.56,0,-height*TILE_SIZE*.56);this.rainSystem.maxEmitBox.set(width*TILE_SIZE*.56,.5,height*TILE_SIZE*.56);
    const horizontal=.11+strength*.13;this.rainSystem.direction1.set(windX*horizontal,-1,windZ*horizontal);this.rainSystem.direction2.set(windX*horizontal*.82,-1,windZ*horizontal*.82);this.rainSystem.minEmitPower=10+strength*1.4;this.rainSystem.maxEmitPower=13+strength*1.8;
    this.rainSystem.emitRate=settings.weather==="RAIN"?170:settings.weather==="HEAVY_RAIN"?390:settings.weather==="THUNDERSTORM"?470:settings.weather==="TYPHOON"?620:0;

    this.snowSystem.emitter.set(centerX,maxSurface+6.6,centerZ);
    this.snowSystem.minEmitBox.set(-width*TILE_SIZE*.56,0,-height*TILE_SIZE*.56);this.snowSystem.maxEmitBox.set(width*TILE_SIZE*.56,.7,height*TILE_SIZE*.56);
    if(settings.snowing){
      const blizzard=settings.blizzard;
      const baseX=Math.abs(windX)+Math.abs(windZ)>.001?windX:1,baseZ=Math.abs(windX)+Math.abs(windZ)>.001?windZ:.18,norm=Math.max(.001,Math.hypot(baseX,baseZ));
      const nx=baseX/norm,nz=baseZ/norm;
      if(blizzard){
        // In an isometric camera, world-horizontal motion projects very strongly onto
        // the screen. Keep downward velocity dominant so a blizzard still reads as
        // falling snow, with wind bending the fall instead of turning it into a side scroll.
        const cross=clamp(.24+strength*.085,.34,.52);
        this.snowSystem.direction1.set(nx*cross,-1.28,nz*cross);this.snowSystem.direction2.set(nx*cross*1.22,-1.02,nz*cross*1.22);
        this.snowSystem.minEmitPower=3.25+strength*.22;this.snowSystem.maxEmitPower=4.65+strength*.30;
        this.snowSystem.minLifeTime=1.15;this.snowSystem.maxLifeTime=1.85;this.snowSystem.minSize=.05;this.snowSystem.maxSize=.12;this.snowSystem.emitRate=520;
        this.snowSystem.gravity.set(0,-1.35,0);
      }else{
        const drift=.045+strength*.045;
        this.snowSystem.direction1.set(nx*drift+.018,-1.16,nz*drift);this.snowSystem.direction2.set(nx*drift-.018,-1.04,nz*drift);
        this.snowSystem.minEmitPower=1.05;this.snowSystem.maxEmitPower=1.72;this.snowSystem.minLifeTime=2.7;this.snowSystem.maxLifeTime=4.6;this.snowSystem.minSize=.065;this.snowSystem.maxSize=.15;this.snowSystem.emitRate=190;
        this.snowSystem.gravity.set(0,-.24,0);
      }
    }else this.snowSystem.emitRate=0;

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
      snowActive:settings.snowing,
      snowEmitRate:this.snowSystem.emitRate,
      snowMode:settings.blizzard?"BLIZZARD":settings.snowing?"SNOW":null,
      mistActive:this.mistSystem.emitRate>0,
      mistType:this.mistSystem.emitRate>0?settings.weather:null,
      mistEmitRate:this.mistSystem.emitRate,
      globalSceneFog:false,
      wind:{x:windX,y:windZ,strength:rawStrength,visualStrength:strength}
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
    const settings=this.weatherSettings(this.lastState),rate=settings.weather==="RAIN"?5:settings.weather==="TYPHOON"?14:settings.heavy?11:0;this.impactAccumulator+=dt*rate;
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
    this.lightningBursts.push({meshes:[bolt,branch],age:0,duration:.42,flashes:[
      {start:0,end:.055,power:2.75,alpha:1},
      {start:.095,end:.145,power:1.55,alpha:.72},
      {start:.195,end:.285,power:2.35,alpha:.94}
    ]});this.lightningFlash.intensity=Math.max(this.lightningFlash.intensity,2.75);
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
    const body=this.addMesh(root,BABYLON.MeshBuilder.CreatePolyhedron(`meteor-body-${event.sequence||0}`,{type:2,size:.72},this.scene),this.materials.meteorRock);body.metadata={castShadow:false};
    body.scaling.set(1.18,1.02,1.24);
    const tails=[];
    for(let i=0;i<4;i++){
      const tail=this.addMesh(root,BABYLON.MeshBuilder.CreateSphere(`meteor-tail-${event.sequence||0}-${i}`,{diameter:.72-i*.10,segments:7},this.scene),this.materials.meteorHot);
      tail.position.copyFrom(trailDirection.scale(.55*(i+1)));tail.scaling.set(1.18,.84,1.18);tail.visibility=.78-i*.12;tail.metadata={castShadow:false};tails.push(tail);
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
        const pulse=.92+.10*Math.sin(entry.age*26);entry.body.scaling.set(1.18*pulse,1.02*pulse,1.24*pulse);
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
    let screenFlash=0;const keep=[];
    for(const burst of this.lightningBursts){
      burst.age+=dt;const p=clamp(burst.age/burst.duration,0,1);
      let boltAlpha=(1-p)*.18;
      for(const flash of burst.flashes||[]){
        if(burst.age<flash.start||burst.age>flash.end)continue;
        const local=(burst.age-flash.start)/Math.max(.001,flash.end-flash.start),pulse=Math.sin(Math.PI*clamp(local,0,1));
        screenFlash=Math.max(screenFlash,Number(flash.power||0)*(.50+.50*pulse));
        boltAlpha=Math.max(boltAlpha,Number(flash.alpha||1)*(.58+.42*pulse));
      }
      for(const mesh of burst.meshes)mesh.alpha=clamp(boltAlpha,0,1);
      if(p>=1){for(const mesh of burst.meshes)mesh.dispose();}else keep.push(burst);
    }
    this.lightningBursts=keep;
    this.lightningFlash.intensity=screenFlash;
  }

  updateWeatherFrame(dt){
    this.updateRainImpacts(dt);this.updateLightning(dt);this.updateMeteor(dt);
    const target=this.scene.activeCamera?.getTarget?.(),cameraKey=target?`${Math.round(target.x)},${Math.round(target.z)}`:"";
    if(this.lastState&&cameraKey!==this.fireCameraKey){this.fireCameraKey=cameraKey;this.syncFireLights(this.lastState);this.syncFireGlows(this.lastState);}

    for(const light of this.fireLights)if(light.isEnabled()){const phase=Number(light.metadata?.phase||0),flicker=.90+.12*Math.sin(this.weatherTime*8.7+phase)+.035*Math.sin(this.weatherTime*17.3+phase*.6);light.intensity=Number(light.metadata?.baseIntensity||1)*flicker;light.range=Number(light.metadata?.baseRange||light.range)*( .97+.045*Math.sin(this.weatherTime*5.1+phase));}
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
      const baseRange=Math.max(1,Number(source.radius||1))*TILE_SIZE*1.28;light.range=baseRange;
      light.metadata={baseIntensity:state?.presentation?.environment?.timeOfDay==="NIGHT"?1.55:1.18,baseRange,phase:source.x*.7+source.y};
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
      const flames=[],offsets=[[-.18,.02,-.08],[.15,.03,.12],[.02,.04,-.18],[-.03,.02,.18]];
      for(let i=0;i<offsets.length;i++){
        const height=.46+(i%3)*.16,flame=this.addMesh(root,BABYLON.MeshBuilder.CreateCylinder(`burn-${key}-${i}`,{height,diameterTop:.015,diameterBottom:.24+(i%2)*.08,tessellation:6},this.scene),i===1?this.materials.meteorHot:this.materials.fire);
        flame.position.set(offsets[i][0],height*.48+offsets[i][1],offsets[i][2]);
        flame.rotation.z=(i-1.5)*.055;flame.metadata={baseY:flame.position.y,baseTilt:flame.rotation.z,scaleX:1,scaleY:1,scaleZ:1,phase:hash01(`${key}:flame:${i}`)*Math.PI*2,speed:7.2+i*.9,baseVisibility:i===1?.94:.80};flames.push(flame);
      }
      this.animated.set(key,{node:root,spin:false,fire:true,flames,phase:hash01(key)*Math.PI*2});
    }else if(type==="STEAM"){
      const cloud=this.addMesh(root,BABYLON.MeshBuilder.CreateSphere(`steam-${key}`,{diameter:.95,segments:8},this.scene),this.materials.steam);cloud.position.y=.62;cloud.scaling.set(1,.72,1);this.animated.set(key,{node:root,speed:.45});
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
    return new Set([...(tile.effects||[])].filter(type=>{
      const value=String(type);
      return !SURFACE_TYPES.has(value)&&value!=="TORNADO"&&value!=="FIRE_TORNADO"&&value!=="WHIRLPOOL"&&value!=="SMOKE";
    }));
  }

  effectDetail(tile,type){
    const wanted=String(type||"");
    return(tile?.effectDetails||[]).find(effect=>String(effect?.type||"")===wanted)||null;
  }

  groupedEffectTiles(state,types,{diagonal=false,surfaceTolerance=Infinity}={}){
    const wanted=new Set((types||[]).map(String)),tiles=(state?.map?.tiles||[]).filter(tile=>(tile.effects||[]).some(type=>wanted.has(String(type))));
    const byKey=new Map(tiles.map(tile=>[`${tile.x},${tile.y}`,tile])),seen=new Set(),groups=[];
    const dirs=diagonal?[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]:[[1,0],[-1,0],[0,1],[0,-1]];
    for(const tile of tiles){const start=`${tile.x},${tile.y}`;if(seen.has(start))continue;const group=[],queue=[tile];seen.add(start);while(queue.length){const current=queue.shift();group.push(current);for(const[dx,dy]of dirs){const k=`${Number(current.x)+dx},${Number(current.y)+dy}`,next=byKey.get(k);if(!next||seen.has(k)||Math.abs(surfaceOf(current)-surfaceOf(next))>Number(surfaceTolerance))continue;seen.add(k);queue.push(next);}}groups.push(group);}
    return groups;
  }

  smokeSignature(state){
    return(state?.map?.tiles||[]).map(tile=>{if(!(tile.effects||[]).includes("SMOKE"))return null;const detail=this.effectDetail(tile,"SMOKE"),intensity=clamp(detail?.intensity??.8,0,2.5);return`${tile.x},${tile.y}:${intensity.toFixed(2)}:${surfaceOf(tile).toFixed(2)}`;}).filter(Boolean).sort().join("|");
  }

  disposeSmokeClusters(){
    for(const entry of this.smokeClusters.values()){entry.system?.stop?.();entry.system?.dispose?.(false);this.animated.delete(entry.key);entry.root?.dispose?.();}
    this.smokeClusters.clear();
  }

  createSmokeCluster(group,index,state){
    if(!group?.length)return null;
    const xs=group.map(tile=>Number(tile.x)),ys=group.map(tile=>Number(tile.y)),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2,width=(maxX-minX+1)*TILE_SIZE,depth=(maxY-minY+1)*TILE_SIZE;
    const details=group.map(tile=>this.effectDetail(tile,"SMOKE")),avgIntensity=details.reduce((sum,detail)=>sum+clamp(detail?.intensity??.8,0,2.5),0)/Math.max(1,details.length),maxIntensity=Math.max(...details.map(detail=>clamp(detail?.intensity??.8,0,2.5)));
    const baseY=group.reduce((sum,tile)=>sum+surfaceOf(tile)*ELEVATION_HEIGHT,0)/group.length,key=`smoke-cluster-${index}-${minX},${minY}-${maxX},${maxY}`;
    const root=this.root(key);root.position.set(centerX*TILE_SIZE,baseY,centerY*TILE_SIZE);root.metadata={kind:"environment-cluster",effectType:"SMOKE",tiles:group.map(tile=>({x:tile.x,y:tile.y})),clusterSize:group.length,intensity:avgIntensity};
    const hazes=[];
    for(let i=0;i<2;i++){
      const haze=this.addMesh(root,BABYLON.MeshBuilder.CreatePlane(`${key}-haze-${i}`,{size:1},this.scene),this.smokeHazeMaterial);haze.billboardMode=BABYLON.Mesh.BILLBOARDMODE_ALL;haze.position.set((i?1:-1)*width*.10,.82+i*.34,(i?-1:1)*depth*.08);haze.scaling.set(width*(1.05+i*.17),(.72+avgIntensity*.20)*(1-i*.08),1);haze.visibility=clamp(.20+avgIntensity*.14-i*.04,.18,.58);haze.metadata={castShadow:false,baseY:haze.position.y,baseScaleX:haze.scaling.x,baseScaleY:haze.scaling.y,baseVisibility:haze.visibility,phase:hash01(`${key}:haze:${i}`)*Math.PI*2,speed:.42+i*.16};hazes.push(haze);
    }
    const system=new BABYLON.ParticleSystem(`${key}-particles`,Math.min(520,SMOKE_PARTICLE_CAPACITY+group.length*24),this.scene);system.particleTexture=this.smokeTexture;
    system.emitter=new BABYLON.Vector3(centerX*TILE_SIZE,baseY+.28,centerY*TILE_SIZE);system.minEmitBox=new BABYLON.Vector3(-width*.48,0,-depth*.48);system.maxEmitBox=new BABYLON.Vector3(width*.48,.24,depth*.48);
    const wind=state?.presentation?.environment?.wind||{},windX=Number(wind.x||0),windZ=Number(wind.y||0),rawStrength=Math.max(0,Number(wind.strength||0)),strength=globalThis.EnvironmentEngine?.windVisualStrength?.(rawStrength)??Math.min(8,rawStrength),drift=.06+strength*.085;
    system.direction1.set(windX*drift,.58,windZ*drift);system.direction2.set(windX*drift*1.55,1.08,windZ*drift*1.55);system.minEmitPower=.32+avgIntensity*.05;system.maxEmitPower=.72+maxIntensity*.08;
    system.color1=new BABYLON.Color4(.12,.13,.14,clamp(.30+avgIntensity*.10,.34,.58));system.color2=new BABYLON.Color4(.22,.23,.24,clamp(.18+avgIntensity*.08,.22,.44));system.colorDead=new BABYLON.Color4(.28,.29,.30,0);
    system.minSize=.34+avgIntensity*.06;system.maxSize=.78+maxIntensity*.18;system.minLifeTime=1.8;system.maxLifeTime=3.7;system.minAngularSpeed=-.55;system.maxAngularSpeed=.55;system.updateSpeed=.018;system.blendMode=BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    system.addSizeGradient?.(0,.55);system.addSizeGradient?.(.45,1.05);system.addSizeGradient?.(1,1.55);
    const baseEmitRate=Math.min(170,24+group.length*11+avgIntensity*20);system.emitRate=baseEmitRate;system.start();
    const animated={node:root,spin:false,smokeCluster:true,hazes,phase:hash01(key)*Math.PI*2,startedAt:this.weatherTime};this.animated.set(key,animated);
    return{key,root,system,baseEmitRate,animated,tiles:group.map(tile=>({x:tile.x,y:tile.y}))};
  }

  syncSmokeClusters(state){
    const signature=this.smokeSignature(state);
    if(signature!==this.smokeClusterSignature){this.disposeSmokeClusters();this.groupedEffectTiles(state,["SMOKE"],{diagonal:true}).forEach((group,index)=>{const entry=this.createSmokeCluster(group,index,state);if(entry)this.smokeClusters.set(entry.key,entry);});this.smokeClusterSignature=signature;}
    const tiles=state?.map?.tiles||[],byKey=new Map(tiles.map(tile=>[`${tile.x},${tile.y}`,tile])),globalMaskActive=tiles.some(tile=>tile?.fogged);
    const touchesVisibleBoundary=point=>{
      const tile=byKey.get(`${point.x},${point.y}`);
      if(tile&&!tile.fogged)return true;
      for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
        const neighbor=byKey.get(`${Number(point.x)+dx},${Number(point.y)+dy}`);
        if(neighbor&&!neighbor.fogged)return true;
      }
      return false;
    };
    for(const entry of this.smokeClusters.values()){
      // Local SMOKE is the occluder itself: it must remain visible even though it
      // blocks LOS. Only a true global FOV mask may hide smoke that is completely
      // buried inside unexplored/fogged territory; boundary smoke stays visible.
      const visible=!globalMaskActive||(entry.tiles||[]).some(touchesVisibleBoundary);
      entry.root?.setEnabled?.(visible);
      if(entry.system)entry.system.emitRate=visible?Number(entry.baseEmitRate||0):0;
    }
  }

  fireFieldSignatureOf(state){
    return(state?.map?.tiles||[]).filter(tile=>(tile.effects||[]).includes("BURNING")).map(tile=>`${tile.x},${tile.y}:${surfaceOf(tile).toFixed(2)}`).sort().join("|");
  }

  disposeFireFields(){for(const entry of this.fireFields.values()){this.animated.delete(entry.key);entry.root?.dispose?.();}this.fireFields.clear();}

  createFireField(group,index){
    if(!group?.length)return null;const xs=group.map(tile=>Number(tile.x)),ys=group.map(tile=>Number(tile.y)),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
    const padding=TILE_SIZE*.82,width=(maxX-minX+1)*TILE_SIZE+padding*2,depth=(maxY-minY+1)*TILE_SIZE+padding*2,baseY=group.reduce((sum,tile)=>sum+surfaceOf(tile)*ELEVATION_HEIGHT,0)/group.length,key=`fire-field-${index}-${minX},${minY}-${maxX},${maxY}`;
    const root=this.root(key);root.position.set(centerX*TILE_SIZE,baseY+.018,centerY*TILE_SIZE);root.metadata={kind:"environment-cluster",effectType:"FIRE_RADIANCE",tiles:group.map(tile=>({x:tile.x,y:tile.y})),clusterSize:group.length};const fields=[];
    for(let i=0;i<2;i++){const field=this.addMesh(root,BABYLON.MeshBuilder.CreateDisc(`${key}-radiance-${i}`,{radius:.5,tessellation:36},this.scene),this.fireFieldMaterial);field.rotation.x=Math.PI/2;field.position.y=.008+i*.008;field.scaling.set(width*(i?1.16:1),depth*(i?1.16:1),1);field.visibility=i?.12:.22;field.metadata={castShadow:false,baseScaleX:field.scaling.x,baseScaleY:field.scaling.y,baseVisibility:field.visibility,phase:hash01(`${key}:${i}`)*Math.PI*2};fields.push(field);}
    const animated={node:root,spin:false,fireField:true,fields,phase:hash01(key)*Math.PI*2,speed:3.3};this.animated.set(key,animated);return{key,root,animated,tiles:group.map(tile=>({x:tile.x,y:tile.y}))};
  }

  syncFireFields(state){
    const signature=this.fireFieldSignatureOf(state);if(signature!==this.fireFieldSignature){this.disposeFireFields();this.groupedEffectTiles(state,["BURNING"],{diagonal:true,surfaceTolerance:.30}).forEach((group,index)=>{const entry=this.createFireField(group,index);if(entry)this.fireFields.set(entry.key,entry);});this.fireFieldSignature=signature;}
    const byKey=new Map((state?.map?.tiles||[]).map(tile=>[`${tile.x},${tile.y}`,tile]));for(const entry of this.fireFields.values()){const visible=(entry.tiles||[]).some(point=>!byKey.get(`${point.x},${point.y}`)?.fogged);entry.root?.setEnabled?.(visible);}
  }

  tornadoTypeAt(tile){
    const effects=new Set((tile?.effects||[]).map(String));
    if(effects.has("FIRE_TORNADO"))return"FIRE_TORNADO";
    if(effects.has("TORNADO"))return"TORNADO";
    return null;
  }

  tornadoDetailAt(tile){
    const type=this.tornadoTypeAt(tile);if(!type)return null;
    return this.effectDetail(tile,type)||null;
  }

  tornadoElementAt(tile){
    const type=this.tornadoTypeAt(tile),detail=this.tornadoDetailAt(tile);
    if(type==="FIRE_TORNADO")return"FIRE";
    const element=String(detail?.element||"AIR").toUpperCase();
    return element==="WATER"?"WATER":element==="FIRE"?"FIRE":"AIR";
  }

  tornadoSignature(state){
    return(state?.map?.tiles||[]).map(tile=>{
      const type=this.tornadoTypeAt(tile);if(!type)return null;const detail=this.tornadoDetailAt(tile);
      return`${tile.x},${tile.y}:${type}:${this.tornadoElementAt(tile)}:${Number(detail?.clusterSize||1)}:${Number(detail?.clusterStrength||1).toFixed(2)}:${Number(detail?.windStrength||7.5).toFixed(2)}:${Number(detail?.carriedLogs||0)}:${surfaceOf(tile).toFixed(3)}`;
    }).filter(Boolean).sort().join("|");
  }

  disposeTornadoClusters(){
    for(const [key,entry] of this.tornadoClusters){
      this.animated.delete(key);
      entry.light?.dispose?.();
      entry.root?.dispose?.();
    }
    this.tornadoClusters.clear();
  }

  tornadoGroups(state){
    const tiles=(state?.map?.tiles||[]).filter(tile=>this.tornadoTypeAt(tile));
    const byKey=new Map(tiles.map(tile=>[`${tile.x},${tile.y}`,tile])),seen=new Set(),groups=[];
    for(const tile of tiles){
      const start=`${tile.x},${tile.y}`;if(seen.has(start))continue;
      const queue=[tile],group=[];seen.add(start);
      while(queue.length){
        const current=queue.shift();group.push(current);
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const key=`${Number(current.x)+dx},${Number(current.y)+dy}`,next=byKey.get(key);
          if(!next||seen.has(key))continue;seen.add(key);queue.push(next);
        }
      }
      groups.push(group);
    }
    return groups;
  }

  createTornadoCluster(group,index,{startPosition=null}={}){
    if(!group?.length)return null;
    const fire=group.some(tile=>this.tornadoTypeAt(tile)==="FIRE_TORNADO"||this.tornadoElementAt(tile)==="FIRE"),water=!fire&&group.some(tile=>this.tornadoElementAt(tile)==="WATER"),type=fire?"FIRE_TORNADO":"TORNADO",element=fire?"FIRE":water?"WATER":"AIR";
    const xs=group.map(tile=>Number(tile.x)),ys=group.map(tile=>Number(tile.y));
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
    const width=(maxX-minX+1)*TILE_SIZE,depth=(maxY-minY+1)*TILE_SIZE;
    const span=Math.max(TILE_SIZE,Math.max(width,depth)),details=group.map(tile=>this.tornadoDetailAt(tile)).filter(Boolean),runtimeSize=Math.max(group.length,...details.map(detail=>Math.max(1,Number(detail?.clusterSize||1)))),strength=Math.max(1,...details.map(detail=>Number(detail?.clusterStrength||1))),windStrength=Math.max(7.5,...details.map(detail=>Number(detail?.windStrength||7.5))),carriedLogs=Math.max(0,...details.map(detail=>Number(detail?.carriedLogs||0)));
    const radius=Math.max(.55,span*.48)*(1+Math.min(.28,(strength-1)*.12));
    const height=2.25+Math.min(1.90,Math.sqrt(runtimeSize)*.48)+Math.min(.65,(strength-1)*.20);
    const baseY=group.reduce((sum,tile)=>sum+surfaceOf(tile)*ELEVATION_HEIGHT,0)/group.length;
    const key=`tornado-cluster-${index}-${minX},${minY}-${maxX},${maxY}`,root=this.root(key),targetPosition=new BABYLON.Vector3(centerX*TILE_SIZE,baseY,centerY*TILE_SIZE);
    root.position.copyFrom(startPosition||targetPosition);
    const outer=fire?this.materials.fireWind:water?this.materials.waterWind:this.materials.wind,rings=[],ringSpeeds=[],orbiters=[];
    const ground=this.addMesh(root,BABYLON.MeshBuilder.CreateTorus(`${key}-range`,{diameter:Math.max(.9,span*1.02),thickness:.045,tessellation:36},this.scene),outer);
    ground.position.y=.045;ground.scaling.x=Math.max(.62,width/Math.max(.001,span));ground.scaling.z=Math.max(.62,depth/Math.max(.001,span));ground.visibility=fire?.68:water?.58:.46;
    const core=this.addMesh(root,BABYLON.MeshBuilder.CreateCylinder(`${key}-core`,{height,diameterTop:radius*1.72,diameterBottom:Math.max(.18,radius*.20),tessellation:18},this.scene),outer);
    core.position.y=height*.50;core.scaling.z=.80;core.visibility=fire?.52:water?.48:.40;
    for(let i=0;i<6;i++){
      const t=i/5,diameter=Math.max(.46,radius*(.58+t*1.26));
      const ring=this.addMesh(root,BABYLON.MeshBuilder.CreateTorus(`${key}-ring-${i}`,{diameter,thickness:.035+.012*t,tessellation:28},this.scene),outer);
      ring.position.y=.20+t*height*.88;ring.scaling.z=.58+.22*t;ring.rotation.z=(i%2?1:-1)*(.045+.018*t);ring.visibility=fire?.86:water?.84:.78;
      rings.push(ring);ringSpeeds.push((fire?5.8:water?5.15:4.4)*(1.20-t*.42)+(i%2)*.55);
    }
    const orbMat=fire?this.materials.meteorHot:water?this.materials.waterWind:this.materials.fragments;
    const orbCount=Math.min(16,6+runtimeSize*2);
    for(let i=0;i<orbCount;i++){
      const orb=this.addMesh(root,BABYLON.MeshBuilder.CreatePolyhedron(`${key}-orb-${i}`,{type:2,size:fire?.055:water?.050:.045},this.scene),orbMat);
      const tier=i%5,phase=hash01(`${key}:${i}`)*Math.PI*2;
      orb.metadata={phase,speed:(fire?2.7:water?2.45:2.0)+tier*.18,radius:radius*(.34+.12*tier),baseY:.28+(tier/4)*height*.78,bob:.08+.025*(i%3)};
      orbiters.push(orb);
    }
    const logCount=Math.min(6,Math.round(carriedLogs));
    for(let i=0;i<logCount;i++){
      const log=this.addMesh(root,BABYLON.MeshBuilder.CreateCylinder(`${key}-log-${i}`,{height:1.02+Math.min(.30,i*.055),diameter:.16,tessellation:9},this.scene),this.materials.woodDebris);
      const tier=i%5,phase=hash01(`${key}:log:${i}`)*Math.PI*2;log.rotation.z=Math.PI/2;log.rotation.x=(hash01(`${key}:log-tilt:${i}`)-.5)*.65;
      log.metadata={phase,speed:2.05+tier*.18,radius:radius*(.43+.11*tier),baseY:.48+(tier/4)*height*.72,bob:.14+.035*(i%3),tornadoLog:true};orbiters.push(log);
    }
    let light=null;
    if(fire){
      light=new BABYLON.PointLight(`${key}-light`,new BABYLON.Vector3(0,height*.52,0),this.scene);light.parent=root;light.diffuse=new BABYLON.Color3(1,.26,.035);light.specular=new BABYLON.Color3(.24,.05,.01);light.range=Math.max(2.8,span*1.6);light.intensity=1.15;
      for(let i=0;i<3;i++){const flame=this.addMesh(root,BABYLON.MeshBuilder.CreateTorus(`${key}-fire-${i}`,{diameter:radius*(.68+i*.38),thickness:.055,tessellation:24},this.scene),this.materials.fire);flame.position.y=.55+i*height*.22;flame.scaling.z=.62;flame.visibility=.82;rings.push(flame);ringSpeeds.push(7.4+i*.7);}
    }else if(water){
      for(let i=0;i<3;i++){const spray=this.addMesh(root,BABYLON.MeshBuilder.CreateTorus(`${key}-water-${i}`,{diameter:radius*(.64+i*.34),thickness:.045,tessellation:24},this.scene),this.materials.waterWind);spray.position.y=.46+i*height*.24;spray.scaling.z=.66;spray.visibility=.78;rings.push(spray);ringSpeeds.push(6.2+i*.55);}
    }
    const visible=group.some(tile=>!tile.fogged);root.setEnabled(visible);
    root.metadata={kind:"environment-cluster",effectType:type,tornadoElement:element,tiles:group.map(tile=>({x:tile.x,y:tile.y})),clusterSize:runtimeSize,clusterStrength:strength,windStrength,carriedLogs,visualRadius:radius,height};
    const animated={node:root,spin:false,tornadoCluster:true,rings,ringSpeeds,orbiters,phase:hash01(key)*Math.PI*2,moveTarget:startPosition&&BABYLON.Vector3.DistanceSquared(startPosition,targetPosition)>.0004?targetPosition:null};
    this.animated.set(key,animated);
    return{key,root,light,animated,type,element};
  }

  syncTornadoClusters(state){
    const signature=this.tornadoSignature(state);
    if(signature!==this.tornadoClusterSignature){
      const previous=[...this.tornadoClusters.values()].map(entry=>({position:entry.root?.position?.clone?.()||null})).filter(entry=>entry.position),used=new Set();
      const groups=this.tornadoGroups(state),starts=groups.map(group=>{
        const xs=group.map(tile=>Number(tile.x)),ys=group.map(tile=>Number(tile.y)),centerX=(Math.min(...xs)+Math.max(...xs))/2,centerY=(Math.min(...ys)+Math.max(...ys))/2,baseY=group.reduce((sum,tile)=>sum+surfaceOf(tile)*ELEVATION_HEIGHT,0)/group.length,target=new BABYLON.Vector3(centerX*TILE_SIZE,baseY,centerY*TILE_SIZE);
        let best=-1,bestDistance=Infinity;for(let i=0;i<previous.length;i++){if(used.has(i))continue;const distance=BABYLON.Vector3.DistanceSquared(previous[i].position,target);if(distance<bestDistance){best=i;bestDistance=distance;}}
        if(best>=0){used.add(best);return previous[best].position;}return null;
      });
      this.disposeTornadoClusters();
      groups.forEach((group,index)=>{const entry=this.createTornadoCluster(group,index,{startPosition:starts[index]});if(entry)this.tornadoClusters.set(entry.key,entry);});
      this.tornadoClusterSignature=signature;
    }
    const byKey=new Map((state?.map?.tiles||[]).map(tile=>[`${tile.x},${tile.y}`,tile]));
    for(const entry of this.tornadoClusters.values()){
      const visible=(entry.root?.metadata?.tiles||[]).some(point=>!byKey.get(`${point.x},${point.y}`)?.fogged);
      entry.root?.setEnabled?.(visible);
      entry.light?.setEnabled?.(visible);
    }
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
    if(type==="SNOW")return clamp(amount/.90,0,1);
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
    this.syncTornadoClusters(state);
    this.syncSmokeClusters(state);
    this.syncFireFields(state);
    this.syncFriendlyVisibility(state);
    this.syncFireLights(state);
    this.syncFireGlows(state);
    const visibleLights=new Set((state?.presentation?.environment?.lightSources||[]).filter(light=>light.visible).map(light=>`${light.x},${light.y}:${light.source}`));
    const friendlyUnits=(state?.units||[]).filter(unit=>unit?.friendlyToViewer),friendlyDistance=(tile)=>friendlyUnits.reduce((best,unit)=>Math.min(best,Math.abs(Number(unit.x)-Number(tile.x))+Math.abs(Number(unit.y)-Number(tile.y))),Infinity);
    const alive=new Set();
    for(const tile of state?.map?.tiles||[]){
      const surface=surfaceOf(tile)*ELEVATION_HEIGHT;
      for(const type of this.desiredNodeTypes(tile)){
        const key=keyOf(tile,type);alive.add(key);let node=this.nodes.get(key);
        if(!node){node=this.create(type,key,tile);if(!node)continue;this.nodes.set(key,node);}
        node.position.set(tile.x*TILE_SIZE,surface,tile.y*TILE_SIZE);
        let visible=tile.fogged?(visibleLights.has(key)?.70:0):1;
        const friendlyRange=friendlyDistance(tile);
        if(type==="STEAM"&&friendlyRange===0)visible=Math.min(visible,.38);
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
      smokePresentation:{clusters:this.smokeClusters.size,risingParticles:true,mergedHaze:true,visionOwner:"EnvironmentEngine.visionModifier"},
      firePresentation:{radianceFields:this.fireFields.size,flickeringFlames:true,adjacentHeatGlow:true},
      snowPresentation:{screenFallDominant:true,windDeflection:true,blizzardDiagonalFall:true},
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
