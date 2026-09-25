import { BattleCamera } from "./battle-camera.js";
import { TerrainRenderer } from "./terrain-renderer.js";
import { WaterRenderer } from "./water-renderer.js";
import { UnitRenderer } from "./unit-renderer.js";
import { ObjectiveRenderer } from "./objective-renderer.js";
import { HighlightRenderer } from "./highlight-renderer.js";
import { GridPicker } from "./grid-picker.js";

export class BabylonRenderer{
  constructor(canvas,state,{onTilePicked}={}){
    this.canvas=canvas;
    this.engine=new BABYLON.Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true});
    this.scene=new BABYLON.Scene(this.engine);
    this.scene.clearColor=new BABYLON.Color4(.035,.055,.08,1);
    const hemi=new BABYLON.HemisphericLight("hemi",new BABYLON.Vector3(0,1,0),this.scene);hemi.intensity=.72;
    const dir=new BABYLON.DirectionalLight("sun",new BABYLON.Vector3(-.6,-1,-.35),this.scene);dir.position=new BABYLON.Vector3(10,18,10);dir.intensity=.72;
    this.camera=new BattleCamera(this.scene,canvas,state);
    this.terrain=new TerrainRenderer(this.scene);
    this.water=new WaterRenderer(this.scene);
    this.objectives=new ObjectiveRenderer(this.scene);
    this.highlights=new HighlightRenderer(this.scene);
    this.units=new UnitRenderer(this.scene);
    this.picker=new GridPicker(this.scene,canvas,onTilePicked??(()=>{}));
    this.engine.runRenderLoop(()=>this.scene.render());
    window.addEventListener("resize",()=>{this.engine.resize();if(this.lastState)this.camera.sync(this.lastState)});
  }
  sync(state){
    this.lastState=state;
    this.camera.sync(state);
    this.terrain.sync(state);
    this.water.sync(state);
    this.objectives.sync(state);
    this.highlights.sync(state);
    this.units.sync(state);
  }
}
