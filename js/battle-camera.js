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
    this.activePointers=new Map();this.gesture=null;this.suppressTap=false;
    this.camera=new BABYLON.ArcRotateCamera("battleCamera",-Math.PI/4,Math.PI/3.2,24,BABYLON.Vector3.Zero(),scene);
    this.camera.mode=BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.lowerRadiusLimit=this.camera.upperRadiusLimit=24;
    this.camera.inputs.clear();
    this.installGestures();
    this.sync(state);
  }

  installGestures(){
    const down=e=>{
      if(e.button!=null&&e.button!==0&&e.pointerType!=="touch")return;
      this.activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      this.canvas.setPointerCapture?.(e.pointerId);
      if(this.activePointers.size>=2){
        const pts=[...this.activePointers.values()];
        this.gesture={type:"PINCH",distance:Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y),zoom:this.zoom};
        this.suppressTap=true;
      }else{
        this.gesture={type:"PAN",id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
      }
    };
    const move=e=>{
      const prev=this.activePointers.get(e.pointerId);if(!prev)return;
      this.activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(this.activePointers.size>=2){
        const pts=[...this.activePointers.values()],d=Math.max(1,Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y));
        if(this.gesture?.type!=="PINCH")this.gesture={type:"PINCH",distance:d,zoom:this.zoom};
        this.zoom=clamp(this.gesture.zoom*d/Math.max(1,this.gesture.distance),.38,2.8);this.suppressTap=true;this.apply();
        return;
      }
      if(this.gesture?.type!=="PAN"||this.gesture.id!==e.pointerId)return;
      const dx=e.clientX-this.gesture.x,dy=e.clientY-this.gesture.y;
      if(Math.abs(dx)+Math.abs(dy)>4){this.gesture.moved=true;this.suppressTap=true}
      if(this.gesture.moved){this.panPixels(dx,dy);this.gesture.x=e.clientX;this.gesture.y=e.clientY;this.apply()}
    };
    const up=e=>{
      const g=this.gesture;
      this.activePointers.delete(e.pointerId);
      try{this.canvas.releasePointerCapture?.(e.pointerId)}catch(_){}
      if(this.activePointers.size===1){
        const [id,p]=[...this.activePointers.entries()][0];
        this.gesture={type:"PAN",id,x:p.x,y:p.y,moved:true};this.suppressTap=true;
      }else if(this.activePointers.size===0){
        this.gesture=null;
        if(g?.moved||g?.type==="PINCH")setTimeout(()=>{this.suppressTap=false},0);
      }
    };
    const wheel=e=>{
      e.preventDefault();
      const factor=e.deltaY>0?.9:1.1;
      this.zoom=clamp(this.zoom*factor,.38,2.8);this.suppressTap=true;this.apply();
      setTimeout(()=>{this.suppressTap=false},0);
    };
    this.canvas.addEventListener("pointerdown",down);
    this.canvas.addEventListener("pointermove",move);
    this.canvas.addEventListener("pointerup",up);
    this.canvas.addEventListener("pointercancel",up);
    this.canvas.addEventListener("wheel",wheel,{passive:false});
  }

  panPixels(dx,dy){
    const w=Math.max(1,this.camera.getEngine().getRenderWidth()),h=Math.max(1,this.camera.getEngine().getRenderHeight());
    const worldW=(this.camera.orthoRight-this.camera.orthoLeft),worldH=(this.camera.orthoTop-this.camera.orthoBottom);
    const sx=worldW/w,sy=worldH/h,a=this.camera.alpha;
    const right=new BABYLON.Vector3(Math.cos(a),0,-Math.sin(a));
    const forward=new BABYLON.Vector3(Math.sin(a),0,Math.cos(a));
    this.panOffset.addInPlace(right.scale(-dx*sx));
    this.panOffset.addInPlace(forward.scale(-dy*sy));
  }

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
  consumeTapSuppression(){if(!this.suppressTap)return false;return true}
  emitView(){window.dispatchEvent(new CustomEvent("cardtactics:view-change",{detail:this.getViewState()}))}
}
