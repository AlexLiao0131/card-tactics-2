import { TILE_SIZE,ELEVATION_HEIGHT,SURFACE_RENDER_ORDER } from "./coordinate-system.js";
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
// Render-pass ownership stays with the ONE published snow / ice / LOS mesh.
// Discard triangles whose interpolated coverage is identically zero; they
// contribute no colour, depth or visibility. Only entirely covered snow
// triangles qualify for opaque rendering. Partial snow remains alpha-blended.
function coverageClasses(colors,{opaque=false}={}){
  const classes=new Uint8Array(colors.length/4);
  for(let i=0;i<classes.length;i++){
    const alpha=colors[i*4+3];
    classes[i]=alpha<=0?0:opaque&&alpha>=1?2:1;
  }
  return classes;
}
function sameCoverageClasses(before,after){
  if(!before||before.length!==after.length)return false;
  for(let i=0;i<after.length;i++)if(before[i]!==after[i])return false;
  return true;
}
function surfaceCoverageIndices(indices,colors,{opaque=false}={}){
  const solid=[],blended=[];
  for(let i=0;i<indices.length;i+=3){
    const a=colors[indices[i]*4+3],b=colors[indices[i+1]*4+3],c=colors[indices[i+2]*4+3];
    if(a<=0&&b<=0&&c<=0)continue;
    const target=opaque&&a>=1&&b>=1&&c>=1?solid:blended;
    target.push(indices[i],indices[i+1],indices[i+2]);
  }
  return{indices:solid.concat(blended),solidCount:solid.length,blendedCount:blended.length,
    skippedTriangles:(indices.length-solid.length-blended.length)/3};
}
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
const WEATHER_MIST_PROFILE_NIGHT=Object.freeze({
  FOG:Object.freeze({...WEATHER_MIST_PROFILE.FOG,color1:Object.freeze([.16,.19,.22,.15]),color2:Object.freeze([.10,.13,.16,.075])}),
  BLIZZARD:Object.freeze({...WEATHER_MIST_PROFILE.BLIZZARD,color1:Object.freeze([.22,.27,.32,.13]),color2:Object.freeze([.15,.20,.25,.060])}),
  HEAVY_RAIN:Object.freeze({...WEATHER_MIST_PROFILE.HEAVY_RAIN,color1:Object.freeze([.10,.14,.18,.085]),color2:Object.freeze([.07,.10,.14,.040])}),
  THUNDERSTORM:Object.freeze({...WEATHER_MIST_PROFILE.THUNDERSTORM,color1:Object.freeze([.08,.12,.17,.095]),color2:Object.freeze([.055,.09,.13,.045])}),
  TYPHOON:Object.freeze({...WEATHER_MIST_PROFILE.TYPHOON,color1:Object.freeze([.07,.12,.14,.11]),color2:Object.freeze([.045,.08,.10,.055])})
});
const SCENE_FOG_PROFILE=Object.freeze({
  DAY:Object.freeze({
    FOG:Object.freeze({density:.009,color:Object.freeze([.53,.59,.62])}),
    BLIZZARD:Object.freeze({density:.008,color:Object.freeze([.42,.49,.55])}),
    RAIN:Object.freeze({density:.0018,color:Object.freeze([.30,.39,.45])}),
    HEAVY_RAIN:Object.freeze({density:.0042,color:Object.freeze([.21,.29,.35])}),
    THUNDERSTORM:Object.freeze({density:.0052,color:Object.freeze([.14,.21,.29])}),
    TYPHOON:Object.freeze({density:.0062,color:Object.freeze([.13,.21,.25])})
  }),
  NIGHT:Object.freeze({
    FOG:Object.freeze({density:.009,color:Object.freeze([.070,.088,.110])}),
    BLIZZARD:Object.freeze({density:.008,color:Object.freeze([.080,.095,.110])}),
    RAIN:Object.freeze({density:.0018,color:Object.freeze([.040,.058,.078])}),
    HEAVY_RAIN:Object.freeze({density:.0042,color:Object.freeze([.027,.040,.058])}),
    THUNDERSTORM:Object.freeze({density:.0052,color:Object.freeze([.020,.032,.050])}),
    TYPHOON:Object.freeze({density:.0062,color:Object.freeze([.020,.036,.046])})
  })
});
// Per-cell optical obscuration is composed from the existing tactical sight
// field. All climate profiles share the same mesh, LOS mask and blend logic.
// Outside the observers' sight the haze carries the strong weather veil;
// inside sight it remains a thin atmospheric layer, not an opaque wall.
const VISIBILITY_HAZE_PROFILE=Object.freeze({
  DAY:Object.freeze({
    FOG:Object.freeze({color:Object.freeze([.53,.59,.62]),alpha:.64,edgeFactor:.24,height:.42}),
    BLIZZARD:Object.freeze({color:Object.freeze([.58,.64,.69]),alpha:.62,edgeFactor:.28,height:.48})
  }),
  NIGHT:Object.freeze({
    FOG:Object.freeze({color:Object.freeze([.10,.13,.16]),alpha:.65,edgeFactor:.24,height:.42}),
    BLIZZARD:Object.freeze({color:Object.freeze([.14,.17,.20]),alpha:.63,edgeFactor:.28,height:.48}),
    // The darkness field must contrast with the existing low-light scene.
    // Within TacticalEngine LOS it fades out, without illuminating enemies.
    DARKNESS:Object.freeze({color:Object.freeze([.035,.045,.065]),alpha:.86,edgeFactor:.26,height:.44})
  })
});

function hash01(value){
  const text=String(value||"");let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return(h>>>0)/4294967295;
}


// Light colours are serialized from equipment as CSS hex and from effects as
// RGB triplets. Normalize both through the same rendering path; the equipment
// data remains the sole authority for tint, range, and strength.
function lightColor(color,fallback=[1,.5,.25]){
  if(Array.isArray(color)&&color.length>=3){
    const rgb=color.slice(0,3).map(value=>Number(value));
    if(rgb.every(Number.isFinite))return rgb.map(value=>clamp(value,0,1));
  }
  if(typeof color==="string"){
    const hex=color.trim().replace(/^#/,"");
    if(/^[0-9a-f]{3}$/i.test(hex))return[0,1,2].map(i=>parseInt(hex[i]+hex[i],16)/255);
    if(/^[0-9a-f]{6}$/i.test(hex))return[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  }
  return fallback;
}

export class EnvironmentRenderer{
  constructor(scene,surfaceResolver=null){
    this.scene=scene;
    this.surfaceResolver=surfaceResolver||new VisualSurfaceResolver();
    this.nodes=new Map();
    this.animated=new Map();
    this.surfaceMeshes=new Map();
    this.surfaceSignature="";
    this.surfaceLayerMetrics={rebuilds:0,vertexUpdates:0};
    this.surfaceLayerTypeSignatures=new Map();
    this.surfacePatchStencil=null;
    this.visibilityHazeMetrics={meshBuilds:0,geometryUpdates:0};
    this.visibilityHazeTopologySignature="";
    this.visibilityHazeMesh=null;
    this.visibilityHazeSignature="";
    this.visibilityHazeSightSignature="";
    this.visibilityHazeSamples=[];
    this.lastState=null;
    this.weatherTime=0;
    this.impactAccumulator=0;
    this.lightningBursts=[];
    this.lastLightningToken="";
    // Physical structure lights are stable. Unlimited flame/character cells use
    // one aggregated colour field instead of one GPU PointLight per map tile.
    this.fireLights=[];
    this.physicalLightsById=new Map();
    this.lightFieldMesh=null;
    this.lightFieldMaterial=this.makeLightFieldMaterial();
    this.lightFieldSignature="";
    this.lightFieldTerrain=null;
    this.lightFieldCells=0;
    this.fireGlows=new Map();
    this.structureGlowMaterials=new Map();
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
      lightningBolt:this.mat("weather-lightning-bolt",new BABYLON.Color3(.88,.95,1),1,new BABYLON.Color3(.94,.98,1)),
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
    // Fully covered snow writes depth normally. Only its fractional boundary
    // retains the original translucent blend; both use the SAME snow vertices.
    this.solidSnowMaterial=this.materials.snow.clone("env-snow-solid");
    this.solidSnowMaterial.alpha=1;
    this.solidSnowMaterial.transparencyMode=BABYLON.Material.MATERIAL_OPAQUE;
    this.snowPassMaterial=new BABYLON.MultiMaterial("env-snow-coverage-passes",this.scene);
    this.snowPassMaterial.subMaterials=[this.solidSnowMaterial,this.materials.snow];
    this.surfaceLayerMetrics.opaqueSnowTriangles=0;
    this.surfaceLayerMetrics.blendedSnowTriangles=0;
    this.surfaceLayerMetrics.transparentTrianglesSkipped=0;
    // Ice is composited after its EXACT supporting water triangles; sharing
    // world XYZ must not compete for writing the same depth buffer.
    this.materials.ice.disableDepthWrite=true;
    this.materials.lightningBolt.disableLighting=true;
    this.materials.lightningBolt.fogEnabled=false;
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
    this.rainImpactTiles=[];
    this.lightningFlash=new BABYLON.HemisphericLight("weather-lightning-flash",new BABYLON.Vector3(0,1,0),this.scene);
    this.lightningFlash.diffuse=new BABYLON.Color3(.72,.88,1);
    this.lightningFlash.groundColor=new BABYLON.Color3(.30,.38,.52);
    // Keep the lightning light registered in Babylon; a zero intensity is
    // visually identical to off, without changing shader light defines.
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
            const age=Math.max(0,this.weatherTime-Number(entry.startedAt||0)),gather=.32+.68*clamp((age-.18)/1.35,0,1);
            // Physical smoke stays present: LOS can make a nearby pocket legible,
            // but cannot erase a dense, vision-blocking plume.
            const clarity=clamp(Number(entry.opticalClarity||0),0,1);
            haze.visibility=clamp(Number(meta.baseVisibility||.35)*gather*(1+wave*.08)*(1-clarity*.50),0,.78);
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
    const environment=state?.presentation?.environment||{},weather=String(environment.weather||"CLEAR").toUpperCase(),wind=environment.wind||{},timeOfDay=environment.timeOfDay==="NIGHT"?"NIGHT":"DAY";
    const raining=weather==="RAIN"||weather==="HEAVY_RAIN"||weather==="THUNDERSTORM"||weather==="TYPHOON";
    const snowing=weather==="SNOW"||weather==="BLIZZARD";
    const mistTable=timeOfDay==="NIGHT"?WEATHER_MIST_PROFILE_NIGHT:WEATHER_MIST_PROFILE;
    return{
      weather,timeOfDay,wind,raining,snowing,blizzard:weather==="BLIZZARD",
      heavy:weather==="HEAVY_RAIN"||weather==="THUNDERSTORM"||weather==="TYPHOON",
      thunder:weather==="THUNDERSTORM"||weather==="TYPHOON",
      mist:mistTable[weather]||NO_MIST
    };
  }

  syncWeatherParticles(state){
    const settings=this.weatherSettings(state),tiles=state?.map?.tiles||[],width=Math.max(1,Number(state?.map?.width||1)),height=Math.max(1,Number(state?.map?.height||1));
    const centerX=(width-1)*TILE_SIZE*.5,centerZ=(height-1)*TILE_SIZE*.5;
    // Read-only presentation cache: the original tiles stay the only source of
    // terrain, fog and hydrology. Recompute when a new snapshot is published.
    this.rainImpactTiles=[];
    let maxSurface=tiles.length?-Infinity:0;
    for(const tile of tiles){
      if(!tile.fogged)this.rainImpactTiles.push(tile);
      maxSurface=Math.max(maxSurface,surfaceOf(tile)*ELEVATION_HEIGHT);
    }
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
      atmosphereTimeOfDay:settings.timeOfDay,
      mistTone:settings.timeOfDay==="NIGHT"?"NIGHT_SKY_MATCHED":"DAY_SKY_MATCHED",
      globalSceneFog:false,
      wind:{x:windX,y:windZ,strength:rawStrength,visualStrength:strength}
    };
  }

  spawnRainImpact(){
    const state=this.lastState,settings=this.weatherSettings(state);if(!settings.raining)return;
    const tiles=this.rainImpactTiles;if(!tiles?.length)return;
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
    // Camera-independent bolt width; LinesMesh alone can be subpixel on iPhone.
    const body=BABYLON.MeshBuilder.CreateTube(`weather-lightning-body-${event.sequence||0}`,{path:points,radius:.055,tessellation:6,cap:BABYLON.Mesh.CAP_ALL},this.scene);
    body.material=this.materials.lightningBolt;body.isPickable=false;body.visibility=.98;
    const branchPoints=[points[6],new BABYLON.Vector3(points[6].x+.34,targetY+1.65,points[6].z-.22),new BABYLON.Vector3(points[6].x+.55,targetY+1.18,points[6].z-.33)];const branch=BABYLON.MeshBuilder.CreateLines(`weather-lightning-branch-${state?.revision||0}-${x}-${y}`,{points:branchPoints},this.scene);branch.color=new BABYLON.Color3(.58,.82,1);branch.alpha=.72;branch.isPickable=false;
    this.lightningBursts.push({meshes:[bolt,branch,body],age:0,duration:.62,flashes:[
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
      if(event?.type==="LIGHTNING_STRIKE"){const token=String(event.sequence??`${state?.revision||0}:${event.x}:${event.y}:${event.unitId||event.unit?.id||""}`);if(token===this.lastLightningToken)continue;this.lastLightningToken=token;this.createLightningBurst(event,state);continue;}
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
      for(const mesh of burst.meshes){mesh.alpha=clamp(boltAlpha,0,1);mesh.visibility=clamp(boltAlpha,0,1);}
      if(p>=1){for(const mesh of burst.meshes)mesh.dispose();}else keep.push(burst);
    }
    this.lightningBursts=keep;
    this.lightningFlash.intensity=screenFlash;
  }

  updateWeatherFrame(dt){
    this.updateRainImpacts(dt);this.updateLightning(dt);this.updateMeteor(dt);
    const target=this.scene.activeCamera?.getTarget?.(),cameraKey=target?`${Math.round(target.x)},${Math.round(target.z)}`:"";
    // The camera only changes atmospheric glow sorting. Fixed lights and
    // actual lit cells must never blink when the camera moves.
    if(this.lastState&&cameraKey!==this.fireCameraKey){this.fireCameraKey=cameraKey;this.syncFireGlows(this.lastState);}

    for(const light of this.fireLights)if(light.isEnabled()){const phase=Number(light.metadata?.phase||0),flicker=light.metadata?.steady?1:.90+.12*Math.sin(this.weatherTime*8.7+phase)+.035*Math.sin(this.weatherTime*17.3+phase*.6);light.intensity=Number(light.metadata?.baseIntensity||1)*flicker;light.range=Number(light.metadata?.baseRange||light.range)*(light.metadata?.steady?1:.97+.045*Math.sin(this.weatherTime*5.1+phase));}
  }

  // Persistent sites and equipped light-emitting items use the same physical
  // lighting pipeline. Fire groups share a light per connected cluster, while
  // every burning cell independently tints its exact 3x3 ground footprint.
  // No camera-distance ranking, four-light pool, or character-specific branch.
  syncFireLights(state){
    const lights=state?.presentation?.environment?.lightSources||[];
    const structures=lights.filter(source=>source.source==="CORE_LIGHT"||source.source==="CAPTURE_LIGHT");
    // EquipmentDatabase already supplies radius, colour and intensity via the
    // battle snapshot. Keep an equipped item's light attached to its unit and
    // steady across frames, rather than discarding it with the unit-tile glow.
    const equipment=lights.filter(source=>source.source==="EQUIPMENT_LIGHT"&&source.visible!==false&&Number(source.radius||0)>0)
      .map(source=>({...source,steady:true}));
    const fires=this.groupedEffectTiles(state,["BURNING","FIRE_TORNADO"],{diagonal:true,surfaceTolerance:.30})
      .map((group,index)=>{
        const x=group.reduce((sum,tile)=>sum+Number(tile.x),0)/group.length;
        const y=group.reduce((sum,tile)=>sum+Number(tile.y),0)/group.length;
        const radius=Math.max(1.5,...group.map(tile=>Math.hypot(tile.x-x,tile.y-y)+1.35));
        const vertical=group.reduce((sum,tile)=>sum+surfaceOf(tile)*ELEVATION_HEIGHT,0)/group.length;
        return {x,y,radius,source:"FIRE_CLUSTER",sourceId:index,intensity:Math.min(1.4,.72+group.length*.09),
          color:[1,.39,.10],vertical,steady:false};
      });
    const sources=[...structures,...equipment,...fires];
    const byKey=new Map((state?.map?.tiles||[]).map(tile=>[`${tile.x},${tile.y}`,tile]));
    const active=new Set();
    for(const source of sources){
      const identity=`${source.source}:${source.unitId?`${source.unitId}:`:""}${source.sourceId??`${source.x},${source.y}`}`;
      active.add(identity);
      let light=this.physicalLightsById.get(identity);
      if(!light){
        light=new BABYLON.PointLight(`environment-light-${identity}`,BABYLON.Vector3.Zero(),this.scene);
        this.physicalLightsById.set(identity,light);
      }
      const tile=byKey.get(`${source.x},${source.y}`),tint=lightColor(source.color);
      light.diffuse.set(Number(tint[0]),Number(tint[1]),Number(tint[2]));
      light.specular.set(Number(tint[0])*.14,Number(tint[1])*.14,Number(tint[2])*.14);
      light.position.set(source.x*TILE_SIZE,Number(source.vertical??(surfaceOf(tile||{})*ELEVATION_HEIGHT))+1.1,source.y*TILE_SIZE);
      const baseRange=Math.max(1,Number(source.radius||1))*TILE_SIZE*1.28;
      light.range=baseRange;
      light.metadata={source:source.source,sourceId:source.sourceId,
        baseIntensity:(state?.presentation?.environment?.timeOfDay==="NIGHT"?1.55:1.18)*Math.max(0,Number(source.intensity??1)),
        baseRange,phase:source.x*.7+source.y,steady:source.steady===true};
      light.intensity=light.metadata.baseIntensity;
      // Activation is decided after the spatial receivers have been resolved.
      // Babylon treats includedOnlyMeshes=[] as UNRESTRICTED, not as "none".
    }
    for(const [identity,light] of this.physicalLightsById){
      if(active.has(identity))continue;
      light.setEnabled(false);
      light.dispose();
      this.physicalLightsById.delete(identity);
    }
    this.fireLights=[...this.physicalLightsById.values()];
    this.syncSpatialLightMembership();

  }

  // Spatial ownership resolves Babylon's per-mesh light budget without
  // arbitrarily discarding entire capture sites when new lights are added.
  // This is presentation-only: terrain tint is the existing per-cell light field.
  // One lighting authority for all 3D receivers, including vertical rock.
  // Keep each material's authored shader capacity; a wildfire may create more
  // sources, but can never increase shader uniform/UBO declarations.
  syncSpatialLightMembership(){
    const lights=this.fireLights;
    const localSet=new Set(lights);
    // The scene-wide directional/hemi/lightning sources share Babylon's same
    // maxSimultaneousLights slots. Count the actual lights, never an assumed
    // device limit or a fire-count-derived Shader capacity.
    const sharedLights=this.scene.lights.filter(light=>!localSet.has(light)&&
      !light.isDisposed?.()&&light.isEnabled?.()!==false);
    const memberships=new Map(lights.map(light=>[light,[]]));
    // These bindings are selected by the ONE physical-light authority and
    // are consumed by MapObjectRenderer when grouping static source faces.
    const staticSourceLightBindings=new Map();
    const records={cliffSourcesAvailable:0,cliffSourcesAssigned:0,
      receivers:0,limitedReceivers:0,sharedLightSlots:sharedLights.length};
    const footprintHits=(footprint,mesh)=>{
      if(!footprint)return true;
      const bb=mesh.getBoundingInfo?.()?.boundingBox;
      const a=bb?.minimumWorld,b=bb?.maximumWorld;
      if(!a||!b)return false;
      const x0=Math.ceil(a.x/TILE_SIZE-.5),x1=Math.floor(b.x/TILE_SIZE+.5);
      const y0=Math.ceil(a.z/TILE_SIZE-.5),y1=Math.floor(b.z/TILE_SIZE+.5);
      for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)
        if(footprint.has(`${x},${y}`))return true;
      return false;
    };
    const impact=(mesh,light,center,radius)=>{
      const footprint=light.metadata?.footprintCells;
      const p=light.position,range=Number(light.range||0);
      if(!(range>0))return 0;
      const regions=mesh.metadata?.cliffLightRegions;
      if(Array.isArray(regions)){
        let best=0;
        for(const region of regions){
          // A point behind an outward-facing terrain wall is not a plausible
          // receiver for that wall, regardless of the giant merged mesh bounds.
          const front=(p.x-region.x)*region.outwardX+(p.z-region.z)*region.outwardZ;
          if(front<=0)continue;
          if(footprint&&!footprint.has(`${region.tileX},${region.tileY}`)&&
            !footprint.has(`${region.neighborX},${region.neighborY}`))continue;
          const separation=Math.max(0,Math.hypot(p.x-region.x,p.y-region.y,p.z-region.z)-region.radius);
          if(separation>=range)continue;
          best=Math.max(best,1-separation/range);
        }
        return best*Number(light.metadata?.baseIntensity??light.intensity??0);
      }
      if(!footprintHits(footprint,mesh))return 0;
      const distance=Math.max(0,Math.hypot(center.x-p.x,center.y-p.y,center.z-p.z)-radius);
      return distance<range?(1-distance/range)*Number(light.metadata?.baseIntensity??light.intensity??0):0;
    };
    for(const mesh of this.scene.meshes||[]){
      const staticSource=mesh.metadata?.staticBatchSource===true;
      if(mesh.isDisposed?.()||(!staticSource&&mesh.isVisible===false)||mesh.isEnabled?.()===false||mesh.material?.disableLighting===true||
        mesh.metadata?.kind==="environment-light-field"||mesh.name==="terrain-surface"||!mesh.material)continue;
      if(mesh.metadata?.kind==="map-object-static-batch"){
        // All members were grouped using this same light selection. Never
        // re-rank by the huge merged bounding box and silently lose sources.
        const ids=new Set(mesh.metadata.localLightNames||[]);
        for(const light of lights)if(ids.has(light.name))memberships.get(light).push(mesh);
        records.receivers++;continue;
      }
      mesh.computeWorldMatrix?.(false);
      const bounds=mesh.getBoundingInfo?.()?.boundingSphere;
      const center=bounds?.centerWorld||mesh.getAbsolutePosition?.()||mesh.position;
      if(!center)continue;
      const radius=Math.max(0,Number(bounds?.radiusWorld||0));
      const authoredSlots=Number(mesh.material.maxSimultaneousLights);
      const capacity=Number.isFinite(authoredSlots)
        ?Math.max(0,Math.floor(authoredSlots)-sharedLights.length)
        :Infinity;
      const ranked=[];
      for(const light of lights){
        const strength=impact(mesh,light,center,radius);
        if(strength>0)ranked.push({light,strength});
      }
      if(mesh.name==="terrain-cliffs")records.cliffSourcesAvailable=ranked.length;
      if(ranked.length>capacity)records.limitedReceivers++;
      // Sorting only selects local light sources for the *existing* material;
      // Babylon still evaluates surface normals, built-in shadow and attenuation.
      ranked.sort((a,b)=>b.strength-a.strength||a.light.name.localeCompare(b.light.name));
      const selected=ranked.slice(0,capacity);
      if(staticSource){
        staticSourceLightBindings.set(mesh.uniqueId,selected.map(entry=>entry.light.name).sort());
        if(mesh.isVisible===false)continue;
      }
      for(const entry of selected)memberships.get(entry.light).push(mesh);
      if(mesh.name==="terrain-cliffs")records.cliffSourcesAssigned=Math.min(capacity,ranked.length);
      records.receivers++;
    }
    for(const light of lights){
      const receivers=memberships.get(light)||[];
      if(!receivers.length){
        if(light.isEnabled())light.setEnabled(false);
        // Babylon treats [] as unrestricted: always disable the light first.
        if(light.includedOnlyMeshes?.length)light.includedOnlyMeshes=[];
        continue;
      }
      const previous=light.includedOnlyMeshes||[];
      if(previous.length!==receivers.length||previous.some((mesh,i)=>mesh!==receivers[i]))
        light.includedOnlyMeshes=receivers;
      if(!light.isEnabled())light.setEnabled(true);
    }
    this.staticSourceLightBindings=staticSourceLightBindings;
    this.lightMembershipDiagnostics=records;
  }

  makeLightFieldMaterial(){
    const material=new BABYLON.StandardMaterial("environment-cell-light-field",this.scene);
    material.diffuseColor=BABYLON.Color3.White();
    material.emissiveColor=BABYLON.Color3.White();
    material.specularColor=BABYLON.Color3.Black();
    material.disableLighting=true;
    material.alphaMode=BABYLON.Engine.ALPHA_ADD;
    material.transparencyMode=BABYLON.Material.MATERIAL_ALPHABLEND;
    material.disableDepthWrite=true;
    material.backFaceCulling=false;
    material.fogEnabled=true;
    return material;
  }

  // Aggregate the authoritative light sources into exact illuminated grid cells.
  // FIRE_3X3 = source + eight neighbors; buildings = the actual deployment
  // area; character readability = its *own* occupied tile only. The field is
  // one drawable mesh independent of map light counts, with no second terrain
  // renderer, simulated environmental state or per-unit physical GPU lights.
  litCellColors(state){
    const map=new Map(),night=state?.presentation?.environment?.timeOfDay==="NIGHT";
    const daylightFactor=night?1:.32;
    const stamp=(x,y,color,energy)=>{
      if(!Number.isInteger(Number(x))||!Number.isInteger(Number(y)))return;
      const key=`${x},${y}`,existing=map.get(key)||[0,0,0];
      for(let i=0;i<3;i++)existing[i]=Math.min(1.65,existing[i]+Math.max(0,Number(color?.[i]??1))*energy*daylightFactor);
      map.set(key,existing);
    };
    for(const source of state?.presentation?.environment?.lightSources||[]){
      if(source.visible===false)continue;
      const color=lightColor(source.color,[1,.46,.14]);
      const intensity=Math.max(0,Math.min(3,Number(source.intensity??1)));
      if(source.footprint==="FIRE_3X3"||source.source==="BURNING"||source.source==="FIRE_TORNADO"){
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)
          stamp(source.x+dx,source.y+dy,color,intensity*(dx===0&&dy===0?.55:.39));
      }else if(Array.isArray(source.cells)&&source.cells.length){
        const power=source.source==="UNIT_TILE_LIGHT"?.63:.34;
        for(const cell of source.cells)stamp(cell.x,cell.y,color,intensity*power);
      }else{
        const r=Math.max(0,Math.floor(Number(source.radius||0)));
        for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
          const d=Math.hypot(dx,dy);if(d>r)continue;
          stamp(source.x+dx,source.y+dy,color,intensity*.28*(1-d/Math.max(1,r+1)));
        }
      }
    }
    return map;
  }

  // Sample the actual published ground vertex, then the existing water/snow/ice
  // render surfaces. This remains one colour field, not additional PointLights.
  // Illumination must not be buried below ice, floodwater or snow.
  lightFieldVertexY(tile,byKey,x,y,z){
    if(!tile)return y+.026;
    const sample={height:y/ELEVATION_HEIGHT,ox:clamp(x/TILE_SIZE-tile.x,-.5,.5),oz:clamp(z/TILE_SIZE-tile.y,-.5,.5)};
    let top=y;
    const water=this.surfaceResolver.waterSurfaceOf(tile);
    if(water!=null)top=Math.max(top,Number(water)*ELEVATION_HEIGHT);
    for(const type of ["SNOW"]){
      if(this.surfaceLayerAmount(type,tile)<=SURFACE_EPSILON)continue;
      const amount=this.layerAmountAt(type,tile,byKey,sample.ox,sample.oz);
      if(amount>SURFACE_EPSILON&&this.vertexLayerAlpha(type,tile,sample,amount)>0)
        top=Math.max(top,this.layerVertexY(type,tile,sample,amount));
    }
    return top+.055;
  }

  syncLightField(state){
    const terrain=this.scene.getMeshByName("terrain-surface"),cells=this.litCellColors(state);
    const byKey=new Map((state?.map?.tiles||[]).map(tile=>[`${tile.x},${tile.y}`,tile]));
    const stamp=[...cells].sort((a,b)=>a[0].localeCompare(b[0]))
      .map(([key,values])=>{
        const tile=byKey.get(key);
        // Visible surface height changes independently of the lighting source.
        const layers=tile?[tile.waterSurfaceZ??"n",snowDepth(tile),iceThickness(tile)].map(v=>String(v)).join(":"):"";
        return`${key}:${values.map(n=>n.toFixed(3)).join(",")}:${layers}`;
      }).join("|");
    if(terrain===this.lightFieldTerrain&&stamp===this.lightFieldSignature)return;
    this.lightFieldSignature=stamp;this.lightFieldTerrain=terrain;
    this.lightFieldMesh?.dispose();this.lightFieldMesh=null;this.lightFieldCells=cells.size;
    if(!terrain||!cells.size)return;
    const sourceVertices=terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind)||[];
    const sourceIndices=terrain.getIndices()||[];
    const positions=[],colors=[],indices=[];
    for(let i=0;i+2<sourceIndices.length;i+=3){
      const offsets=[sourceIndices[i]*3,sourceIndices[i+1]*3,sourceIndices[i+2]*3];
      const cx=(sourceVertices[offsets[0]]+sourceVertices[offsets[1]]+sourceVertices[offsets[2]])/3;
      const cz=(sourceVertices[offsets[0]+2]+sourceVertices[offsets[1]+2]+sourceVertices[offsets[2]+2])/3;
      const key=`${Math.round(cx/TILE_SIZE)},${Math.round(cz/TILE_SIZE)}`;
      const lit=cells.get(key),tile=byKey.get(key);
      if(!lit||!tile)continue;
      const base=positions.length/3;
      // Vertex RGB stores the source colour; alpha stores its brightness once.
      const peak=Math.max(0,...lit),alpha=Math.min(1,peak);
      const tint=peak>1e-8?lit.map(channel=>Math.min(1,channel/peak)):[0,0,0];
      for(const offset of offsets){
        const x=sourceVertices[offset],y=sourceVertices[offset+1],z=sourceVertices[offset+2];
        positions.push(x,this.lightFieldVertexY(tile,byKey,x,y,z),z);
        colors.push(tint[0],tint[1],tint[2],alpha);
      }
      indices.push(base,base+1,base+2);
    }
    if(!indices.length)return;
    const mesh=new BABYLON.Mesh("environment-cell-light-field",this.scene);
    const data=new BABYLON.VertexData();data.positions=positions;data.colors=colors;data.indices=indices;
    data.applyToMesh(mesh,false);
    mesh.useVertexColors=true;mesh.hasVertexAlpha=true;
    // WaterRenderer publishes translucent water at alphaIndex 10–13. The
    // aggregated radiance must reach its exposed water/ice/snow surface AFTER
    // those layers, while the optical haze and tactical markers remain above.
    mesh.alphaIndex=SURFACE_RENDER_ORDER.RADIANCE;
    mesh.material=this.lightFieldMaterial;
    mesh.isPickable=false;mesh.receiveShadows=false;
    mesh.metadata={kind:"environment-light-field",castShadow:false,mergedMesh:true,litCells:cells.size,
      exposedSurfaceAligned:true,boundedFireFootprint:"3x3",structureFootprint:"DEPLOYMENT_AREA",unitFootprint:"OWN_TILE"};
    this.lightFieldMesh=mesh;
  }

  makeFireGlowMaterial(color=[1,125/255,30/255]){
    const tint=lightColor(color),size=64,pixels=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const r=Math.hypot((x+.5-size/2)/(size/2),(y+.5-size/2)/(size/2)),i=(y*size+x)*4;
      pixels[i]=Math.round(tint[0]*255);pixels[i+1]=Math.round(tint[1]*255);pixels[i+2]=Math.round(tint[2]*255);
      pixels[i+3]=Math.round(255*Math.pow(Math.max(0,1-r),2.2));
    }
    const texture=BABYLON.RawTexture.CreateRGBATexture(pixels,size,size,this.scene,false,false,BABYLON.Texture.BILINEAR_SAMPLINGMODE);
    texture.hasAlpha=true;
    const material=new BABYLON.StandardMaterial(`environment-source-glow-${tint.map(n=>Math.round(n*255)).join("-")}`,this.scene);
    material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;
    material.emissiveColor=BABYLON.Color3.White();material.disableLighting=true;
    material.alphaMode=BABYLON.Engine.ALPHA_ADD;material.disableDepthWrite=true;
    material.backFaceCulling=false;material.fogEnabled=false;
    return material;
  }

  syncFireGlows(state){
    const environment=state?.presentation?.environment||{},weather=environment.weather;
    const night=environment.timeOfDay==="NIGHT",mist=weather==="FOG"?1:weather==="BLIZZARD"?.7:0;
    const alive=new Set(),byKey=new Map((state?.map?.tiles||[]).map(tile=>[`${tile.x},${tile.y}`,tile]));
    const focus=this.scene.activeCamera?.getTarget?.()||{x:0,z:0};
    const candidates=(environment.lightSources||[]).filter(source=>source.visible!==false&&Number(source.transmission||0)>0);
    const isStructure=source=>source.source==="CORE_LIGHT"||source.source==="CAPTURE_LIGHT";
    // Persistent structures must never be evicted by dozens of fire clusters.
    const structures=candidates.filter(isStructure),others=candidates.filter(source=>!isStructure(source))
      .sort((a,b)=>Math.hypot(a.x*TILE_SIZE-focus.x,a.y*TILE_SIZE-focus.z)-Math.hypot(b.x*TILE_SIZE-focus.x,b.y*TILE_SIZE-focus.z))
      .slice(0,Math.max(0,48-structures.length));
    for(const source of [...structures,...others]){
      const structure=isStructure(source),tile=byKey.get(`${source.x},${source.y}`),smoky=tile?.effects?.includes("SMOKE");
      if(!structure&&!mist&&!smoky)continue;
      const key=`${source.source}:${source.sourceId??`${source.x},${source.y}`}`;alive.add(key);
      let mesh=this.fireGlows.get(key);
      if(!mesh){
        mesh=BABYLON.MeshBuilder.CreatePlane(`fire-glow-${key}`,{size:1},this.scene);
        mesh.billboardMode=BABYLON.Mesh.BILLBOARDMODE_ALL;mesh.isPickable=false;
        // Permanent crystal glow is composed after weather haze; real smoke
        // still controls optical transmission before this material is drawn.
        if(structure)mesh.alphaIndex=SURFACE_RENDER_ORDER.SOURCE_GLOW;
        mesh.metadata={kind:"environment-source-glow",source:source.source,castShadow:false};
        this.fireGlows.set(key,mesh);
      }
      if(structure){
        const tint=lightColor(source.color),tone=tint.map(n=>Math.round(n*255)).join("-");
        if(!this.structureGlowMaterials.has(tone))this.structureGlowMaterials.set(tone,this.makeFireGlowMaterial(tint));
        mesh.material=this.structureGlowMaterials.get(tone);
      }else{
        this.fireGlowMaterial??=this.makeFireGlowMaterial();
        mesh.material=this.fireGlowMaterial;
      }
      // Core geometry itself is centred .825 above its published support.
      mesh.position.set(source.x*TILE_SIZE,surfaceOf(tile||{})*ELEVATION_HEIGHT+(structure?.85:.8),source.y*TILE_SIZE);
      mesh.scaling.setAll(structure?Math.min(3.4,1.65+Number(source.radius||1)*.13)
        :(1.6+mist*1.7)*Math.max(1,Number(source.radius||1)/2));
      mesh.visibility=structure?Math.min(night?.62:.28,.16+Number(source.transmission||0)*(night?.46:.13))
        :Math.min(.7,Number(source.transmission||0)*(.45+mist*.25));
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
      // The smoke cluster is one physical plume. Use the same published LOS as
      // weather haze, weighted by its real occupied tiles; never reveal an
      // unseen enemy or cut an entire multi-tile plume around one observer.
      const cells=entry.tiles||[];
      const visibleCells=cells.filter(point=>byKey.get(`${point.x},${point.y}`)?.atmosphericVisible===true).length;
      entry.animated.opticalClarity=visibleCells/Math.max(1,cells.length);
      // Local SMOKE is the occluder itself: it must remain visible even though it
      // blocks LOS. Only a true global FOV mask may hide smoke that is completely
      // buried inside unexplored/fogged territory; boundary smoke stays visible.
      const visible=!globalMaskActive||cells.some(touchesVisibleBoundary);
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
    return type==="SNOW"&&!!a&&!!b&&this.surfaceResolver.canSlope(a,b);
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

  // This is an observation of WaterRenderer's published polygons, not a
  // sampled surrogate riverbed or a new D/Q water-surface resolver.
  publishedWaterYAt(tile,x,z){
    const source=this.water?.publishedWaterTileTriangles?.get(this.surfaceResolver.keyOf(tile.x,tile.y));
    if(!source)return null;
    const {positions:p,indices,range}=source;
    const vertex=i=>({x:p[i*3],y:p[i*3+1],z:p[i*3+2]});
    for(let i=range.startIndex;i<range.startIndex+range.indexCount;i+=3){
      const a=vertex(indices[i]),b=vertex(indices[i+1]),c=vertex(indices[i+2]);
      const weights=this.water?.pointInTriangleXZ?.({x,z},a,b,c);
      if(weights)return a.y*weights.u+b.y*weights.w+c.y*weights.v;
    }
    return null;
  }

  layerVertexY(type,tile,sample,amount){
    const terrainY=Number(sample.height||0)*ELEVATION_HEIGHT;
    if(type==="SNOW"){
      const iceY=isSolidIce(tile)?this.publishedWaterYAt(tile,sample.x,sample.z):null;
      return (iceY??terrainY)+Math.max(.006,amount*ELEVATION_HEIGHT);
    }
    return terrainY+.006;
  }

  // The published VisualSurfaceResolver remains the ONLY terrain-height authority.
  // Read its canonical sampling positions once; later snow/ice/haze geometry
  // needs only ring elevations, not 16 biome/shore colours per tile and update.
  surfaceHeightPatch(tile,byKey){
    if(!this.surfacePatchStencil){
      this.surfacePatchStencil=this.surfaceResolver.patchGrid(tile,byKey)
        .map(row=>row.map(sample=>({ox:sample.ox,oz:sample.oz})));
    }
    const ring=this.surfaceResolver.ringSamples(tile,byKey);
    const elevation=this.surfaceResolver.elevationOf(tile);
    const x=Number(tile.x)*TILE_SIZE,z=Number(tile.y)*TILE_SIZE;
    return this.surfacePatchStencil.map(row=>row.map(({ox,oz})=>({
      ox,oz,x:x+ox*TILE_SIZE,z:z+oz*TILE_SIZE,
      height:this.surfaceResolver.sampleHeightFromRing(elevation,ring,ox,oz)
    })));
  }

  updateSnowCoverage(mesh){
    const base=mesh.metadata?.layerBaseIndices,colors=mesh.metadata?.layerBuffers?.colors;
    if(!base||!colors)return;
    const classes=coverageClasses(colors,{opaque:true});
    if(sameCoverageClasses(mesh.metadata.coverageClasses,classes))return;
    mesh.metadata.coverageClasses=classes;
    const coverage=surfaceCoverageIndices(base,colors,{opaque:true});
    // Each SubMesh draws one contiguous range, so opaque fragments participate
    // in depth rejection before fractional snow is transparently composed.
    mesh.setIndices(coverage.indices,null,true);
    mesh.subMeshes.length=0;
    const vertices=mesh.getTotalVertices();
    if(coverage.solidCount)new BABYLON.SubMesh(0,0,vertices,0,coverage.solidCount,mesh);
    if(coverage.blendedCount)new BABYLON.SubMesh(1,0,vertices,coverage.solidCount,coverage.blendedCount,mesh);
    this.surfaceLayerMetrics.opaqueSnowTriangles=coverage.solidCount/3;
    this.surfaceLayerMetrics.blendedSnowTriangles=coverage.blendedCount/3;
    this.surfaceLayerMetrics.snowHiddenTriangles=coverage.skippedTriangles;
  }

  updateIceCoverage(mesh){
    const base=mesh.metadata?.layerBaseIndices,colors=mesh.metadata?.layerBuffers?.colors;
    if(!base||!colors)return;
    const classes=coverageClasses(colors);
    if(sameCoverageClasses(mesh.metadata.coverageClasses,classes))return;
    mesh.metadata.coverageClasses=classes;
    const coverage=surfaceCoverageIndices(base,colors);
    mesh.setIndices(coverage.indices,null,true);
    this.surfaceLayerMetrics.iceVisibleTriangles=coverage.blendedCount/3;
    this.surfaceLayerMetrics.iceHiddenTriangles=coverage.skippedTriangles;
  }

  buildSurfaceLayer(type,tiles,byKey){
    // ICE owns no independent patch grid. Only the published water triangles
    // can supply frozen-water geometry through buildWaterIceLayer().
    if(type!=="SNOW")return null;
    const positions=[],indices=[],normals=[],colors=[],uvs=[];
    let activeTiles=0;
    const layerKeys=[],heightPatches=new Map();

    for(const tile of tiles){
      const localAmount=this.surfaceLayerAmount(type,tile);
      if(localAmount<=SURFACE_EPSILON)continue;
      layerKeys.push(this.surfaceResolver.keyOf(tile.x,tile.y));
      activeTiles++;
      const patch=this.surfaceHeightPatch(tile,byKey);
      heightPatches.set(this.surfaceResolver.keyOf(tile.x,tile.y),patch);
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
        // Keep triangle topology fixed while alpha varies; fully clear patches remain invisible.
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
    data.applyToMesh(mesh,true);
    mesh.material=this.snowPassMaterial;
    mesh.alphaIndex=SURFACE_RENDER_ORDER.FOAM+2;
    mesh.useVertexColors=true;
    mesh.hasVertexAlpha=true;
    mesh.isPickable=false;
    mesh.receiveShadows=true;
    mesh.metadata={
      kind:"environment-surface-layer",
      effectType:type,
      activeTiles,layerKeys,
      // These are the actual published buffers, not a second surface mesh.
      // Each tile owns 16 vertices / 18 triangles in this merged layer.
      layerInputSignatures:new Map(tiles.map(tile=>[
        this.surfaceResolver.keyOf(tile.x,tile.y),this.surfaceLayerTileInput(type,tile)
      ])),
      layerSlopeDelta:this.surfaceResolver.maxVisualSlopeDelta,
      layerTerrainHeights:new Map(tiles.map(tile=>[
        this.surfaceResolver.keyOf(tile.x,tile.y),this.surfaceResolver.elevationOf(tile)
      ])),
      layerHeightPatches:heightPatches,
      layerBaseIndices:indices.slice(),
      layerBuffers:{
        positions:new Float32Array(positions),
        normals:new Float32Array(normals),
        colors:new Float32Array(colors)
      },
      visualSurfaceResolver:true,
      microRegionsPerTile:9,
      mergedMesh:true,
      perTilePlate:false,
      meshRebuildPerFrame:false
    };
    this.updateSnowCoverage(mesh);
    return mesh;
  }

  // A frozen water surface has precisely the same wet shoreline, Q channel,
  // slope and submerged-cliff ownership as the already-built WaterRenderer.
  // The ice mesh reuses its FINAL indexed triangles and float32 XYZ verbatim;
  // it computes no surface intersection, triangulation or artificial seam.
  buildWaterIceLayer(tiles){
    const published=this.water?.publishedWaterTileTriangles;
    if(!(published instanceof Map))return null;
    const positions=[],indices=[],colors=[],uvs=[],ranges=new Map(),keys=[],sources=new Map();
    for(const tile of tiles){
      if(this.surfaceLayerAmount("ICE",tile)<=SURFACE_EPSILON)continue;
      const key=this.surfaceResolver.keyOf(tile.x,tile.y),source=published.get(key);
      if(!source)continue;
      const {positions:waterPositions,indices:waterIndices,range}=source;
      const startIndex=indices.length,startVertex=positions.length/3;
      const copied=new Map(),alpha=tile.fogged?0:clamp(iceThickness(tile)/.45,0,1);
      // Copy INDEXED triangles straight from the final Babylon water Mesh.
      // Coordinates and edge-split triangulation remain byte-for-byte equal.
      for(let i=range.startIndex;i<range.startIndex+range.indexCount;i++){
        const sourceIndex=waterIndices[i];
        let index=copied.get(sourceIndex);
        if(index===undefined){
          index=positions.length/3;copied.set(sourceIndex,index);
          const x=waterPositions[sourceIndex*3],y=waterPositions[sourceIndex*3+1],z=waterPositions[sourceIndex*3+2];
          positions.push(x,y,z);colors.push(1,1,1,alpha);
          uvs.push(x/TILE_SIZE,z/TILE_SIZE);
        }
        indices.push(index);
      }
      if(indices.length>startIndex){
        keys.push(key);
        ranges.set(key,{startIndex,indexCount:indices.length-startIndex,
          startVertex,vertexCount:positions.length/3-startVertex});
        sources.set(key,source);
      }
    }
    if(!indices.length)return null;
    const normals=[];
    BABYLON.VertexData.ComputeNormals(positions,indices,normals);
    const mesh=new BABYLON.Mesh("environment-surface-ice",this.scene);
    const data=new BABYLON.VertexData();
    data.positions=positions;data.indices=indices;data.normals=normals;
    data.colors=colors;data.uvs=uvs;data.applyToMesh(mesh,true);
    mesh.material=this.materials.ice;
    mesh.alphaIndex=SURFACE_RENDER_ORDER.FOAM+1;
    mesh.useVertexColors=true;mesh.hasVertexAlpha=true;
    mesh.isPickable=false;mesh.receiveShadows=true;
    mesh.metadata={kind:"environment-surface-layer",effectType:"ICE",
      source:"EXACT_RENDERED_WATER_DQ_TRIANGLES",mergedMesh:true,activeTiles:keys.length,
      layerKeys:keys,tileRanges:ranges,waterSources:sources,
      layerBaseIndices:indices.slice(),
      layerBuffers:{colors:new Float32Array(colors)},iceConformsToWater:true};
    this.updateIceCoverage(mesh);
    return mesh;
  }

  updateWaterIceLayer(tiles,mesh){
    const byKey=new Map(tiles.map(tile=>[this.surfaceResolver.keyOf(tile.x,tile.y),tile]));
    const ranges=mesh.metadata?.tileRanges,sources=mesh.metadata?.waterSources,
      buffer=mesh.metadata?.layerBuffers?.colors;
    if(!(ranges instanceof Map)||!(sources instanceof Map)||!buffer)return false;
    const active=tiles.filter(tile=>this.surfaceLayerAmount("ICE",tile)>SURFACE_EPSILON&&
      this.water?.publishedWaterTileTriangles?.has(this.surfaceResolver.keyOf(tile.x,tile.y)));
    if(active.length!==ranges.size)return false;
    for(const tile of active){
      const key=this.surfaceResolver.keyOf(tile.x,tile.y);
      const old=sources.get(key),current=this.water.publishedWaterTileTriangles.get(key);
      if(!ranges.has(key)||!old||!current||
         old.geometryVersion!==current.geometryVersion||
         old.positions!==current.positions||old.indices!==current.indices||
         old.range.startIndex!==current.range.startIndex||
         old.range.indexCount!==current.range.indexCount)return false;
    }
    let updated=false;
    for(const [key,range] of ranges){
      const tile=byKey.get(key),alpha=tile?.fogged?0:clamp(iceThickness(tile)/.45,0,1);
      for(let i=range.startVertex;i<range.startVertex+range.vertexCount;i++){
        if(buffer[i*4+3]===Math.fround(alpha))continue;
        buffer[i*4+3]=alpha;updated=true;
      }
    }
    if(updated){
      mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind,buffer);
      this.updateIceCoverage(mesh);
      this.surfaceLayerMetrics.colorUploads=(this.surfaceLayerMetrics.colorUploads||0)+1;
      this.surfaceLayerMetrics.vertexUpdates++;
    }
    return true;
  }

  // Snow's 16 patch vertices read the tile itself and its eight neighbours
  // through the existing slope ring and shared-scalar resolver.
  // Track exactly those inputs on the existing merged layer mesh: a change
  // dirties the source tile and its immediate neighbours, nothing else.
  surfaceLayerTileInput(type,tile){
    return JSON.stringify([
      this.surfaceResolver.elevationOf(tile),
      waterDepth(tile),tile.waterSurfaceZ??null,
      iceThickness(tile),type==="SNOW"?snowDepth(tile):null,
      tile.fogged===true,
      type==="SNOW"&&isSolidIce(tile)&&snowDepth(tile)>SURFACE_EPSILON
        ?this.water?.publishedWaterGeometryRevision??null:null
    ]);
  }

  updateSurfaceLayer(type,tiles,byKey,mesh){
    if(type!=="SNOW")return false;
    const keys=mesh.metadata?.layerKeys||[];
    const previous=mesh.metadata?.layerInputSignatures;
    const terrainHeights=mesh.metadata?.layerTerrainHeights;
    const heightPatches=mesh.metadata?.layerHeightPatches;
    const buffers=mesh.metadata?.layerBuffers;
    if(!(previous instanceof Map)||!(terrainHeights instanceof Map)||
       !(heightPatches instanceof Map)||!buffers||
       buffers.positions.length!==mesh.getTotalVertices()*3||
       buffers.normals.length!==buffers.positions.length||
       buffers.colors.length!==mesh.getTotalVertices()*4)return false;
    const indices=mesh.metadata?.layerBaseIndices;
    if(!indices||indices.length!==keys.length*54)return false;
    let positionChanged=false,colorChanged=false,resampled=0,normalTiles=0;
    const positionChanges=[],nextInputs=new Map(),nextTerrainHeights=new Map(),
      dirty=new Set(),terrainDirty=new Set();
    const markAffected=(key,target)=>{
      const [x,y]=key.split(",").map(Number);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)
        target.add(this.surfaceResolver.keyOf(x+dx,y+dy));
    };
    for(const tile of tiles){
      const key=this.surfaceResolver.keyOf(tile.x,tile.y);
      const stamp=this.surfaceLayerTileInput(type,tile);
      nextInputs.set(key,stamp);
      if(previous.get(key)!==stamp)markAffected(key,dirty);
      const height=this.surfaceResolver.elevationOf(tile);
      nextTerrainHeights.set(key,height);
      if(terrainHeights.get(key)!==height)markAffected(key,terrainDirty);
    }
    for(const key of previous.keys())if(!nextInputs.has(key))markAffected(key,dirty);
    for(const key of terrainHeights.keys())if(!nextTerrainHeights.has(key))markAffected(key,terrainDirty);
    if(mesh.metadata.layerSlopeDelta!==this.surfaceResolver.maxVisualSlopeDelta)
      for(const key of keys){dirty.add(key);terrainDirty.add(key);}
    for(let i=0;i<keys.length;i++){
      if(!dirty.has(keys[i]))continue;
      const tile=byKey.get(keys[i]);
      if(!tile)return false;
      resampled++;
      let patch=heightPatches.get(keys[i]);
      if(!patch||terrainDirty.has(keys[i])){
        patch=this.surfaceHeightPatch(tile,byKey);
        heightPatches.set(keys[i],patch);
      }
      const localPositions=[],localColors=[];
      for(let row=0;row<4;row++)for(let col=0;col<4;col++){
        const sample=patch[row][col];
        const amount=this.layerAmountAt(type,tile,byKey,sample.ox,sample.oz);
        localPositions.push(sample.x,this.layerVertexY(type,tile,sample,amount),sample.z);
        localColors.push(1,1,1,this.vertexLayerAlpha(type,tile,sample,amount));
      }
      const pOffset=i*16*3,cOffset=i*16*4;
      let changedPosition=false;
      for(let j=0;j<localPositions.length;j++){
        const value=Math.fround(localPositions[j]);
        if(buffers.positions[pOffset+j]===value)continue;
        buffers.positions[pOffset+j]=value;
        changedPosition=true;
      }
      for(let j=0;j<localColors.length;j++){
        const value=Math.fround(localColors[j]);
        if(buffers.colors[cOffset+j]===value)continue;
        buffers.colors[cOffset+j]=value;
        colorChanged=true;
      }
      if(!changedPosition)continue;
      positionChanged=true;
      positionChanges.push({index:i,positions:localPositions});
    }
    if(positionChanged){
      if(positionChanges.length===keys.length){
        // All blocks changed (e.g. region-wide snowfall). One existing mesh
        // normal solve costs less than hundreds of tiny separate calls.
        const allPositions=[];
        for(const change of positionChanges)allPositions.push(...change.positions);
        const allNormals=[];
        BABYLON.VertexData.ComputeNormals(allPositions,indices,allNormals);
        buffers.normals.set(allNormals);
      }else{
        // Disjoint 16-vertex tile ranges have no shared vertex indices, so
        // updating their normals cannot affect neighbouring mesh triangles.
        for(const change of positionChanges){
          const i=change.index,pOffset=i*16*3;
          const localIndices=Array.from(indices.slice(i*54,(i+1)*54),vertex=>vertex-i*16);
          const localNormals=[];
          BABYLON.VertexData.ComputeNormals(change.positions,localIndices,localNormals);
          for(let j=0;j<localNormals.length;j++)buffers.normals[pOffset+j]=localNormals[j];
        }
      }
      normalTiles=positionChanges.length;
    }
    mesh.metadata.layerInputSignatures=nextInputs;
    mesh.metadata.layerTerrainHeights=nextTerrainHeights;
    mesh.metadata.layerSlopeDelta=this.surfaceResolver.maxVisualSlopeDelta;
    this.surfaceLayerMetrics.resampledTiles=(this.surfaceLayerMetrics.resampledTiles||0)+resampled;
    this.surfaceLayerMetrics.normalTiles=(this.surfaceLayerMetrics.normalTiles||0)+normalTiles;
    // Babylon keeps the canonical CPU vertex buffers in sync with GPU uploads.
    // This also preserves publishedCoverGeometry() and any other vertex readers;
    // direct GPU-only partial writes would leave their CPU copy stale.
    if(positionChanged){
      mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind,buffers.positions);
      mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind,buffers.normals);
      mesh.refreshBoundingInfo();
      this.surfaceLayerMetrics.positionUploads=(this.surfaceLayerMetrics.positionUploads||0)+1;
    }
    if(colorChanged){
      mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind,buffers.colors);
      this.updateSnowCoverage(mesh);
      this.surfaceLayerMetrics.colorUploads=(this.surfaceLayerMetrics.colorUploads||0)+1;
    }
    if(positionChanged||colorChanged)this.surfaceLayerMetrics.vertexUpdates++;
    return true;
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

  surfaceLayerTypeSignature(type,tiles){
    return tiles.map(tile=>{
      // Snow sits on published terrain or solid ice; ice sits on stored water.
      // Only data that affects THIS layer's geometry/alpha invalidates it.
      const base=[tile.x,tile.y,this.surfaceResolver.elevationOf(tile),
        waterDepth(tile),tile.waterSurfaceZ??"n",iceThickness(tile),tile.fogged?1:0];
      if(type==="SNOW")base.push(snowDepth(tile));
      return base.join(":");
    }).join("|");
  }

  syncSurfaceLayers(state){
    const tiles=state?.map?.tiles||[];
    const signature=this.surfaceLayerSignature(tiles)+"|W:"+
      (this.water?.publishedWaterGeometryRevision??"unpublished");
    if(signature===this.surfaceSignature)return;
    const byKey=new Map(tiles.map(tile=>[this.surfaceResolver.keyOf(tile.x,tile.y),tile]));
    let changed=false;
    for(const type of ["SNOW","ICE"]){
      const needsPublishedWater=type==="ICE"||
        (type==="SNOW"&&tiles.some(tile=>isSolidIce(tile)&&snowDepth(tile)>SURFACE_EPSILON));
      const ownSignature=this.surfaceLayerTypeSignature(type,tiles)+
        (needsPublishedWater?"|W:"+(this.water?.publishedWaterGeometryRevision??"unpublished"):"");
      if(this.surfaceLayerTypeSignatures.get(type)===ownSignature)continue;
      this.surfaceLayerTypeSignatures.set(type,ownSignature);
      changed=true;
      const layerTiles=tiles.filter(tile=>this.surfaceLayerAmount(type,tile)>SURFACE_EPSILON);
      const layerKeys=layerTiles.map(tile=>this.surfaceResolver.keyOf(tile.x,tile.y));
      const prior=this.surfaceMeshes.get(type);
      if(type==="ICE"){
        if(prior&&this.updateWaterIceLayer(tiles,prior))continue;
        if(prior){prior.dispose();this.surfaceMeshes.delete(type);}
        const ice=this.buildWaterIceLayer(tiles);
        if(ice){this.surfaceMeshes.set(type,ice);this.surfaceLayerMetrics.rebuilds++;}
        continue;
      }
      const stable=prior&&prior.metadata?.layerKeys?.length===layerKeys.length&&layerKeys.every((key,i)=>key===prior.metadata.layerKeys[i]);
      if(stable&&this.updateSurfaceLayer(type,tiles,byKey,prior))continue;
      if(prior){prior.dispose();this.surfaceMeshes.delete(type);}
      const mesh=this.buildSurfaceLayer(type,tiles,byKey);
      if(mesh){this.surfaceMeshes.set(type,mesh);this.surfaceLayerMetrics.rebuilds++;}
    }
    this.surfaceSignature=signature;
    if(changed)this.publishedCoverRevision=(this.publishedCoverRevision||0)+1;
  }

  // Read-only query against the already published snow / ice geometry.
  // No inferred snow height, duplicate surface generator or tile rounding.
  publishedCoverGeometry(){
    const result=[];
    for(const [type,mesh] of this.surfaceMeshes){
      const keys=mesh.metadata?.layerKeys||[];
      if(!keys.length)continue;
      const positions=mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      const colors=mesh.getVerticesData(BABYLON.VertexBuffer.ColorKind);
      // The render index buffer is reordered by coverage and may omit
      // transparent triangles. Geometric queries must consume the ORIGINAL
      // tile-contiguous published triangles, never display-pass indices.
      const indices=mesh.metadata?.layerBaseIndices||mesh.getIndices();
      if(!positions||!colors||!indices)continue;
      const tileRanges=mesh.metadata?.tileRanges instanceof Map
        ?mesh.metadata.tileRanges
        :new Map(keys.map((key,i)=>[key,{startVertex:i*16,vertexCount:16,
          startIndex:i*54,indexCount:54}]));
      result.push({type,positions,colors,indices,tileRanges,
        opacity:Number((type==="SNOW"?this.materials.snow:mesh.material)?.alpha??1),
        tileOffsets:new Map(keys.map((key,i)=>[key,i]))});
    }
    return result;
  }

  publishedCoverYAt(tile,x,z,layers){
    const key=this.surfaceResolver.keyOf(tile.x,tile.y);
    let highest=-Infinity;
    for(const layer of layers||[]){
      const range=layer.tileRanges?.get(key);
      if(!range)continue;
      const {positions:p,colors:c,indices:ids}=layer;
      // Snow follows the original published 4x4 triangulation; ice follows
      // WaterRenderer's exact wet polygons with variable triangle counts.
      for(let i=range.startIndex;i<range.startIndex+range.indexCount;i+=3){
        const ai=ids[i],bi=ids[i+1],ci=ids[i+2],a=ai*3,b=bi*3,d=ci*3;
        const ax=p[b]-p[a],az=p[b+2]-p[a+2],bx=p[d]-p[a],bz=p[d+2]-p[a+2];
        const det=ax*bz-az*bx;
        if(Math.abs(det)<1e-9)continue;
        const dx=x-p[a],dz=z-p[a+2];
        const u=(dx*bz-dz*bx)/det,v=(ax*dz-az*dx)/det;
        if(u<-1e-6||v<-1e-6||u+v>1+1e-6)continue;
        const alpha=c[ai*4+3]*(1-u-v)+c[bi*4+3]*u+c[ci*4+3]*v;
        if(alpha<=SURFACE_EPSILON)continue;
        highest=Math.max(highest,p[a+1]+(p[b+1]-p[a+1])*u+(p[d+1]-p[a+1])*v);
        break;
      }
    }
    return highest;
  }

  visibilityHazeProfile(state){
    const environment=state?.presentation?.environment||{},weather=String(environment.weather||"CLEAR").toUpperCase(),timeOfDay=environment.timeOfDay==="NIGHT"?"NIGHT":"DAY";
    // Atmospheric cover comes from weather, never from the tactical FOV mask.
    // A fog climate channel may coexist with precipitation: it still deserves
    // its own ground-hugging mist without replacing rain or snow particles.
    const fogIntensity=Math.max(0,Number(environment.fogIntensity||0));
    const moonlight=String(environment.moonlight||"PARTIAL").toUpperCase();
    // EnvironmentEngine.visionRange() limits sight on EVERY night (FULL,
    // PARTIAL and NONE). Use that same published LOS mask to darken places
    // outside sight; moon phase changes opacity, never the sight calculation.
    // Weather haze has priority: do not stack a second darkness mesh on fog.
    const opticalProfile=fogIntensity>0?"FOG":VISIBILITY_HAZE_PROFILE[timeOfDay]?.[weather]
      ?weather:timeOfDay==="NIGHT"?"DARKNESS":null;
    const profile=VISIBILITY_HAZE_PROFILE[timeOfDay]?.[opticalProfile]||null;
    if(!profile)return null;
    const moonOpacity=opticalProfile==="DARKNESS"
      ?(moonlight==="FULL"?.50:moonlight==="NONE"?1:.75):1;
    const alpha=clamp(profile.alpha*moonOpacity*
      (fogIntensity>0?clamp(fogIntensity,.5,1.5):1),0,opticalProfile==="DARKNESS"?.90:.72);
    // LOS haze only obscures unseen cells. Visible cells show the actual
    // terrain lit by BabylonRenderer's existing scene lights, not tinted fog.
    return {...profile,alpha};
  }

  visibilityHazeStateSignature(state){
    const environment=state?.presentation?.environment||{},weather=String(environment.weather||"CLEAR").toUpperCase(),timeOfDay=environment.timeOfDay==="NIGHT"?"NIGHT":"DAY",moonlight=String(environment.moonlight||"PARTIAL").toUpperCase(),profile=this.visibilityHazeProfile(state);
    if(!profile)return`${timeOfDay}|${weather}|${moonlight}|OFF`;
    return`${timeOfDay}|${weather}|${moonlight}|${Number(environment.fogIntensity||0).toFixed(3)}|`+(state?.map?.tiles||[]).map(tile=>[
      tile.x,tile.y,
      Number(tile.elevation||0).toFixed(3),
      tile.waterSurfaceZ==null?"n":Number(tile.waterSurfaceZ).toFixed(3),
      waterDepth(tile).toFixed(3),snowDepth(tile).toFixed(3),iceThickness(tile).toFixed(3)
    ].join(":" )).join("|");
  }

  disposeVisibilityHaze(){
    this.visibilityHazeMesh?.dispose();
    this.visibilityHazeMesh=null;
    this.visibilityHazeSamples=[];
  }

  visibilityHazeColor(tile,byKey,ox,oz,profile){
    if(!tile)return[0,0,0,0];
    // TacticalEngine publishes the only LOS truth. Interpolate at shared
    // corners for continuous optical borders with no square patches.
    const visible=sample=>sample?.atmosphericVisible===true?1:0;
    const wx=clamp(Math.abs(ox),0,.5),wy=clamp(Math.abs(oz),0,.5);
    const x=tile.x+(ox<0?-1:1),y=tile.y+(oz<0?-1:1);
    const at=(xx,yy)=>byKey.get(this.surfaceResolver.keyOf(xx,yy));
    const sight=(1-wx)*(1-wy)*visible(tile)+
      wx*(1-wy)*visible(at(x,tile.y))+
      (1-wx)*wy*visible(at(tile.x,y))+
      wx*wy*visible(at(x,y));
    return[...profile.color,clamp(Number(profile.alpha||0)*(1-sight),0,1)];
  }

  visibilityHazeAlpha(tile,byKey,ox,oz,profile){
    return this.visibilityHazeColor(tile,byKey,ox,oz,profile)[3];
  }

  buildVisibilityHaze(state,profile,reusable=null){
    const tiles=state?.map?.tiles||[];
    if(!tiles.length)return null;
    const byKey=new Map(tiles.map(tile=>[this.surfaceResolver.keyOf(tile.x,tile.y),tile]));
    const positions=[],indices=[],colors=[],samples=[];
    // LOS haze is one continuous optical sheet, not independent transparent
    // tile plates. Ground/water/ice may publish DIFFERENT surface heights on
    // opposite sides of a tile boundary. Weld those shared world-XZ vertices
    // once, so the haze itself cannot open cracks or double-blend its edges.
    // This changes neither published gameplay sight nor water/terrain geometry.
    const sharedVertices=new Map();
    let reusedVertices=0,heightConflicts=0,maxHeightConflict=0;
    let activeTiles=0;

    for(const tile of tiles){
      const patch=this.surfaceHeightPatch(tile,byKey);
      const waterSurface=this.surfaceResolver.waterSurfaceOf(tile);
      const local=[];
      activeTiles++;
      for(let row=0;row<4;row++)for(let col=0;col<4;col++){
        const sample=patch[row][col],sampleHeight=Number(sample.height||0);
        let visualY=Math.max(sampleHeight,waterSurface==null?sampleHeight:Number(waterSurface))*ELEVATION_HEIGHT;
        for(const type of ["SNOW"]){
          if(this.surfaceLayerAmount(type,tile)<=SURFACE_EPSILON)continue;
          const amount=this.layerAmountAt(type,tile,byKey,sample.ox,sample.oz);
          if(amount>SURFACE_EPSILON&&this.vertexLayerAlpha(type,tile,sample,amount)>0)
            visualY=Math.max(visualY,this.layerVertexY(type,tile,sample,amount));
        }
        const requestedY=visualY+Number(profile.height||.4);
        const coord=`${Number(sample.x).toFixed(7)}:${Number(sample.z).toFixed(7)}`;
        let index=sharedVertices.get(coord);
        if(index===undefined){
          index=positions.length/3;
          sharedVertices.set(coord,index);
          positions.push(sample.x,requestedY,sample.z);
          colors.push(...this.visibilityHazeColor(tile,byKey,sample.ox,sample.oz,profile));
          samples.push({x:tile.x,y:tile.y,ox:sample.ox,oz:sample.oz});
        }else{
          reusedVertices++;
          const oldY=positions[index*3+1],difference=Math.abs(oldY-requestedY);
          if(difference>1e-6){
            heightConflicts++;
            maxHeightConflict=Math.max(maxHeightConflict,difference);
          }
          // The optical sheet has one height at each world-XZ coordinate.
          // Keep it above either exposed neighbour instead of letting one
          // transparent plate disappear below the other near a flooded bank.
          positions[index*3+1]=Math.max(oldY,requestedY);
        }
        local.push(index);
      }
      for(let row=0;row<3;row++)for(let col=0;col<3;col++){
        const nw=local[row*4+col],ne=local[row*4+col+1],
          sw=local[(row+1)*4+col],se=local[(row+1)*4+col+1];
        const alternate=(Number(tile.x)+Number(tile.y)+row+col)&1;
        if(alternate===0)indices.push(nw,ne,se,nw,se,sw);
        else indices.push(nw,ne,sw,ne,se,sw);
      }
    }

    if(!indices.length)return null;
    // Geometry indices never change while the published tile layout is stable.
    // Snow accumulation only changes already-published vertex positions, not
    // the mesh identity, shader/material, triangles or draw-call count.
    const classes=coverageClasses(colors);
    const canReuse=reusable&&!reusable.isDisposed?.()&&
      reusable.getTotalVertices()===positions.length/3&&
      reusable.metadata?.fullIndexCount===indices.length;
    const mesh=canReuse?reusable:new BABYLON.Mesh("weather-visibility-haze",this.scene);
    let visibleTriangles=canReuse?reusable.metadata.visibleTriangles:0;
    let skippedTriangles=canReuse?reusable.metadata.skippedTriangles:0;
    if(canReuse){
      mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind,positions);
      mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind,colors);
      if(!sameCoverageClasses(reusable.metadata.coverageClasses,classes)){
        const coverage=surfaceCoverageIndices(indices,colors);
        mesh.setIndices(coverage.indices,null,true);
        visibleTriangles=coverage.blendedCount/3;
        skippedTriangles=coverage.skippedTriangles;
      }
      mesh.refreshBoundingInfo();
      this.visibilityHazeMetrics.geometryUpdates++;
    }else{
      const coverage=surfaceCoverageIndices(indices,colors);
      const data=new BABYLON.VertexData();
      data.positions=positions;data.indices=coverage.indices;data.colors=colors;
      data.applyToMesh(mesh,true);
      visibleTriangles=coverage.blendedCount/3;
      skippedTriangles=coverage.skippedTriangles;
      this.visibilityHazeMetrics.meshBuilds++;
    }
    this.visibilityHazeSamples=samples;
    mesh.material=this.visibilityHazeMaterial;
    mesh.alphaIndex=SURFACE_RENDER_ORDER.OPTICAL_HAZE;
    mesh.useVertexColors=true;mesh.hasVertexAlpha=true;mesh.isPickable=false;
    mesh.metadata={
      kind:"weather-visibility-haze",activeTiles,
      weatherDriven:true,mergedMesh:true,continuousAcrossTiles:true,
      sharedWorldVertices:true,uniqueVertices:positions.length/3,
      fullIndexCount:indices.length,fullIndices:indices.slice(),
      coverageClasses:classes,visibleTriangles,skippedTriangles,
      reusedBoundaryVertices:reusedVertices,
      candidateBoundaryHeightConflicts:heightConflicts,
      maxBoundaryHeightConflict:maxHeightConflict,
      gameplayVisibilityOwner:"TacticalEngine"
    };
    return mesh;
  }

  syncVisibilityHaze(state){
    const signature=this.visibilityHazeStateSignature(state),profile=this.visibilityHazeProfile(state);
    const sightSignature=(state?.map?.tiles||[]).map(tile=>tile.atmosphericVisible===true?"1":"0").join("");
    if(signature!==this.visibilityHazeSignature){
      const layout=(state?.map?.tiles||[]).map(tile=>`${tile.x},${tile.y}`).join("|");
      if(!profile||layout!==this.visibilityHazeTopologySignature){
        this.disposeVisibilityHaze();
      }
      if(profile)this.visibilityHazeMesh=this.buildVisibilityHaze(state,profile,this.visibilityHazeMesh);
      this.visibilityHazeTopologySignature=profile?layout:"";
      this.visibilityHazeSignature=signature;
      this.visibilityHazeSightSignature=sightSignature;
      return;
    }
    if(!profile||!this.visibilityHazeMesh||sightSignature===this.visibilityHazeSightSignature)return;
    const byKey=new Map((state?.map?.tiles||[]).map(tile=>[this.surfaceResolver.keyOf(tile.x,tile.y),tile]));
    const colors=this.visibilityHazeMesh.getVerticesData(BABYLON.VertexBuffer.ColorKind);
    if(!colors)return;
    for(let i=0;i<this.visibilityHazeSamples.length;i++){
      const sample=this.visibilityHazeSamples[i],tile=byKey.get(this.surfaceResolver.keyOf(sample.x,sample.y));
      const sampleColor=this.visibilityHazeColor(tile,byKey,sample.ox,sample.oz,profile);
      for(let channel=0;channel<4;channel++)colors[i*4+channel]=sampleColor[channel];
    }
    this.visibilityHazeMesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind,colors);
    const classes=coverageClasses(colors);
    if(!sameCoverageClasses(this.visibilityHazeMesh.metadata.coverageClasses,classes)){
      const coverage=surfaceCoverageIndices(this.visibilityHazeMesh.metadata.fullIndices,colors);
      this.visibilityHazeMesh.setIndices(coverage.indices,null,true);
      this.visibilityHazeMesh.metadata.visibleTriangles=coverage.blendedCount/3;
      this.visibilityHazeMesh.metadata.skippedTriangles=coverage.skippedTriangles;
      this.visibilityHazeMesh.metadata.coverageClasses=classes;
    }
    this.visibilityHazeSightSignature=sightSignature;
  }

  syncAtmosphere(state){
    const environment=state?.presentation?.environment||{},weather=String(environment.weather||"CLEAR").toUpperCase(),timeOfDay=environment.timeOfDay==="NIGHT"?"NIGHT":"DAY";

    // Stage 13D: BabylonRenderer.syncSky owns the backdrop/clear colour. This
    // renderer only applies atmospheric transmission on top of that same
    // Environment weather state, so sky, fog and mist no longer fight over the
    // background. TacticalEngine/FOV remains the sole gameplay visibility owner.
    const climateFog=Number(environment.fogIntensity||0)>0;
    const profile=SCENE_FOG_PROFILE[timeOfDay]?.[climateFog?"FOG":weather]||null;
    // The fog shader variant is stable for every weather state. Zero density
    // is mathematically clear air; only the parameters change, not the program.
    if(this.scene.fogMode!==BABYLON.Scene.FOGMODE_EXP2)this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;
    // Only one renderer may own physical visibility obscuration at a time.
    // When the existing line-of-sight haze is active, it uses TacticalEngine's
    // per-tile sight field; a camera-distance fog cannot share that ownership
    // without washing out the unit's own visible ground. Keep the EXP2 shader
    // variant stable, but disable distance fog while local haze owns the mask.
    // Other weather profiles continue to use their original atmospheric fog.
    const sightHaze=this.visibilityHazeProfile(state);
    const sceneDensity=sightHaze?0:Number(profile?.density||0);
    this.scene.fogDensity=sceneDensity;
    if(profile)this.scene.fogColor=new BABYLON.Color3(...profile.color);
    this.atmosphereState={
      weather,
      timeOfDay,
      globalSceneFog:!!sceneDensity,
      opticalObscurationOwner:sightHaze?"LOS_HAZE":"SCENE_FOG",
      sceneFogDensity:sceneDensity,
      sceneFogColor:profile?[...profile.color]:null,
      backdropOwner:"BabylonRenderer.syncSky",
      atmosphereWeatherLinked:true,
      visibilityOwner:"FOV",
      layeredVisibilityHaze:!!this.visibilityHazeProfile(state)
    };
  }

  timedEnvironmentSync(name,run){
    const started=performance.now();
    try{return run();}
    finally{
      globalThis.CardTacticsDiagnostics?.recordPerf?.(`environmentSync.${name}`,performance.now()-started);
    }
  }

  sync(state,presentationEvents=[]){
    this.lastState=state;
    this.timedEnvironmentSync("atmosphere",()=>this.syncAtmosphere(state));
    this.timedEnvironmentSync("surfaceLayers",()=>this.syncSurfaceLayers(state));
    this.timedEnvironmentSync("visibilityHaze",()=>this.syncVisibilityHaze(state));
    this.timedEnvironmentSync("weatherParticles",()=>this.syncWeatherParticles(state));
    this.timedEnvironmentSync("presentationEvents",()=>this.syncPresentationEvents(presentationEvents,state));
    this.timedEnvironmentSync("tornadoClusters",()=>this.syncTornadoClusters(state));
    this.timedEnvironmentSync("smokeClusters",()=>this.syncSmokeClusters(state));
    this.timedEnvironmentSync("fireFields",()=>this.syncFireFields(state));
    this.timedEnvironmentSync("friendlyVisibility",()=>this.syncFriendlyVisibility(state));
    this.timedEnvironmentSync("physicalLights",()=>this.syncFireLights(state));
    this.timedEnvironmentSync("lightField",()=>this.syncLightField(state));
    this.timedEnvironmentSync("fireGlows",()=>this.syncFireGlows(state));
    const visibleLights=new Set((state?.presentation?.environment?.lightSources||[]).filter(light=>light.visible).map(light=>`${light.x},${light.y}:${light.source}`));
    const alive=new Set();
    for(const tile of state?.map?.tiles||[]){
      const surface=surfaceOf(tile)*ELEVATION_HEIGHT;
      for(const type of this.desiredNodeTypes(tile)){
        const key=keyOf(tile,type);alive.add(key);let node=this.nodes.get(key);
        if(!node){node=this.create(type,key,tile);if(!node)continue;this.nodes.set(key,node);}
        node.position.set(tile.x*TILE_SIZE,surface,tile.y*TILE_SIZE);
        let visible=tile.fogged?(visibleLights.has(key)?.70:0):1;
        // Steam follows the same LOS-derived local clarity as mist and smoke;
        // keep a substantial physical cloud because it still obstructs a ray.
        if(type==="STEAM"&&tile.atmosphericVisible===true)visible*=.55;
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
    const visibleSightTiles=(this.lastState?.map?.tiles||[]).filter(tile=>tile.atmosphericVisible===true).length;
    const hazeProfile=this.visibilityHazeProfile(this.lastState);
    return{
      total:this.nodes.size,
      opticalSight:{night:this.lastState?.presentation?.environment?.timeOfDay==="NIGHT",
        moonlight:this.lastState?.presentation?.environment?.moonlight||"PARTIAL",
        visibleTiles:visibleSightTiles,totalTiles:this.lastState?.map?.tiles?.length||0,
        hazeActive:!!this.visibilityHazeMesh,hazeOpacity:Number(hazeProfile?.alpha||0)},
      byType,
      currentOverlay:false,
      currentVisualOwner:"WaterRenderer",
      waterFlowPresentation:"animated-water-surface",
      surfaceLayers,surfaceLayerMetrics:{...this.surfaceLayerMetrics},visibilityHazeMetrics:{...this.visibilityHazeMetrics},
      visualSurfaceResolver:true,
      microRegionSurfaceLayers:true,
      perTileSnowBoxes:false,
      perTileIceGrounds:false,
      perTileCurrentGrounds:false,
      mudIntegratedIntoTerrain:true,
      weatherParticles:this.weatherPresentation||{rainActive:false,rainEmitRate:0,mistActive:false,mistEmitRate:0,globalSceneFog:false},
      atmosphere:this.atmosphereState||{globalSceneFog:false,visibilityOwner:"FOV"},
      visibilityHaze:this.visibilityHazeMesh?{active:true,tiles:Number(this.visibilityHazeMesh.metadata?.activeTiles||0),visibleTriangles:this.visibilityHazeMesh.metadata?.visibleTriangles,skippedTriangles:this.visibilityHazeMesh.metadata?.skippedTriangles,softBoundary:true,sharedWorldVertices:this.visibilityHazeMesh.metadata?.sharedWorldVertices===true,uniqueVertices:this.visibilityHazeMesh.metadata?.uniqueVertices,reusedBoundaryVertices:this.visibilityHazeMesh.metadata?.reusedBoundaryVertices,candidateBoundaryHeightConflicts:this.visibilityHazeMesh.metadata?.candidateBoundaryHeightConflicts,maxBoundaryHeightConflict:this.visibilityHazeMesh.metadata?.maxBoundaryHeightConflict}:{active:false,tiles:0,softBoundary:true},
      smokeDensityFromEffectDetails:true,
      smokePresentation:{clusters:this.smokeClusters.size,risingParticles:true,mergedHaze:true,visionOwner:"EnvironmentEngine.visionModifier"},
      firePresentation:{radianceFields:this.fireFields.size,flickeringFlames:true,adjacentHeatGlow:true},
      snowPresentation:{screenFallDominant:true,windDeflection:true,blizzardDiagonalFall:true},
      rainImpactPool:{size:this.rainImpacts.length,active:this.rainImpacts.filter(item=>item.active).length},
      lightningBursts:this.lightningBursts.length,
      meteorBursts:this.meteorBursts.length,
      fireGlows:this.fireGlows.size,
      structureGlows:[...this.fireGlows.values()].filter(mesh=>mesh.metadata?.source==="CORE_LIGHT"||mesh.metadata?.source==="CAPTURE_LIGHT").length,
      fireLights:{physicalLights:this.fireLights.filter(light=>light.isEnabled()).length,
        cellField:{active:!!this.lightFieldMesh,cells:this.lightFieldCells,
          exposedSurfaceAligned:this.lightFieldMesh?.metadata?.exposedSurfaceAligned===true},globalLightLimit:null,fireClusters:true,spatialMembership:this.lightMembershipDiagnostics||null},
      electrifiedPresentation:"sparse-surface-arcs",
      perTileElectricRings:false
    };
  }
}
