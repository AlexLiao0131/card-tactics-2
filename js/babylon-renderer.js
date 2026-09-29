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

export class BabylonRenderer{
  constructor(canvas,state,{onTilePicked}={}){
    this.canvas=canvas;
    this.engine=new BABYLON.Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true});
    this.scene=new BABYLON.Scene(this.engine);
    this.scene.clearColor=new BABYLON.Color4(.035,.055,.08,1);
    this.subsystemErrors=new Map();

    this.hemi=new BABYLON.HemisphericLight("hemi",new BABYLON.Vector3(0,1,0),this.scene);
    this.sun=new BABYLON.DirectionalLight("sun",new BABYLON.Vector3(-.6,-1,-.35),this.scene);
    this.sun.position=new BABYLON.Vector3(10,18,10);

    // Scene-wide fill light: opposite horizontal direction, still angled downward.
    // This is a real lighting layer, not a terrain/tile special case.
    this.fill=new BABYLON.DirectionalLight("fill",new BABYLON.Vector3(.55,-.72,.42),this.scene);
    this.fill.position=new BABYLON.Vector3(-10,14,-10);

    this.syncLighting(state);

    this.camera=new BattleCamera(this.scene,canvas,state);
    this.terrain=new TerrainRenderer(this.scene);
    this.water=new WaterRenderer(this.scene);
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

  syncLighting(state){
    const environment=state?.presentation?.environment||{};
    const weather=String(environment.weather||"CLEAR").toUpperCase();
    const night=String(environment.timeOfDay||"DAY").toUpperCase()==="NIGHT";

    const base=night
      ?{
          ambient:new BABYLON.Color3(.045,.060,.095),
          hemiIntensity:.27,
          hemiDiffuse:new BABYLON.Color3(.46,.56,.78),
          ground:new BABYLON.Color3(.055,.070,.105),
          sunIntensity:.11,
          sunDiffuse:new BABYLON.Color3(.48,.56,.76),
          fillIntensity:.075,
          fillDiffuse:new BABYLON.Color3(.28,.38,.62)
        }
      :{
          ambient:new BABYLON.Color3(.18,.20,.15),
          hemiIntensity:.72,
          hemiDiffuse:new BABYLON.Color3(.96,.98,1.00),
          ground:new BABYLON.Color3(.22,.27,.18),
          sunIntensity:.78,
          sunDiffuse:new BABYLON.Color3(1.00,.95,.84),
          fillIntensity:.30,
          fillDiffuse:new BABYLON.Color3(.66,.78,.94)
        };

    const WEATHER_LIGHT=Object.freeze({
      CLEAR:{sun:1,fill:1,hemi:1,ambient:1},
      FOG:{sun:.42,fill:.82,hemi:.88,ambient:1.08},
      RAIN:{sun:.72,fill:.90,hemi:.92,ambient:.96},
      HEAVY_RAIN:{sun:.52,fill:.82,hemi:.82,ambient:.90},
      THUNDERSTORM:{sun:.40,fill:.74,hemi:.74,ambient:.84},
      SNOW:{sun:.80,fill:1.02,hemi:1.02,ambient:1.02},
      BLIZZARD:{sun:.56,fill:.92,hemi:.92,ambient:1.00}
    });
    const modifier=WEATHER_LIGHT[weather]||WEATHER_LIGHT.CLEAR;

    this.scene.ambientColor=base.ambient.scale(modifier.ambient);

    this.hemi.intensity=base.hemiIntensity*modifier.hemi;
    this.hemi.diffuse=base.hemiDiffuse;
    this.hemi.groundColor=base.ground;

    this.sun.intensity=base.sunIntensity*modifier.sun;
    this.sun.diffuse=base.sunDiffuse;

    this.fill.intensity=base.fillIntensity*modifier.fill;
    this.fill.diffuse=base.fillDiffuse;

    this.lightingState={
      timeOfDay:night?"NIGHT":"DAY",
      weather,
      ambient:[this.scene.ambientColor.r,this.scene.ambientColor.g,this.scene.ambientColor.b],
      hemiIntensity:this.hemi.intensity,
      sunIntensity:this.sun.intensity,
      fillIntensity:this.fill.intensity
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
    this.syncSubsystem("lighting",()=>this.syncLighting(state));

    // Critical interaction/state surfaces go first. A visual subsystem failure must
    // never make the battlefield impossible to click or hide objectives.
    this.syncSubsystem("camera",()=>this.camera.sync(state));
    this.syncSubsystem("picker",()=>this.picker.sync(state));
    this.syncSubsystem("objectives",()=>this.objectives.sync(state));
    this.syncSubsystem("highlights",()=>this.highlights.sync(state));

    // Visual subsystems are independent render clients of the same GridState.
    this.syncSubsystem("terrain",()=>this.terrain.sync(state));
    this.syncSubsystem("water",()=>this.water.sync(state));
    this.syncSubsystem("mapObjects",()=>this.mapObjects.sync(state));
    this.syncSubsystem("environment",()=>this.environment.sync(state));
    this.syncSubsystem("units",()=>this.units.sync(state,presentationEvents));
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
      lighting:this.lightingState||null,
      rendererErrors:Object.fromEntries(this.subsystemErrors),
      mapObjects:this.mapObjects.diagnostics(),
      environment:this.environment.diagnostics(),
      units:this.units.diagnostics?.()||{units:this.units.meshes?.size??null},
      unitHud:this.unitHud.diagnostics(),
      tiles:this.terrain.meshes?.size??null
    };
  }
}
