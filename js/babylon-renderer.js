import { BattleCamera } from "./battle-camera.js";
import { TerrainRenderer } from "./terrain-renderer.js";
import { WaterRenderer } from "./water-renderer.js";
import { UnitRenderer } from "./unit-renderer.js";
import { ObjectiveRenderer } from "./objective-renderer.js";
import { HighlightRenderer } from "./highlight-renderer.js";
import { GridPicker } from "./grid-picker.js";
import { BattleInputController } from "./battle-input-controller.js";
import { TILE_SIZE,ELEVATION_HEIGHT,UNIT_VISUAL_HEIGHT } from "./coordinate-system.js";

export class BabylonRenderer{
  constructor(canvas,state,{onTilePicked}={}){
    this.canvas=canvas;
    this.engine=new BABYLON.Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true});
    this.scene=new BABYLON.Scene(this.engine);this.scene.clearColor=new BABYLON.Color4(.035,.055,.08,1);
    const hemi=new BABYLON.HemisphericLight("hemi",new BABYLON.Vector3(0,1,0),this.scene);hemi.intensity=.75;
    const dir=new BABYLON.DirectionalLight("sun",new BABYLON.Vector3(-.6,-1,-.35),this.scene);dir.position=new BABYLON.Vector3(10,18,10);dir.intensity=.78;
    this.camera=new BattleCamera(this.scene,canvas,state);
    this.terrain=new TerrainRenderer(this.scene);this.water=new WaterRenderer(this.scene);this.objectives=new ObjectiveRenderer(this.scene);
    this.highlights=new HighlightRenderer(this.scene);this.units=new UnitRenderer(this.scene);
    this.picker=new GridPicker(this.scene,canvas);
    this.input=new BattleInputController(canvas,{camera:this.camera,picker:this.picker,onTilePicked});
    this.engine.runRenderLoop(()=>this.scene.render());
    window.addEventListener("resize",()=>this.resize());
  }
  sync(state){
    this.lastState=state;this.camera.sync(state);this.terrain.sync(state);this.water.sync(state);this.objectives.sync(state);this.highlights.sync(state);this.units.sync(state);this.syncActionAnchor(state);
  }
  syncActionAnchor(state){
    const selected=(state?.units||[]).find(u=>u.selected);if(!selected)return;
    const world=new BABYLON.Vector3(Number(selected.x)*TILE_SIZE,Number(selected.renderZ??selected.z??0)*ELEVATION_HEIGHT+UNIT_VISUAL_HEIGHT*.7,Number(selected.y)*TILE_SIZE);
    const viewport=this.camera.camera.viewport.toGlobal(this.engine.getRenderWidth(),this.engine.getRenderHeight());
    const p=BABYLON.Vector3.Project(world,BABYLON.Matrix.Identity(),this.scene.getTransformMatrix(),viewport);
    const rect=this.canvas.getBoundingClientRect(),sx=rect.left+p.x*(rect.width/Math.max(1,this.engine.getRenderWidth())),sy=rect.top+p.y*(rect.height/Math.max(1,this.engine.getRenderHeight()));
    const bar=document.getElementById("skillBar");if(bar){bar.style.setProperty("--menu-x",`${Math.round(sx)}px`);bar.style.setProperty("--menu-y",`${Math.round(sy)}px`)}
  }
  resize(){this.engine.resize();if(this.lastState){this.camera.sync(this.lastState);this.syncActionAnchor(this.lastState)}}
  rotate(delta){return this.camera.rotate(delta)}
  toggleProjection(){return this.camera.toggleProjection()}
  resetView(){return this.camera.resetView()}
  getViewState(){return this.camera.getViewState()}
}
