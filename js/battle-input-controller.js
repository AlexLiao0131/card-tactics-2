const TAP_SLOP={mouse:6,pen:8,touch:12};
const MOUSE_ROTATE_STEP=56;
const TOUCH_ROTATE_STEP=Math.PI/4;
const pointerTypeOf=event=>TAP_SLOP[event.pointerType]?event.pointerType:"mouse";
const normalizeAngle=value=>Math.atan2(Math.sin(value),Math.cos(value));

export class BattleInputController{
  constructor(canvas,{camera,picker,onTilePicked}={}){
    this.canvas=canvas;this.camera=camera;this.picker=picker;this.onTilePicked=onTilePicked??(()=>{});
    this.pointers=new Map();this.gesture=null;
    this.install();
  }

  install(){
    this.onPointerDown=event=>{
      const touch=event.pointerType==="touch";
      const panPointer=touch||event.button===0;
      const rotatePointer=!touch&&event.button===1;
      if(!panPointer&&!rotatePointer)return;
      event.preventDefault();
      this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,type:pointerTypeOf(event),moved:false,button:event.button});
      this.canvas.setPointerCapture?.(event.pointerId);
      if(this.pointers.size>=2)this.beginPinch();
      else if(rotatePointer)this.gesture={type:"ROTATE_MOUSE",id:event.pointerId,lastX:event.clientX,accumulatedX:0};
      else this.gesture={type:"PAN",id:event.pointerId,lastX:event.clientX,lastY:event.clientY};
    };

    this.onPointerMove=event=>{
      const pointer=this.pointers.get(event.pointerId);if(!pointer)return;
      pointer.x=event.clientX;pointer.y=event.clientY;
      const distance=Math.hypot(pointer.x-pointer.startX,pointer.y-pointer.startY);
      if(distance>TAP_SLOP[pointer.type])pointer.moved=true;

      if(this.pointers.size>=2){
        if(this.gesture?.type!=="PINCH")this.beginPinch();
        const pts=[...this.pointers.values()],dx=pts[1].x-pts[0].x,dy=pts[1].y-pts[0].y,distanceNow=Math.max(1,Math.hypot(dx,dy)),angleNow=Math.atan2(dy,dx);
        pts.forEach(p=>p.moved=true);
        this.camera.setZoom(this.gesture.startZoom*distanceNow/Math.max(1,this.gesture.startDistance));
        const angleDelta=normalizeAngle(angleNow-this.gesture.lastAngle);
        this.gesture.lastAngle=angleNow;
        this.gesture.accumulatedAngle+=angleDelta;
        while(Math.abs(this.gesture.accumulatedAngle)>=TOUCH_ROTATE_STEP){
          const direction=this.gesture.accumulatedAngle>0?1:-1;
          this.camera.rotate(direction);
          this.gesture.accumulatedAngle-=direction*TOUCH_ROTATE_STEP;
        }
        return;
      }

      if(this.gesture?.type==="ROTATE_MOUSE"&&this.gesture.id===event.pointerId){
        const dx=event.clientX-this.gesture.lastX;
        this.gesture.lastX=event.clientX;
        this.gesture.accumulatedX+=dx;
        while(Math.abs(this.gesture.accumulatedX)>=MOUSE_ROTATE_STEP){
          const direction=this.gesture.accumulatedX>0?1:-1;
          this.camera.rotate(direction);
          this.gesture.accumulatedX-=direction*MOUSE_ROTATE_STEP;
        }
        return;
      }

      if(this.gesture?.type!=="PAN"||this.gesture.id!==event.pointerId||!pointer.moved)return;
      const dx=event.clientX-this.gesture.lastX,dy=event.clientY-this.gesture.lastY;
      this.gesture.lastX=event.clientX;this.gesture.lastY=event.clientY;
      this.camera.panByPixels(dx,dy);
    };

    this.onPointerUp=event=>{
      const pointer=this.pointers.get(event.pointerId);if(!pointer)return;
      const wasMulti=this.gesture?.type==="PINCH"||this.pointers.size>1;
      const wasRotate=this.gesture?.type==="ROTATE_MOUSE";
      this.pointers.delete(event.pointerId);
      try{this.canvas.releasePointerCapture?.(event.pointerId)}catch(_){}

      if(this.pointers.size===1){
        const [id,remaining]=[...this.pointers.entries()][0];
        remaining.moved=true;
        this.gesture={type:"PAN",id,lastX:remaining.x,lastY:remaining.y};
        return;
      }
      this.gesture=null;
      if(wasMulti||wasRotate||pointer.moved)return;
      const tile=this.picker.pickCurrent();
      if(tile)this.onTilePicked(tile.x,tile.y);
    };

    this.onPointerCancel=event=>{
      this.pointers.delete(event.pointerId);
      if(this.pointers.size<2)this.gesture=null;
    };

    this.onWheel=event=>{
      event.preventDefault();
      this.camera.zoomBy(event.deltaY>0?.9:1.1);
    };

    this.canvas.addEventListener("pointerdown",this.onPointerDown);
    this.canvas.addEventListener("pointermove",this.onPointerMove);
    this.canvas.addEventListener("pointerup",this.onPointerUp);
    this.canvas.addEventListener("pointercancel",this.onPointerCancel);
    this.canvas.addEventListener("wheel",this.onWheel,{passive:false});
  }

  beginPinch(){
    const pts=[...this.pointers.values()];
    if(pts.length<2)return;
    pts.forEach(p=>p.moved=true);
    const dx=pts[1].x-pts[0].x,dy=pts[1].y-pts[0].y;
    this.gesture={
      type:"PINCH",
      startDistance:Math.max(1,Math.hypot(dx,dy)),
      startZoom:this.camera.getViewState().zoom,
      lastAngle:Math.atan2(dy,dx),
      accumulatedAngle:0
    };
  }
}
