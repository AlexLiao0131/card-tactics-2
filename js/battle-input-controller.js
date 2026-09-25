const TAP_SLOP={mouse:6,pen:8,touch:12};
const pointerTypeOf=event=>TAP_SLOP[event.pointerType]?event.pointerType:"mouse";

export class BattleInputController{
  constructor(canvas,{camera,picker,onTilePicked}={}){
    this.canvas=canvas;this.camera=camera;this.picker=picker;this.onTilePicked=onTilePicked??(()=>{});
    this.pointers=new Map();this.gesture=null;
    this.install();
  }

  install(){
    this.onPointerDown=event=>{
      if(event.pointerType!=="touch"&&event.button!==0)return;
      this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,type:pointerTypeOf(event),moved:false});
      this.canvas.setPointerCapture?.(event.pointerId);
      if(this.pointers.size>=2)this.beginPinch();
      else this.gesture={type:"PAN",id:event.pointerId,lastX:event.clientX,lastY:event.clientY};
    };

    this.onPointerMove=event=>{
      const pointer=this.pointers.get(event.pointerId);if(!pointer)return;
      pointer.x=event.clientX;pointer.y=event.clientY;
      const distance=Math.hypot(pointer.x-pointer.startX,pointer.y-pointer.startY);
      if(distance>TAP_SLOP[pointer.type])pointer.moved=true;

      if(this.pointers.size>=2){
        if(this.gesture?.type!=="PINCH")this.beginPinch();
        const pts=[...this.pointers.values()],distanceNow=Math.max(1,Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y));
        pts.forEach(p=>p.moved=true);
        this.camera.setZoom(this.gesture.startZoom*distanceNow/Math.max(1,this.gesture.startDistance));
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
      this.pointers.delete(event.pointerId);
      try{this.canvas.releasePointerCapture?.(event.pointerId)}catch(_){}

      if(this.pointers.size===1){
        const [id,remaining]=[...this.pointers.entries()][0];
        remaining.moved=true;
        this.gesture={type:"PAN",id,lastX:remaining.x,lastY:remaining.y};
        return;
      }
      this.gesture=null;
      if(wasMulti||pointer.moved)return;
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
    this.gesture={type:"PINCH",startDistance:Math.max(1,Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)),startZoom:this.camera.getViewState().zoom};
  }
}
