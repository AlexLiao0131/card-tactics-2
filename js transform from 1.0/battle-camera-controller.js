(()=>{
"use strict";
function create({scene,minZoom=.62,maxZoom=1.55,onTap,onChanged}){
 const cam=scene.cameras.main,s={mode:"IDLE",primary:null,start:null,pinch:null,moved:false};
 const active=()=>[scene.input.pointer1,scene.input.pointer2].filter(p=>p?.isDown);
 const distance=(a,b)=>Phaser.Math.Distance.Between(a.x,a.y,b.x,b.y);
 const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
 const clamp=z=>Phaser.Math.Clamp(z,minZoom,maxZoom);
 const worldAt=p=>({x:cam.worldView.x+p.x/cam.zoom,y:cam.worldView.y+p.y/cam.zoom});
 function changed(final=false){onChanged?.(final)}
 function pan(p){s.mode="PAN";s.primary=p.id;s.start={x:p.x,y:p.y,sx:cam.scrollX,sy:cam.scrollY};s.pinch=null;s.moved=false}
 function pinch(){
   const a=active();if(a.length<2)return;
   const mid=midpoint(a[0],a[1]);
   s.mode="PINCH";s.primary=null;s.start=null;s.moved=true;
   s.pinch={distance:Math.max(1,distance(a[0],a[1])),zoom:cam.zoom,mid,world:worldAt(mid)};
 }
 function applyPinch(){
   const a=active();if(a.length<2||!s.pinch)return;
   const mid=midpoint(a[0],a[1]),z=clamp(s.pinch.zoom*distance(a[0],a[1])/s.pinch.distance);
   cam.setZoom(z);
   cam.scrollX=s.pinch.world.x-mid.x/z;
   cam.scrollY=s.pinch.world.y-mid.y/z;
   changed();
 }
 function down(p){active().length>=2?pinch():pan(p)}
 function move(p){
   const a=active();
   if(a.length>=2){if(s.mode!=="PINCH")pinch();applyPinch();return}
   if(s.mode!=="PAN"||p.id!==s.primary||!s.start)return;
   const dx=p.x-s.start.x,dy=p.y-s.start.y;if(Math.abs(dx)+Math.abs(dy)>7)s.moved=true;
   cam.scrollX=s.start.sx-dx/cam.zoom;cam.scrollY=s.start.sy-dy/cam.zoom;changed();
 }
 function up(p){
   const tap=s.mode==="PAN"&&!s.moved&&p.id===s.primary;
   s.mode="IDLE";s.primary=null;s.start=null;s.pinch=null;s.moved=false;
   const a=active();if(a.length===1)pan(a[0]);else if(tap)onTap?.(p);
   changed(true);
 }
 function wheel(p,_g,_x,dy){
   const screenPoint={x:p.x,y:p.y},world=worldAt(screenPoint),z=clamp(cam.zoom*(dy>0?.9:1.1));
   cam.setZoom(z);cam.scrollX=world.x-screenPoint.x/z;cam.scrollY=world.y-screenPoint.y/z;changed(true);
 }
 function cancel(){s.mode="IDLE";s.primary=null;s.start=null;s.pinch=null;s.moved=false}
 scene.input.on("pointerdown",down);scene.input.on("pointermove",move);scene.input.on("pointerup",up);scene.input.on("pointerupoutside",up);scene.input.on("wheel",wheel);
 return{state:s,cancel,destroy(){scene.input.off("pointerdown",down);scene.input.off("pointermove",move);scene.input.off("pointerup",up);scene.input.off("pointerupoutside",up);scene.input.off("wheel",wheel)}};
}
window.BattleCameraController={create};
})();