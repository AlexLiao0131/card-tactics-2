const TAP_SLOP={mouse:6,pen:8,touch:12};
const MOUSE_ROTATE_STEP=56;
const TOUCH_ROTATE_STEP=Math.PI/4;
const TOUCH_PINCH_INTENT_PX=14;
const TOUCH_ROTATE_INTENT=Math.PI/18;
const HUD_HOLD_MS=420;
const pointerTypeOf=event=>TAP_SLOP[event.pointerType]?event.pointerType:"mouse";
const normalizeAngle=value=>Math.atan2(Math.sin(value),Math.cos(value));
const multiGestureType=gesture=>["MULTI_PENDING","PINCH","ROTATE_TOUCH"].includes(gesture?.type);

export class BattleInputController{
  constructor(canvas,{camera,picker,onTilePicked}={}){
    this.canvas=canvas;this.camera=camera;this.picker=picker;this.onTilePicked=onTilePicked??(()=>{});
    this.pointers=new Map();this.gesture=null;
    this.holdTimer=null;this.holdPointerId=null;this.holdActive=false;
    this.install();
  }

  clearHold({releaseHud=true}={}){
    if(this.holdTimer!==null)clearTimeout(this.holdTimer);
    this.holdTimer=null;this.holdPointerId=null;
    if(this.holdActive){
      this.holdActive=false;
      // A recognized hold opens a persistent read-only inspector. Releasing
      // that finger must NOT dismiss the original portrait/HP/MP HUD.
      if(releaseHud)window.dispatchEvent(new CustomEvent("cardtactics:unit-hud-hold",{detail:null}));
    }
  }
  beginHold(event){
    this.clearHold();
    // The same hold recognizer serves unit and empty-tile inspection. On desktop
    // holding the primary mouse button also opens the inspector; pan/pinch cancel it.
    if(event.pointerType!=="touch"&&event.pointerType!=="pen"&&event.pointerType!=="mouse")return;
    const id=event.pointerId;
    this.holdPointerId=id;
    this.holdTimer=setTimeout(()=>{
      this.holdTimer=null;
      const pointer=this.pointers.get(id);
      if(!pointer||pointer.moved||this.pointers.size!==1||this.gesture?.type!=="PAN")return;
      const tile=this.picker.pickCurrent();
      if(!tile)return;
      pointer.moved=true;
      this.holdActive=true;
      // Inspection is READ ONLY. Never call clickBattleTile here: during an
      // attack/card phase it could accidentally resolve a real game action.
      window.dispatchEvent(new CustomEvent("cardtactics:battle-inspect-hold",{detail:{x:tile.x,y:tile.y}}));
      // BattleUI reuses the same snapshot and only exposes visible occupants;
      // don't query the full presentation twice for one long press.
    },HUD_HOLD_MS);
  }

  install(){
    // The canvas owns tactical gestures. Safari's text-selection/callout
    // recognizers must not steal a stationary touch from the existing HUD hold.
    // Scope this only to the battlefield surface; collection, deck and log text
    // elsewhere remains normally selectable.
    this.canvas.style.touchAction="none";
    this.canvas.style.webkitTouchCallout="none";
    this.canvas.style.webkitUserSelect="none";
    this.canvas.style.userSelect="none";
    // WebKit's iOS loupe is a native TOUCH gesture, not a pointer/context-menu
    // default action. Cancel only touches that start on the tactical canvas.
    // This canvas is wholly pointer-controlled, including custom pan/pinch;
    // using a non-passive touchstart does not interfere with other UI controls.
    this.onNativeTouchStart=event=>{if(event.cancelable)event.preventDefault();};
    this.onNativeContextMenu=event=>event.preventDefault();
    this.onNativeSelectStart=event=>event.preventDefault();
    this.onPointerDown=event=>{
      const touch=event.pointerType==="touch";
      const panPointer=touch||event.button===0;
      const rotatePointer=!touch&&event.button===1;
      if(!panPointer&&!rotatePointer)return;
      // The next tactical canvas gesture dismisses the previous inspection,
      // but the gesture itself still follows the original tap/pan/zoom rules.
      window.dispatchEvent(new CustomEvent("cardtactics:battle-inspection-dismiss"));
      event.preventDefault();
      if(touch&&event.isPrimary===true&&this.pointers.size)this.resetPointers();
      this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,type:pointerTypeOf(event),moved:false,button:event.button});
      try{this.canvas.setPointerCapture?.(event.pointerId)}catch(_){}
      if(this.pointers.size>=2){this.clearHold();this.beginMultiTouch();}
      else if(rotatePointer)this.gesture={type:"ROTATE_MOUSE",id:event.pointerId,lastX:event.clientX,accumulatedX:0};
      else{this.gesture={type:"PAN",id:event.pointerId,lastX:event.clientX,lastY:event.clientY};this.beginHold(event);}
    };

    this.onPointerMove=event=>{
      const pointer=this.pointers.get(event.pointerId);if(!pointer)return;
      pointer.x=event.clientX;pointer.y=event.clientY;
      const movedDistance=Math.hypot(pointer.x-pointer.startX,pointer.y-pointer.startY);
      if(movedDistance>TAP_SLOP[pointer.type]){pointer.moved=true;if(this.holdPointerId===event.pointerId)this.clearHold();}
      if(this.pointers.size>=2){
        this.clearHold();
        if(!multiGestureType(this.gesture))this.beginMultiTouch();
        const metrics=this.multiTouchMetrics();if(!metrics)return;
        [...this.pointers.values()].forEach(p=>p.moved=true);
        if(this.gesture.type==="MULTI_PENDING"){
          const pinchDelta=Math.abs(metrics.distance-this.gesture.startDistance);
          const rotateDelta=Math.abs(normalizeAngle(metrics.angle-this.gesture.startAngle));
          if(pinchDelta<TOUCH_PINCH_INTENT_PX&&rotateDelta<TOUCH_ROTATE_INTENT)return;
          if(rotateDelta>=TOUCH_ROTATE_INTENT&&rotateDelta*180/Math.PI>=pinchDelta*.7)this.gesture={...this.gesture,type:"ROTATE_TOUCH",lastAngle:metrics.angle,accumulatedAngle:0};
          else this.gesture={...this.gesture,type:"PINCH"};
        }
        if(this.gesture.type==="PINCH"){
          this.camera.setZoom(this.gesture.startZoom*metrics.distance/Math.max(1,this.gesture.startDistance));return;
        }
        if(this.gesture.type==="ROTATE_TOUCH"){
          const angleDelta=normalizeAngle(metrics.angle-this.gesture.lastAngle);
          this.gesture.lastAngle=metrics.angle;
          this.gesture.accumulatedAngle+=angleDelta;
          while(Math.abs(this.gesture.accumulatedAngle)>=TOUCH_ROTATE_STEP){
            const direction=this.gesture.accumulatedAngle>0?1:-1;
            this.camera.rotate(direction);
            this.gesture.accumulatedAngle-=direction*TOUCH_ROTATE_STEP;
          }
          return;
        }
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
      const consumed=this.holdActive&&this.holdPointerId===event.pointerId;
      this.clearHold({releaseHud:!consumed});
      const wasMulti=multiGestureType(this.gesture)||this.pointers.size>1;
      const wasRotate=this.gesture?.type==="ROTATE_MOUSE";
      this.pointers.delete(event.pointerId);
      try{this.canvas.releasePointerCapture?.(event.pointerId)}catch(_){}
      if(this.pointers.size===1){this.resumeSinglePointerPan();return;}
      this.gesture=null;
      if(wasMulti||wasRotate||pointer.moved||consumed)return;
      const tile=this.picker.pickCurrent();
      if(tile)this.onTilePicked(tile.x,tile.y);
    };
    this.onPointerCancel=event=>{
      if(!this.pointers.has(event.pointerId))return;
      this.clearHold();this.pointers.delete(event.pointerId);
      if(this.pointers.size===1)this.resumeSinglePointerPan();
      else if(this.pointers.size===0)this.gesture=null;
      else this.beginMultiTouch();
    };
    this.onLostPointerCapture=event=>{
      if(!this.pointers.has(event.pointerId))return;
      this.clearHold();this.pointers.delete(event.pointerId);
      if(this.pointers.size===1)this.resumeSinglePointerPan();
      else if(this.pointers.size===0)this.gesture=null;
      else this.beginMultiTouch();
    };
    this.onWheel=event=>{event.preventDefault();this.camera.zoomBy(event.deltaY>0?.9:1.1);};
    this.onOutsidePointerUp=event=>{if(event.target!==this.canvas)this.onPointerCancel(event);};
    this.onInterrupted=()=>this.resetPointers();
    this.onVisibilityChange=()=>{if(document.hidden)this.resetPointers();};
    this.canvas.addEventListener("pointerdown",this.onPointerDown);
    this.canvas.addEventListener("pointermove",this.onPointerMove);
    this.canvas.addEventListener("pointerup",this.onPointerUp);
    this.canvas.addEventListener("pointercancel",this.onPointerCancel);
    this.canvas.addEventListener("lostpointercapture",this.onLostPointerCapture);
    this.canvas.addEventListener("wheel",this.onWheel,{passive:false});
    this.canvas.addEventListener("touchstart",this.onNativeTouchStart,{passive:false});
    this.canvas.addEventListener("contextmenu",this.onNativeContextMenu);
    this.canvas.addEventListener("selectstart",this.onNativeSelectStart);
    window.addEventListener("pointerup",this.onOutsidePointerUp);
    window.addEventListener("pointercancel",this.onPointerCancel);
    window.addEventListener("blur",this.onInterrupted);
    window.addEventListener("pagehide",this.onInterrupted);
    document.addEventListener("visibilitychange",this.onVisibilityChange);
  }
  resetPointers(){
    this.clearHold();
    const ids=[...this.pointers.keys()];this.pointers.clear();this.gesture=null;
    for(const id of ids)try{this.canvas.releasePointerCapture?.(id)}catch(_){}
  }
  dispose(){
    this.resetPointers();
    this.canvas.removeEventListener("pointerdown",this.onPointerDown);
    this.canvas.removeEventListener("pointermove",this.onPointerMove);
    this.canvas.removeEventListener("pointerup",this.onPointerUp);
    this.canvas.removeEventListener("pointercancel",this.onPointerCancel);
    this.canvas.removeEventListener("lostpointercapture",this.onLostPointerCapture);
    this.canvas.removeEventListener("wheel",this.onWheel);
    this.canvas.removeEventListener("touchstart",this.onNativeTouchStart);
    this.canvas.removeEventListener("contextmenu",this.onNativeContextMenu);
    this.canvas.removeEventListener("selectstart",this.onNativeSelectStart);
    window.removeEventListener("pointerup",this.onOutsidePointerUp);
    window.removeEventListener("pointercancel",this.onPointerCancel);
    window.removeEventListener("blur",this.onInterrupted);
    window.removeEventListener("pagehide",this.onInterrupted);
    document.removeEventListener("visibilitychange",this.onVisibilityChange);
  }
  diagnostics(){return{gesture:this.gesture?.type||null,activePointers:this.pointers.size,pointerTypes:[...this.pointers.values()].map(pointer=>pointer.type)};}
  multiTouchMetrics(){
    const pts=[...this.pointers.values()];if(pts.length<2)return null;
    const dx=pts[1].x-pts[0].x,dy=pts[1].y-pts[0].y;
    return{distance:Math.max(1,Math.hypot(dx,dy)),angle:Math.atan2(dy,dx)};
  }
  beginMultiTouch(){
    this.clearHold();
    const metrics=this.multiTouchMetrics();if(!metrics)return;
    [...this.pointers.values()].forEach(p=>p.moved=true);
    this.gesture={type:"MULTI_PENDING",startDistance:metrics.distance,startZoom:this.camera.getViewState().zoom,startAngle:metrics.angle,lastAngle:metrics.angle,accumulatedAngle:0};
  }
  resumeSinglePointerPan(){
    const entry=[...this.pointers.entries()][0];if(!entry){this.gesture=null;return;}
    const[id,remaining]=entry;remaining.moved=true;remaining.startX=remaining.x;remaining.startY=remaining.y;
    this.gesture={type:"PAN",id,lastX:remaining.x,lastY:remaining.y};
  }
}
