import { TILE_SIZE } from "./coordinate-system.js";

function mapInfo(state){
  const map=state?.map||state?.grid||{};
  return {id:String(map.id||`${map.width||8}x${map.height||6}`),width:Number(map.width||8),height:Number(map.height||6)};
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export class BattleCamera{
  constructor(scene,canvas,state){
    this.scene=scene;this.canvas=canvas;this.projection="ISO";this.quarterTurns=0;this.zoom=1;
    this.mapKey="";this.baseTarget=BABYLON.Vector3.Zero();this.panOffset=BABYLON.Vector3.Zero();
    this.camera=new BABYLON.ArcRotateCamera("battleCamera",-Math.PI/4,Math.PI/3.2,24,BABYLON.Vector3.Zero(),scene);
    this.camera.mode=BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.lowerRadiusLimit=this.camera.upperRadiusLimit=24;
    this.camera.inputs.clear();
    this.sync(state);
  }

  panByPixels(dx,dy){
    const w=Math.max(1,this.camera.getEngine().getRenderWidth()),h=Math.max(1,this.camera.getEngine().getRenderHeight());
    const worldW=(this.camera.orthoRight-this.camera.orthoLeft),worldH=(this.camera.orthoTop-this.camera.orthoBottom);
    const sx=worldW/w,sy=worldH/h,a=this.camera.alpha;
    const right=new BABYLON.Vector3(Math.cos(a),0,-Math.sin(a));
    const forward=new BABYLON.Vector3(Math.sin(a),0,Math.cos(a));
    this.panOffset.addInPlace(right.scale(-Number(dx||0)*sx));
    this.panOffset.addInPlace(forward.scale(-Number(dy||0)*sy));
    this.apply();
  }

  setZoom(value){
    const next=clamp(Number(value)||1,.38,2.8);
    if(Math.abs(next-this.zoom)<.0001)return false;
    this.zoom=next;this.apply();this.emitView();return true;
  }

  zoomBy(factor){return this.setZoom(this.zoom*Number(factor||1));}

  sync(state){
    const info=mapInfo(state),key=`${info.id}|${info.width}x${info.height}`;
    if(key!==this.mapKey){
      this.mapKey=key;
      this.baseTarget=new BABYLON.Vector3(((info.width-1)*TILE_SIZE)/2,0,((info.height-1)*TILE_SIZE)/2);
      this.panOffset=BABYLON.Vector3.Zero();this.zoom=1;
    }
    this.info=info;this.apply();
  }

  apply(){
    const info=this.info||{width:8,height:6};
    this.camera.alpha=-Math.PI/4+this.quarterTurns*Math.PI/2;
    this.camera.beta=this.projection==="TOP"?.035:Math.PI/3.2;
    const aspect=Math.max(.5,this.camera.getEngine().getRenderWidth()/Math.max(1,this.camera.getEngine().getRenderHeight()));
    const isoBase=Math.max(8,(info.width+info.height)*TILE_SIZE*.27);
    const topBase=Math.max(7,Math.max(info.height,info.width/aspect)*TILE_SIZE*.62);
    const vertical=(this.projection==="TOP"?topBase:isoBase)/this.zoom;
    this.camera.orthoTop=vertical;this.camera.orthoBottom=-vertical;this.camera.orthoLeft=-vertical*aspect;this.camera.orthoRight=vertical*aspect;
    this.camera.setTarget(this.baseTarget.add(this.panOffset));
    this.scene.render();
  }

  rotate(delta=1){this.quarterTurns=((this.quarterTurns+Number(delta||0))%4+4)%4;this.apply();this.emitView();return this.quarterTurns}
  setProjection(mode){const next=mode==="TOP"?"TOP":"ISO";if(next===this.projection)return false;this.projection=next;this.apply();this.emitView();return true}
  toggleProjection(){return this.setProjection(this.projection==="ISO"?"TOP":"ISO")}
  resetView(){this.panOffset=BABYLON.Vector3.Zero();this.zoom=1;this.apply();this.emitView()}
  getViewState(){return{projection:this.projection,rotation:this.quarterTurns,zoom:this.zoom}}
  emitView(){window.dispatchEvent(new CustomEvent("cardtactics:view-change",{detail:this.getViewState()}))}
}
