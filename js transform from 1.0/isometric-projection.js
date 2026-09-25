(()=>{
"use strict";
function rotated(x,y,m,r=0){const q=((r%4)+4)%4;if(q===0)return{x,y,w:m.width,h:m.height};if(q===1)return{x:m.height-1-y,y:x,w:m.height,h:m.width};if(q===2)return{x:m.width-1-x,y:m.height-1-y,w:m.width,h:m.height};return{x:y,y:m.width-1-x,w:m.height,h:m.width}}
function grid(x,y,m,r=0){const p=rotated(x,y,m,r);return{u:p.y,v:p.w-1-p.x}}
function point(x,y,e,m,o){const g=grid(x,y,m,o.rotation);if(o.projection==="TOP"){const z=76;return{x:g.u*z,y:g.v*z}}return{x:(g.u-g.v)*o.tw/2,y:(g.u+g.v)*o.th/2-Number(e||0)*o.eh}}
function corners(p,o){if(o.projection==="TOP"){const h=38;return[{x:p.x-h,y:p.y-h},{x:p.x+h,y:p.y-h},{x:p.x+h,y:p.y+h},{x:p.x-h,y:p.y+h}]}return[{x:p.x,y:p.y-o.th/2},{x:p.x+o.tw/2,y:p.y},{x:p.x,y:p.y+o.th/2},{x:p.x-o.tw/2,y:p.y}]}
function projectedEdge(worldEdge,rotation=0){return (worldEdge+((rotation%4)+4)%4)%4}
function rowDepth(x,y,m,o){return 1000+point(x,y,0,m,o).y*10}
function renderOrder(x,y,m,o){const g=grid(x,y,m,o.rotation);return g.u+g.v}
function topDepth(tile,m,o){return 1000+renderOrder(tile.x,tile.y,m,o)*100+50}
function occupantDepth(tile,m,o){return 1000+renderOrder(tile.x,tile.y,m,o)*100+90}
function faceDepth(face,m,o){
  const e=projectedEdge(face.edge,o.rotation),owner=renderOrder(face.x,face.y,m,o);
  const layer=Math.max(0,Number(face.bottomElevation||0));
  return 1000+owner*100+(e===1?70:80)+layer*.01;
}
window.IsometricProjection={rotated,grid,point,corners,projectedEdge,rowDepth,renderOrder,topDepth,occupantDepth,faceDepth};
})();