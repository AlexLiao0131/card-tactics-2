import { TILE_SIZE } from "./coordinate-system.js";

function dims(state){
  const map=state?.map||state?.grid||{};
  return {width:Number(map.width||8),height:Number(map.height||6)};
}
export class BattleCamera{
  constructor(scene,canvas,state){
    this.scene=scene;
    this.camera=new BABYLON.ArcRotateCamera("battleCamera",-Math.PI/4,Math.PI/3.2,24,BABYLON.Vector3.Zero(),scene);
    this.camera.mode=BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.attachControl(canvas,true);
    this.camera.inputs.removeByType("ArcRotateCameraPointersInput");
    this.camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");
    this.camera.lowerBetaLimit=this.camera.upperBetaLimit=this.camera.beta;
    this.sync(state);
  }
  sync(state){
    const {width,height}=dims(state);
    const target=new BABYLON.Vector3(((width-1)*TILE_SIZE)/2,0,((height-1)*TILE_SIZE)/2);
    this.camera.alpha=-Math.PI/4+Number(state?.cameraQuarterTurns||0)*Math.PI/2;
    const aspect=Math.max(.5,this.camera.getEngine().getRenderWidth()/Math.max(1,this.camera.getEngine().getRenderHeight()));
    const vertical=Math.max(8.5,Math.max(width,height)*TILE_SIZE*.72);
    this.camera.orthoTop=vertical;
    this.camera.orthoBottom=-vertical;
    this.camera.orthoLeft=-vertical*aspect;
    this.camera.orthoRight=vertical*aspect;
    this.camera.setTarget(target);
  }
}
