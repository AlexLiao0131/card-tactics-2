import { BattleCamera } from "./battle-camera.js";
import { TerrainRenderer } from "./terrain-renderer.js";
import { WaterRenderer } from "./water-renderer.js";
import { UnitRenderer } from "./unit-renderer.js";
import { UnitHudOverlay } from "./unit-hud-overlay.js";
import { ObjectiveRenderer } from "./objective-renderer.js";
import { MapObjectRenderer } from "./map-object-renderer.js";
import { EnvironmentRenderer } from "./environment-renderer.js";
import { HighlightRenderer } from "./highlight-renderer.js";
import { GridPicker } from "./grid-picker.js";
import { BattleInputController } from "./battle-input-controller.js";
import { TILE_SIZE,ELEVATION_HEIGHT,UNIT_VISUAL_HEIGHT } from "./coordinate-system.js";

const SKY_PROFILES=Object.freeze({
  DAY:Object.freeze({
    SCORCHING_SUN:Object.freeze({zenith:[.20,.45,.76],upper:[.48,.68,.88],horizon:[1.00,.72,.40],cloud:.04,cloudColor:[1.00,.88,.69]}),
    CLEAR:Object.freeze({zenith:[.19,.43,.73],upper:[.46,.68,.88],horizon:[.82,.86,.82],cloud:.12,cloudColor:[.95,.96,.94]}),
    FOG:Object.freeze({zenith:[.39,.47,.53],upper:[.53,.59,.62],horizon:[.69,.70,.67],cloud:.62,cloudColor:[.76,.78,.77]}),
    RAIN:Object.freeze({zenith:[.19,.28,.36],upper:[.30,.39,.45],horizon:[.48,.52,.52],cloud:.70,cloudColor:[.55,.59,.61]}),
    HEAVY_RAIN:Object.freeze({zenith:[.12,.19,.26],upper:[.21,.29,.35],horizon:[.38,.42,.43],cloud:.82,cloudColor:[.43,.47,.49]}),
    THUNDERSTORM:Object.freeze({zenith:[.07,.11,.18],upper:[.14,.21,.29],horizon:[.29,.34,.38],cloud:.92,cloudColor:[.34,.39,.43]}),
    TYPHOON:Object.freeze({zenith:[.07,.13,.17],upper:[.13,.21,.25],horizon:[.25,.31,.32],cloud:.96,cloudColor:[.31,.37,.39]}),
    SNOW:Object.freeze({zenith:[.37,.53,.70],upper:[.59,.72,.83],horizon:[.86,.88,.86],cloud:.48,cloudColor:[.94,.95,.94]}),
    BLIZZARD:Object.freeze({zenith:[.25,.33,.41],upper:[.42,.49,.55],horizon:[.71,.73,.72],cloud:.90,cloudColor:[.80,.82,.81]})
  }),
  NIGHT:Object.freeze({
    SCORCHING_SUN:Object.freeze({zenith:[.012,.021,.060],upper:[.026,.052,.105],horizon:[.080,.105,.145],cloud:.05,cloudColor:[.18,.21,.27],stars:.90}),
    CLEAR:Object.freeze({zenith:[.010,.018,.055],upper:[.024,.050,.105],horizon:[.075,.105,.150],cloud:.08,cloudColor:[.17,.21,.28],stars:1}),
    FOG:Object.freeze({zenith:[.045,.058,.080],upper:[.070,.088,.110],horizon:[.120,.135,.145],cloud:.62,cloudColor:[.15,.17,.19],stars:0}),
    RAIN:Object.freeze({zenith:[.020,.030,.050],upper:[.040,.058,.078],horizon:[.090,.105,.115],cloud:.72,cloudColor:[.12,.14,.17],stars:0}),
    HEAVY_RAIN:Object.freeze({zenith:[.012,.020,.038],upper:[.027,.040,.058],horizon:[.065,.080,.092],cloud:.84,cloudColor:[.09,.11,.14],stars:0}),
    THUNDERSTORM:Object.freeze({zenith:[.008,.014,.030],upper:[.020,.032,.050],horizon:[.055,.068,.083],cloud:.94,cloudColor:[.075,.09,.12],stars:0}),
    TYPHOON:Object.freeze({zenith:[.008,.017,.027],upper:[.020,.036,.046],horizon:[.055,.075,.082],cloud:.97,cloudColor:[.075,.10,.11],stars:0}),
    SNOW:Object.freeze({zenith:[.030,.045,.075],upper:[.060,.085,.120],horizon:[.125,.145,.160],cloud:.50,cloudColor:[.20,.23,.27],stars:.28}),
    BLIZZARD:Object.freeze({zenith:[.022,.032,.050],upper:[.048,.062,.078],horizon:[.105,.118,.125],cloud:.92,cloudColor:[.15,.17,.19],stars:0})
  })
});


const LIGHT_COLOR_PROFILES=Object.freeze({
  DAY:Object.freeze({
    SCORCHING_SUN:Object.freeze({label:"WARM_HARSH_DAYLIGHT",sun:[1.00,.84,.60],hemi:[.92,.96,1.00],ground:[.29,.24,.15],fill:[.60,.73,.96],ambient:[.19,.18,.12]}),
    CLEAR:Object.freeze({label:"NEUTRAL_WARM_DAYLIGHT",sun:[1.00,.95,.84],hemi:[.96,.98,1.00],ground:[.22,.27,.18],fill:[.66,.78,.94],ambient:[.18,.20,.15]}),
    FOG:Object.freeze({label:"SOFT_COOL_OVERCAST",sun:[.84,.87,.89],hemi:[.87,.91,.94],ground:[.24,.27,.25],fill:[.73,.81,.85],ambient:[.18,.20,.20]}),
    RAIN:Object.freeze({label:"COOL_OVERCAST",sun:[.72,.80,.88],hemi:[.78,.87,.94],ground:[.18,.22,.22],fill:[.62,.75,.88],ambient:[.14,.17,.18]}),
    HEAVY_RAIN:Object.freeze({label:"COLD_OVERCAST",sun:[.60,.70,.80],hemi:[.68,.78,.86],ground:[.15,.19,.20],fill:[.54,.68,.82],ambient:[.12,.15,.17]}),
    THUNDERSTORM:Object.freeze({label:"COLD_STORM",sun:[.48,.60,.76],hemi:[.58,.69,.82],ground:[.11,.15,.18],fill:[.42,.57,.76],ambient:[.09,.12,.16]}),
    TYPHOON:Object.freeze({label:"COLD_TYPHOON",sun:[.44,.57,.70],hemi:[.54,.66,.74],ground:[.10,.15,.16],fill:[.38,.54,.66],ambient:[.08,.12,.14]}),
    SNOW:Object.freeze({label:"COOL_WHITE_SNOW",sun:[.92,.96,1.00],hemi:[.94,.98,1.00],ground:[.30,.34,.36],fill:[.76,.86,1.00],ambient:[.20,.22,.23]}),
    BLIZZARD:Object.freeze({label:"COLD_WHITE_BLIZZARD",sun:[.72,.82,.90],hemi:[.82,.90,.96],ground:[.22,.26,.28],fill:[.64,.76,.88],ambient:[.16,.18,.20]})
  }),
  NIGHT:Object.freeze({
    SCORCHING_SUN:Object.freeze({label:"COOL_MOONLIGHT",sun:[.44,.55,.78],hemi:[.45,.58,.82],ground:[.055,.070,.105],fill:[.28,.38,.62],ambient:[.045,.060,.095]}),
    CLEAR:Object.freeze({label:"COOL_MOONLIGHT",sun:[.44,.55,.78],hemi:[.45,.58,.82],ground:[.055,.070,.105],fill:[.28,.38,.62],ambient:[.045,.060,.095]}),
    FOG:Object.freeze({label:"MUTED_MOONLIGHT",sun:[.42,.49,.61],hemi:[.48,.56,.66],ground:[.065,.075,.085],fill:[.30,.36,.48],ambient:[.055,.065,.080]}),
    RAIN:Object.freeze({label:"COLD_RAIN_NIGHT",sun:[.34,.45,.64],hemi:[.39,.51,.68],ground:[.045,.060,.080],fill:[.23,.34,.54],ambient:[.035,.050,.075]}),
    HEAVY_RAIN:Object.freeze({label:"COLD_DARK_NIGHT",sun:[.28,.38,.56],hemi:[.33,.44,.60],ground:[.038,.050,.070],fill:[.19,.28,.46],ambient:[.028,.040,.064]}),
    THUNDERSTORM:Object.freeze({label:"BLUE_STORM_NIGHT",sun:[.24,.34,.54],hemi:[.28,.40,.59],ground:[.030,.045,.065],fill:[.16,.25,.44],ambient:[.022,.034,.060]}),
    TYPHOON:Object.freeze({label:"BLUE_TYPHOON_NIGHT",sun:[.23,.35,.50],hemi:[.27,.40,.54],ground:[.030,.045,.060],fill:[.15,.25,.40],ambient:[.022,.035,.054]}),
    SNOW:Object.freeze({label:"PALE_SNOW_MOONLIGHT",sun:[.55,.64,.82],hemi:[.60,.70,.88],ground:[.085,.10,.13],fill:[.36,.47,.70],ambient:[.060,.075,.11]}),
    BLIZZARD:Object.freeze({label:"COLD_WHITE_NIGHT",sun:[.42,.52,.68],hemi:[.48,.60,.74],ground:[.065,.080,.10],fill:[.29,.40,.58],ambient:[.045,.060,.085]})
  })
});

function skyCss(color,alpha=1){
  const c=(color||[0,0,0]).map(value=>Math.round(Math.max(0,Math.min(1,Number(value||0)))*255));
  return`rgba(${c[0]},${c[1]},${c[2]},${Math.max(0,Math.min(1,Number(alpha||0)))})`;
}

function mixSkyColor(a,b,t){
  const amount=Math.max(0,Math.min(1,Number(t||0)));
  return(a||[0,0,0]).map((value,index)=>value+((b?.[index]??0)-value)*amount);
}

export class BabylonRenderer{
  constructor(canvas,state,{onTilePicked}={}){
    this.canvas=canvas;
    this.engine=new BABYLON.Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true});
    this.scene=new BABYLON.Scene(this.engine);
    this.scene.clearColor=new BABYLON.Color4(.035,.055,.08,1);
    this.subsystemErrors=new Map();
    this.skySignature="";
    this.createSkyLayer();
    this.syncSky(state);

    this.hemi=new BABYLON.HemisphericLight("hemi",new BABYLON.Vector3(0,1,0),this.scene);
    this.sun=new BABYLON.DirectionalLight("sun",new BABYLON.Vector3(-.6,-1,-.35),this.scene);
    this.sun.position=new BABYLON.Vector3(10,18,10);

    // Scene-wide fill light: opposite horizontal direction, still angled downward.
    // This is a real lighting layer, not a terrain/tile special case.
    this.fill=new BABYLON.DirectionalLight("fill",new BABYLON.Vector3(.55,-.72,.42),this.scene);
    this.fill.position=new BABYLON.Vector3(-10,14,-10);

    // One scene-wide directional shadow map follows the primary sun. Keep it at
    // 1024px and low-cost filtering so iPhone/iPad WebGL stays practical.
    this.shadowGenerator=new BABYLON.ShadowGenerator(1024,this.sun);
    this.shadowGenerator.bias=.0008;
    this.shadowGenerator.normalBias=.025;
    // Closed 3D casters use their back faces for the depth map. Their lit front
    // faces then avoid sampling their own quantized depth (striped shadow acne).
    // Keep the small existing biases and real cast/receive shadows; billboards
    // and ground-contact decorations stay excluded by collectShadowCasters().
    this.shadowGenerator.forceBackFacesOnly=true;
    this.shadowGenerator.transparencyShadow=true;
    this.sun.autoCalcShadowZBounds=true;
    this.sun.autoUpdateExtends=true;
    if(this.engine.webGLVersion>=2){
      this.shadowGenerator.usePercentageCloserFiltering=true;
      if(BABYLON.ShadowGenerator.QUALITY_LOW!=null){
        this.shadowGenerator.filteringQuality=BABYLON.ShadowGenerator.QUALITY_LOW;
      }
    }else{
      this.shadowGenerator.usePoissonSampling=true;
    }

    this.syncLighting(state);

    this.camera=new BattleCamera(this.scene,canvas,state);
    this.terrain=new TerrainRenderer(this.scene);
    // Water shoreline clipping reuses the exact terrain ring samples. Renderer
    // layers stay visual-only, but they now agree on one geometric surface.
    this.water=new WaterRenderer(this.scene,this.terrain);
    this.mapObjects=new MapObjectRenderer(this.scene);
    this.environment=new EnvironmentRenderer(this.scene);
    this.objectives=new ObjectiveRenderer(this.scene);
    this.highlights=new HighlightRenderer(this.scene);
    this.units=new UnitRenderer(this.scene);
    this.unitHud=new UnitHudOverlay(this.scene,this.engine,canvas,this.camera.camera);
    this.picker=new GridPicker(this.scene,canvas);
    this.input=new BattleInputController(canvas,{camera:this.camera,picker:this.picker,onTilePicked});

    this.engine.runRenderLoop(()=>{
      this.units.updateFrame();
      this.scene.render();
      this.unitHud.updateFrame();
    });

    window.addEventListener("resize",()=>this.resize());
  }

  createSkyLayer(){
    // Stage 13A: one opaque screen-space atmospheric background. The upper part
    // is sky; below the horizon it fades into darker, low-saturation distant air
    // instead of continuing blue sky underneath the battlefield. It is redrawn
    // only when weather/day-night changes, so mobile still pays one tiny draw.
    this.skyTexture=new BABYLON.DynamicTexture(
      "battle-sky-texture",
      {width:256,height:256},
      this.scene,
      false,
      BABYLON.Texture.BILINEAR_SAMPLINGMODE
    );
    this.skyTexture.hasAlpha=false;
    this.skyTexture.wrapU=this.skyTexture.wrapV=BABYLON.Texture.CLAMP_ADDRESSMODE;
    this.skyLayer=new BABYLON.Layer("battle-sky",null,this.scene,true);
    this.skyLayer.texture=this.skyTexture;
    this.skyLayer.isBackground=true;
  }

  skyProfile(state){
    const environment=state?.presentation?.environment||{};
    const weather=String(environment.weather||"CLEAR").toUpperCase();
    const timeOfDay=String(environment.timeOfDay||"DAY").toUpperCase()==="NIGHT"?"NIGHT":"DAY";
    const table=SKY_PROFILES[timeOfDay];
    return{weather,timeOfDay,profile:table[weather]||table.CLEAR};
  }

  syncSky(state){
    if(!this.skyTexture)return;
    const {weather,timeOfDay,profile}=this.skyProfile(state),signature=`${timeOfDay}:${weather}`;
    if(signature===this.skySignature)return;
    this.skySignature=signature;

    const context=this.skyTexture.getContext(),size=this.skyTexture.getSize(),width=Number(size.width||256),height=Number(size.height||256);

    // The tactical map is viewed from above, so empty screen below the map must
    // not look like a second patch of sky. Keep a real horizon band around the
    // middle of the backdrop, then fade the lower half toward distant ground haze.
    const night=timeOfDay==="NIGHT";
    const lowerTarget=night?[.012,.020,.032]:weather==="SCORCHING_SUN"?[.30,.24,.17]:weather==="SNOW"||weather==="BLIZZARD"?[.31,.36,.38]:[.15,.22,.24];
    const deepTarget=night?[.005,.010,.018]:weather==="SCORCHING_SUN"?[.12,.095,.070]:[.055,.085,.10];
    const lower=mixSkyColor(profile.horizon,lowerTarget,night?.82:.70);
    const deep=mixSkyColor(lower,deepTarget,night?.72:.62);
    const gradient=context.createLinearGradient(0,0,0,height);
    gradient.addColorStop(0,skyCss(profile.zenith));
    gradient.addColorStop(.42,skyCss(profile.upper));
    gradient.addColorStop(.58,skyCss(profile.horizon));
    gradient.addColorStop(.70,skyCss(lower));
    gradient.addColorStop(1,skyCss(deep));
    context.globalAlpha=1;context.fillStyle=gradient;context.fillRect(0,0,width,height);
    this.scene.clearColor=new BABYLON.Color4(deep[0],deep[1],deep[2],1);

    // Static stylized cloud strata: weather chooses coverage, Climate still owns
    // every actual weather rule. Clouds are clipped above the horizon so the
    // lower screen can never read as "sky underneath the battlefield".
    const cloud=Math.max(0,Math.min(1,Number(profile.cloud||0))),horizonStop=.58;
    if(cloud>.01){
      context.save();
      context.beginPath();
      context.rect(0,0,width,height*horizonStop);
      context.clip();
      context.fillStyle=skyCss(profile.cloudColor||profile.upper,.13+.28*cloud);
      const bands=Math.round(2+cloud*6),cloudBottom=height*(horizonStop-.055);
      for(let i=0;i<bands;i++){
        const phase=(i*73+29)%width;
        const t=bands<=1?0:i/(bands-1),y=35+t*Math.max(0,cloudBottom-42)+(i%2)*5;
        const rx=38+cloud*34+(i%3)*9,ry=6+cloud*10+(i%2)*3;
        context.beginPath();context.ellipse(phase,y,rx,ry,(i%2?-.08:.06),0,Math.PI*2);context.fill();
        context.beginPath();context.ellipse((phase+92)%width,y+7,rx*.72,ry*.82,0,0,Math.PI*2);context.fill();
      }
      context.restore();
    }

    // Clear nights get a tiny deterministic star field baked into the same 256px
    // texture. It costs nothing per frame and vanishes naturally under bad weather.
    const stars=Math.max(0,Math.min(1,Number(profile.stars||0)));
    if(stars>.01){
      let seed=0x51f15e;
      const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      context.save();
      for(let i=0;i<58;i++){
        const x=random()*width,y=random()*height*.48,r=.35+random()*.72,a=(.30+random()*.60)*stars;
        context.fillStyle=`rgba(226,236,255,${a})`;context.beginPath();context.arc(x,y,r,0,Math.PI*2);context.fill();
      }
      context.restore();
    }

    // Canvas 2D uses a top-left origin while the Layer samples WebGL texture V
    // in the opposite direction. Upload with invertY=true so the semantic layout
    // stays intact: zenith/clouds above, horizon in the middle, atmosphere below.
    this.skyTexture.update(true);
    this.skyState={weather,timeOfDay,cloudCoverage:cloud,stars,horizonStop:.58,cloudsAboveHorizonOnly:true,lowerAtmosphere:true,textureYCorrected:true};
  }

  syncLighting(state){
    const environment=state?.presentation?.environment||{};
    const weather=String(environment.weather||"CLEAR").toUpperCase();
    const night=String(environment.timeOfDay||"DAY").toUpperCase()==="NIGHT";
    const timeOfDay=night?"NIGHT":"DAY";

    // Stage 13B deliberately consumes the existing DAY/NIGHT + Weather state.
    // EnvironmentEngine remains the sole owner of time/weather rules; this layer
    // only maps that state to physically coherent light colours.
    const paletteTable=LIGHT_COLOR_PROFILES[timeOfDay];
    const palette=paletteTable[weather]||paletteTable.CLEAR;
    const color=value=>new BABYLON.Color3(...value);
    const intensity=night
      ?{hemi:.27,sun:.11,fill:.075}
      :{hemi:.72,sun:.78,fill:.30};

    const WEATHER_LIGHT=Object.freeze({
      SCORCHING_SUN:{sun:1.16,fill:.9,hemi:.94,ambient:.96},
      CLEAR:{sun:1,fill:1,hemi:1,ambient:1},
      FOG:{sun:.42,fill:.82,hemi:.88,ambient:1.08},
      RAIN:{sun:.72,fill:.90,hemi:.92,ambient:.96},
      HEAVY_RAIN:{sun:.52,fill:.82,hemi:.82,ambient:.90},
      THUNDERSTORM:{sun:.40,fill:.74,hemi:.74,ambient:.84},
      TYPHOON:{sun:.32,fill:.68,hemi:.70,ambient:.80},
      SNOW:{sun:.80,fill:1.02,hemi:1.02,ambient:1.02},
      BLIZZARD:{sun:.56,fill:.92,hemi:.92,ambient:1.00}
    });
    const modifier=WEATHER_LIGHT[weather]||WEATHER_LIGHT.CLEAR;

    this.scene.ambientColor=color(palette.ambient).scale(modifier.ambient);

    this.hemi.intensity=intensity.hemi*modifier.hemi;
    this.hemi.diffuse=color(palette.hemi);
    this.hemi.groundColor=color(palette.ground);

    this.sun.intensity=intensity.sun*modifier.sun;
    this.sun.diffuse=color(palette.sun);

    this.fill.intensity=intensity.fill*modifier.fill;
    this.fill.diffuse=color(palette.fill);

    // Shadows still follow light strength rather than colour temperature. A cold
    // storm therefore softens the same physical shadow map instead of inventing
    // a second shadow system.
    const shadowDarkness=Math.max(.10,Math.min(.36,(night?.12:.36)*modifier.sun));
    if(this.shadowGenerator?.setDarkness)this.shadowGenerator.setDarkness(shadowDarkness);
    else if(this.shadowGenerator)this.shadowGenerator.darkness=shadowDarkness;

    this.lightingState={
      timeOfDay,
      weather,
      colorTemperatureProfile:palette.label,
      ambient:[this.scene.ambientColor.r,this.scene.ambientColor.g,this.scene.ambientColor.b],
      hemiColor:[this.hemi.diffuse.r,this.hemi.diffuse.g,this.hemi.diffuse.b],
      sunColor:[this.sun.diffuse.r,this.sun.diffuse.g,this.sun.diffuse.b],
      fillColor:[this.fill.diffuse.r,this.fill.diffuse.g,this.fill.diffuse.b],
      hemiIntensity:this.hemi.intensity,
      sunIntensity:this.sun.intensity,
      fillIntensity:this.fill.intensity,
      shadowDarkness
    };
  }

  shadowMeshVisible(mesh){
    if(!mesh)return false;
    if(mesh.isDisposed?.())return false;
    if(mesh.isEnabled?.()===false)return false;
    return Number(mesh.visibility??1)>.5;
  }

  collectShadowCasters(){
    const casters=[],seen=new Set();
    const add=mesh=>{
      if(mesh?.metadata?.castShadow===false||!this.shadowMeshVisible(mesh)||seen.has(mesh.uniqueId))return;
      seen.add(mesh.uniqueId);
      casters.push(mesh);
    };

    // Interactive environment props are real 3D geometry and should anchor
    // themselves to the terrain through shadows.
    for(const entry of this.mapObjects?.nodes?.values?.()||[]){
      const node=entry?.node||entry;
      for(const mesh of node?.getChildMeshes?.(false)||[])add(mesh);
    }

    // Cores are large battlefield structures. Capture-point floor markers stay out
    // of the shadow map because they are UI-like ground indicators.
    for(const mesh of this.objectives?.cores?.values?.()||[])add(mesh);

    // Real 3D unit geometry casts. Billboard characters intentionally do not: a
    // transparent character plane would otherwise cast a rectangular card shadow.
    for(const entry of this.units?.entries?.values?.()||[]){
      if(String(entry?.kind||"").toUpperCase()==="BILLBOARD")continue;
      for(const mesh of entry?.meshes||[])add(mesh);
    }
    return casters;
  }

  syncShadows(){
    const shadowMap=this.shadowGenerator?.getShadowMap?.();
    if(!shadowMap)return;

    const casters=this.collectShadowCasters();
    const renderList=shadowMap.renderList||(shadowMap.renderList=[]);
    renderList.splice(0,renderList.length,...casters);

    let receivers=0;
    for(const mesh of this.terrain?.meshes?.values?.()||[]){
      mesh.receiveShadows=true;
      receivers++;
    }

    this.shadowState={
      enabled:true,
      mapSize:Number(shadowMap.getSize?.().width||1024),
      casters:casters.length,
      receivers,
      filtering:this.engine.webGLVersion>=2?"PCF_LOW":"POISSON",
      billboardPolicy:"DO_NOT_CAST_RECTANGLE"
    };
  }

  syncSubsystem(name,fn){
    try{
      fn();
      this.subsystemErrors.delete(name);
      return true;
    }catch(error){
      const message=String(error?.stack||error?.message||error);
      if(this.subsystemErrors.get(name)!==message){
        this.subsystemErrors.set(name,message);
        console.error(`[BabylonRenderer:${name}]`,error);
      }
      return false;
    }
  }

  sync(state,presentationEvents=[]){
    this.lastState=state;
    this.syncSubsystem("sky",()=>this.syncSky(state));
    this.syncSubsystem("lighting",()=>this.syncLighting(state));

    // Critical interaction/state surfaces go first. A visual subsystem failure must
    // never make the battlefield impossible to click or hide objectives.
    this.syncSubsystem("camera",()=>this.camera.sync(state));
    this.syncSubsystem("picker",()=>this.picker.sync(state));
    this.syncSubsystem("objectives",()=>this.objectives.sync(state));
    this.syncSubsystem("highlights",()=>this.highlights.sync(state));

    // Visual subsystems are independent render clients of the same GridState.
    this.syncSubsystem("terrain",()=>this.terrain.sync(state));
    this.syncSubsystem("water",()=>this.water.sync(state,presentationEvents));
    this.syncSubsystem("mapObjects",()=>this.mapObjects.sync(state));
    this.syncSubsystem("environment",()=>this.environment.sync(state,presentationEvents));
    this.syncSubsystem("units",()=>this.units.sync(state,presentationEvents));
    this.syncSubsystem("shadows",()=>this.syncShadows());
    this.syncSubsystem("unitHud",()=>this.unitHud.sync(state));

    this.syncSubsystem("actionAnchor",()=>this.syncActionAnchor(state));
  }

  syncActionAnchor(state){
    const selected=(state?.units||[]).find(u=>u.selected);
    if(!selected)return;

    const world=new BABYLON.Vector3(
      Number(selected.x)*TILE_SIZE,
      Number(selected.renderZ??selected.z??0)*ELEVATION_HEIGHT+UNIT_VISUAL_HEIGHT*.7,
      Number(selected.y)*TILE_SIZE
    );
    const viewport=this.camera.camera.viewport.toGlobal(
      this.engine.getRenderWidth(),
      this.engine.getRenderHeight()
    );
    const p=BABYLON.Vector3.Project(
      world,
      BABYLON.Matrix.Identity(),
      this.scene.getTransformMatrix(),
      viewport
    );
    const rect=this.canvas.getBoundingClientRect();
    const sx=rect.left+p.x*(rect.width/Math.max(1,this.engine.getRenderWidth()));
    const sy=rect.top+p.y*(rect.height/Math.max(1,this.engine.getRenderHeight()));
    const bar=document.getElementById("skillBar");
    if(bar){
      bar.style.setProperty("--menu-x",`${Math.round(sx)}px`);
      bar.style.setProperty("--menu-y",`${Math.round(sy)}px`);
    }
  }

  resize(){
    this.engine.resize();
    if(this.lastState){
      this.syncSubsystem("camera",()=>this.camera.sync(this.lastState));
      this.syncSubsystem("unitHudFrame",()=>this.unitHud.updateFrame());
      this.syncSubsystem("actionAnchor",()=>this.syncActionAnchor(this.lastState));
    }
  }

  rotate(delta){return this.camera.rotate(delta)}
  toggleProjection(){return this.camera.toggleProjection()}
  resetView(){return this.camera.resetView()}
  getViewState(){return this.camera.getViewState()}

  diagnostics(){
    return{
      projection:this.camera.getViewState().projection,
      rotation:this.camera.getViewState().rotation,
      zoom:this.camera.getViewState().zoom,
      sky:this.skyState||null,
      lighting:this.lightingState||null,
      shadows:this.shadowState||{enabled:true,mapSize:1024,casters:0,receivers:0},
      rendererErrors:Object.fromEntries(this.subsystemErrors),
      mapObjects:this.mapObjects.diagnostics(),
      environment:this.environment.diagnostics(),
      units:this.units.diagnostics?.()||{units:this.units.meshes?.size??null},
      unitHud:this.unitHud.diagnostics(),
      tiles:this.terrain.meshes?.size??null
    };
  }
}
