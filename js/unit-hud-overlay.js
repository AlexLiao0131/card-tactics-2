import { TILE_SIZE,ELEVATION_HEIGHT,UNIT_VISUAL_HEIGHT } from "./coordinate-system.js";

const clamp01=value=>Math.max(0,Math.min(1,Number(value||0)));

function createElement(tag,className){
  const node=document.createElement(tag);
  if(className)node.className=className;
  return node;
}

export class UnitHudOverlay{
  constructor(scene,engine,canvas,camera){
    this.scene=scene;
    this.engine=engine;
    this.canvas=canvas;
    this.camera=camera;
    this.units=[];
    this.nodes=new Map();

    const battleScreen=document.getElementById("battleScreen");
    if(!battleScreen)throw new Error("UnitHudOverlay requires #battleScreen.");

    this.root=createElement("div","unit-hud-layer");
    this.root.setAttribute("aria-hidden","true");
    battleScreen.appendChild(this.root);
  }

  createHud(unit){
    const node=createElement("div","unit-hud");
    const row=createElement("div","unit-hud-row");
    const name=createElement("strong","unit-hud-name");
    const hp=createElement("span","unit-hud-hp");
    const track=createElement("div","unit-hud-track");
    const fill=createElement("i","unit-hud-fill");

    row.append(name,hp);
    track.appendChild(fill);
    node.append(row,track);
    this.root.appendChild(node);

    const hud={node,name,hp,fill,key:""};
    this.nodes.set(unit.id,hud);
    return hud;
  }

  updateContent(hud,unit){
    const hp=Math.max(0,Number(unit.hp||0));
    const maxHp=Math.max(1,Number(unit.maxHp||hp||1));
    const pct=clamp01(hp/maxHp);
    const key=`${unit.name}|${hp}|${maxHp}|${unit.team}|${unit.finished?1:0}`;
    if(hud.key===key)return;
    hud.key=key;

    hud.name.textContent=String(unit.name||unit.id||"UNIT");
    hud.hp.textContent=`HP ${hp}/${maxHp}`;
    hud.fill.style.width=`${Math.round(pct*10000)/100}%`;

    hud.node.dataset.team=String(unit.team||"NEUTRAL");
    hud.node.classList.toggle("finished",!!unit.finished);
    hud.fill.classList.toggle("warn",pct<=.5&&pct>.25);
    hud.fill.classList.toggle("danger",pct<=.25);
  }

  sync(state){
    this.units=[...(state?.units||[])];
    const alive=new Set();

    for(const unit of this.units){
      alive.add(unit.id);
      const hud=this.nodes.get(unit.id)||this.createHud(unit);
      this.updateContent(hud,unit);
    }

    for(const[id,hud]of this.nodes){
      if(alive.has(id))continue;
      hud.node.remove();
      this.nodes.delete(id);
    }

    this.updateFrame();
  }

  updateFrame(){
    if(!this.root.isConnected||!this.camera)return;

    const renderWidth=Math.max(1,this.engine.getRenderWidth());
    const renderHeight=Math.max(1,this.engine.getRenderHeight());
    const viewport=this.camera.viewport.toGlobal(renderWidth,renderHeight);
    const transform=this.scene.getTransformMatrix();

    const canvasRect=this.canvas.getBoundingClientRect();
    const rootRect=this.root.getBoundingClientRect();
    const scaleX=canvasRect.width/renderWidth;
    const scaleY=canvasRect.height/renderHeight;
    const offsetX=canvasRect.left-rootRect.left;
    const offsetY=canvasRect.top-rootRect.top;

    for(const unit of this.units){
      const hud=this.nodes.get(unit.id);
      if(!hud)continue;

      const world=new BABYLON.Vector3(
        Number(unit.x)*TILE_SIZE,
        Number(unit.renderZ??unit.z??0)*ELEVATION_HEIGHT+UNIT_VISUAL_HEIGHT+.52,
        Number(unit.y)*TILE_SIZE
      );
      const projected=BABYLON.Vector3.Project(
        world,
        BABYLON.Matrix.Identity(),
        transform,
        viewport
      );

      const x=offsetX+projected.x*scaleX;
      const y=offsetY+projected.y*scaleY;
      const visible=
        projected.z>=0&&projected.z<=1&&
        x>-180&&x<rootRect.width+180&&
        y>-100&&y<rootRect.height+100;

      hud.node.hidden=!visible;
      if(!visible)continue;

      // Screen-space DOM HUD: only translate position. It never inherits 3D rotation,
      // plane winding, camera pitch or billboard orientation.
      hud.node.style.transform=
        `translate3d(${Math.round(x)}px,${Math.round(y)}px,0) translate(-50%,-100%)`;
    }
  }

  diagnostics(){
    return{count:this.nodes.size};
  }

  dispose(){
    this.root.remove();
    this.nodes.clear();
    this.units=[];
  }
}
