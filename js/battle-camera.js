import { TILE_SIZE } from "./coordinate-system.js";

const BASE_ALPHA=-Math.PI/4;
const ISO_BETA=Math.PI/3.2;
const TOP_BETA=.035;
const ZOOM_MIN=.32;
const ZOOM_MAX=5.5;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function mapInfo(state){
  const map=state?.map||state?.grid||{};
  return {
    id:String(map.id||`${map.width||8}x${map.height||6}`),
    width:Number(map.width||8),
    height:Number(map.height||6)
  };
}

function averagePoint(points=[]){
  if(!points.length)return null;
  const total=points.reduce((sum,p)=>({x:sum.x+Number(p.x||0),y:sum.y+Number(p.y||0)}),{x:0,y:0});
  return{x:total.x/points.length,y:total.y/points.length};
}

export function battleSideAnchors(state){
  const cores=state?.cores||[];
  const playerCore=cores.find(core=>core.owner==="PLAYER");
  const enemyCore=cores.find(core=>core.owner==="ENEMY");
  if(playerCore&&enemyCore)return{
    player:{x:Number(playerCore.x||0),y:Number(playerCore.y||0)},
    enemy:{x:Number(enemyCore.x||0),y:Number(enemyCore.y||0)}
  };

  const points=state?.presentation?.deploymentPoints||[];
  const playerArea=points.filter(point=>point.owner==="PLAYER").flatMap(point=>point.area||[]);
  const enemyArea=points.filter(point=>point.owner==="ENEMY").flatMap(point=>point.area||[]);
  const player=averagePoint(playerArea),enemy=averagePoint(enemyArea);
  if(player&&enemy)return{player,enemy};
  return null;
}

function horizontalScreenAxis(alpha){
  // ArcRotateCamera looks from azimuth alpha toward the target.
  // This is the world-space vector that points to screen-right on the ground plane.
  return{x:Math.sin(alpha),y:-Math.cos(alpha)};
}

export function homeQuarterTurnForState(state){
  const anchors=battleSideAnchors(state);
  if(!anchors)return 2;

  const dx=(anchors.player.x-anchors.enemy.x)*TILE_SIZE;
  const dz=(anchors.player.y-anchors.enemy.y)*TILE_SIZE;
  let best=0,bestScore=Infinity;
  for(let q=0;q<4;q++){
    const alpha=BASE_ALPHA+q*Math.PI/2;
    const right=horizontalScreenAxis(alpha);
    const screenDelta=dx*right.x+dz*right.y;
    // Choose the quarter-turn that places PLAYER furthest to screen-left of ENEMY.
    if(screenDelta<bestScore){bestScore=screenDelta;best=q;}
  }
  return best;
}

export class BattleCamera{
  constructor(scene,canvas,state){
    this.scene=scene;
    this.canvas=canvas;
    this.projection="ISO";
    this.homeProjection="ISO";
    this.quarterTurns=0;
    this.homeQuarterTurns=0;
    this.zoom=1;
    this.mapKey="";
    this.baseTarget=BABYLON.Vector3.Zero();
    this.panOffset=BABYLON.Vector3.Zero();

    this.camera=new BABYLON.ArcRotateCamera(
      "battleCamera",
      BASE_ALPHA,
      ISO_BETA,
      24,
      BABYLON.Vector3.Zero(),
      scene
    );
    this.camera.mode=BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.lowerRadiusLimit=this.camera.upperRadiusLimit=24;
    this.camera.inputs.clear();
    this.sync(state);
  }

  panByPixels(dx,dy){
    dx=Number(dx||0);dy=Number(dy||0);
    if(!dx&&!dy)return false;

    const rect=this.canvas.getBoundingClientRect();
    const cssW=Math.max(1,rect.width),cssH=Math.max(1,rect.height);
    const worldW=Math.max(.001,this.camera.orthoRight-this.camera.orthoLeft);
    const worldH=Math.max(.001,this.camera.orthoTop-this.camera.orthoBottom);
    const alpha=this.camera.alpha,beta=this.camera.beta;

    // Ground-plane basis derived from the actual camera azimuth.
    // Horizontal drag maps to screen-right; vertical drag maps to screen-up projected onto the board.
    const screenRight=new BABYLON.Vector3(Math.sin(alpha),0,-Math.cos(alpha));
    const groundForward=new BABYLON.Vector3(-Math.cos(alpha),0,-Math.sin(alpha));
    const horizontalScale=worldW/cssW;
    const verticalProjection=Math.max(.12,Math.abs(Math.cos(beta)));
    const verticalScale=(worldH/cssH)/verticalProjection;

    // Camera target moves opposite the drag vector, so the board itself follows the finger/mouse.
    this.panOffset.addInPlace(screenRight.scale(-dx*horizontalScale));
    this.panOffset.addInPlace(groundForward.scale(dy*verticalScale));
    this.apply();
    this.emitView();
    return true;
  }

  setZoom(value){
    const next=clamp(Number(value)||1,ZOOM_MIN,ZOOM_MAX);
    if(Math.abs(next-this.zoom)<.0001)return false;
    this.zoom=next;
    this.apply();
    this.emitView();
    return true;
  }

  zoomBy(factor){return this.setZoom(this.zoom*Number(factor||1));}

  sync(state){
    const info=mapInfo(state),key=`${info.id}|${info.width}x${info.height}`;
    if(key!==this.mapKey){
      this.mapKey=key;
      this.info=info;
      this.baseTarget=new BABYLON.Vector3(
        ((info.width-1)*TILE_SIZE)/2,
        0,
        ((info.height-1)*TILE_SIZE)/2
      );
      this.homeQuarterTurns=homeQuarterTurnForState(state);
      this.restoreHomeView(false);
      return;
    }

    this.info=info;
    // Keep the chosen orientation stable during a battle, but refresh the home side
    // if a late snapshot supplies the side anchors that were absent at construction.
    const nextHome=homeQuarterTurnForState(state);
    if(!Number.isNaN(nextHome))this.homeQuarterTurns=nextHome;
    this.apply();
  }

  restoreHomeView(emit=true){
    this.projection=this.homeProjection;
    this.quarterTurns=this.homeQuarterTurns;
    this.panOffset=BABYLON.Vector3.Zero();
    this.zoom=1;
    this.apply();
    if(emit)this.emitView();
  }

  apply(){
    const info=this.info||{width:8,height:6};
    this.camera.alpha=BASE_ALPHA+this.quarterTurns*Math.PI/2;
    this.camera.beta=this.projection==="TOP"?TOP_BETA:ISO_BETA;

    const aspect=Math.max(
      .5,
      this.camera.getEngine().getRenderWidth()/Math.max(1,this.camera.getEngine().getRenderHeight())
    );
    const isoBase=Math.max(8,(info.width+info.height)*TILE_SIZE*.27);
    const topBase=Math.max(7,Math.max(info.height,info.width/aspect)*TILE_SIZE*.62);
    const vertical=(this.projection==="TOP"?topBase:isoBase)/this.zoom;

    this.camera.orthoTop=vertical;
    this.camera.orthoBottom=-vertical;
    this.camera.orthoLeft=-vertical*aspect;
    this.camera.orthoRight=vertical*aspect;
    this.camera.setTarget(this.baseTarget.add(this.panOffset));
    this.scene.render();
  }

  rotate(delta=1){
    this.quarterTurns=((this.quarterTurns+Number(delta||0))%4+4)%4;
    this.apply();this.emitView();return this.quarterTurns;
  }

  setProjection(mode){
    const next=mode==="TOP"?"TOP":"ISO";
    if(next===this.projection)return false;
    this.projection=next;
    this.apply();this.emitView();return true;
  }

  toggleProjection(){return this.setProjection(this.projection==="ISO"?"TOP":"ISO");}
  resetView(){this.restoreHomeView(true);}

  getViewState(){
    return{
      projection:this.projection,
      rotation:this.quarterTurns,
      homeRotation:this.homeQuarterTurns,
      zoom:this.zoom,
      zoomMin:ZOOM_MIN,
      zoomMax:ZOOM_MAX
    };
  }

  emitView(){
    window.dispatchEvent(new CustomEvent("cardtactics:view-change",{detail:this.getViewState()}));
  }
}
