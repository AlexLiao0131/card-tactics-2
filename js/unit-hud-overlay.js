import { TILE_SIZE,ELEVATION_HEIGHT,UNIT_VISUAL_HEIGHT } from "./coordinate-system.js";

const clamp01=value=>Math.max(0,Math.min(1,Number(value||0)));
// Temporary semantic pictograms. The status owner remains EffectEngine /
// WaterInteractionEngine; future PNGs replace only this presentation map.
const STATUS_PICTOGRAMS=Object.freeze({
  WATER_DROWNING:{symbol:"💧",kind:"water"},
  POISON:{symbol:"☠",kind:"poison"}, POISONED:{symbol:"☠",kind:"poison"},
  BURN:{symbol:"♨",kind:"fire"}, BURNING:{symbol:"♨",kind:"fire"},
  FREEZE:{symbol:"❄",kind:"ice"}, FROZEN:{symbol:"❄",kind:"ice"},
  STUN:{symbol:"✴",kind:"stun"}, STUNNED:{symbol:"✴",kind:"stun"},
  PARALYSIS:{symbol:"ϟ",kind:"stun"},
  SILENCE:{symbol:"⊘",kind:"silence"},
  SLOW:{symbol:"◷",kind:"slow"},
  BLIND:{symbol:"◌",kind:"blind"},
  BLEED:{symbol:"❢",kind:"bleed"}, BLEEDING:{symbol:"❢",kind:"bleed"},
  CURSE:{symbol:"☾",kind:"curse"}, FEAR:{symbol:"!",kind:"fear"},
  DEF_DOWN:{symbol:"↓",kind:"debuff"},
  DAMAGE_OVER_TIME:{symbol:"◆",kind:"debuff"},
  SHIELD:{symbol:"⬡",kind:"shield"},
  STEALTH:{symbol:"◈",kind:"stealth"},
  HEAL_OVER_TIME:{symbol:"✚",kind:"regen"},
  ATK_UP:{symbol:"↑",kind:"attack"},
  DEF_UP:{symbol:"▣",kind:"defense"},
  SPD_UP:{symbol:"»",kind:"speed"}
});
const STATUS_ICON_KEYS=Object.keys(STATUS_PICTOGRAMS);
function statusPictogram(effect){
  const positive=effect?.classification==="POSITIVE";
  const id=String(effect?.id||"").toUpperCase(),type=String(effect?.type||"").toUpperCase();
  const exact=STATUS_PICTOGRAMS[id];
  if(exact)return exact;
  if(positive){
    if(type==="SHIELD"||/SHIELD|GUARD|護盾|護甲/.test(id))return STATUS_PICTOGRAMS.SHIELD;
    if(type==="HEAL_OVER_TIME"||/HEAL|REGEN|RECOVER|治療|恢復/.test(id))return STATUS_PICTOGRAMS.HEAL_OVER_TIME;
    if(type==="STEALTH"||/STEALTH|INVIS|隱形|潛行/.test(id))return STATUS_PICTOGRAMS.STEALTH;
    if(/ATTACK|ATK|POWER|攻擊/.test(id))return STATUS_PICTOGRAMS.ATK_UP;
    if(/DEFENSE|DEF|ARMOR|防禦/.test(id))return STATUS_PICTOGRAMS.DEF_UP;
    if(/SPEED|SPD|HASTE|迅捷/.test(id))return STATUS_PICTOGRAMS.SPD_UP;
    return{symbol:"✦",kind:"buff"};
  }
  // Specific status IDs win before generic EffectEngine types such as
  // DAMAGE_OVER_TIME. A future PNG asset will bind to the same semantic kind.
  const identified=STATUS_ICON_KEYS.find(name=>id.startsWith(name+"_")||id.endsWith("_"+name));
  if(identified)return STATUS_PICTOGRAMS[identified];
  const name=String(effect?.name||"");
  if(/溺水|沉沒|窒息/.test(name))return STATUS_PICTOGRAMS.WATER_DROWNING;
  if(/中毒|毒素/.test(name))return STATUS_PICTOGRAMS.POISON;
  if(/燃燒|灼燒/.test(name))return STATUS_PICTOGRAMS.BURN;
  if(/冰凍|凍結/.test(name))return STATUS_PICTOGRAMS.FROZEN;
  if(/暈眩|昏迷/.test(name))return STATUS_PICTOGRAMS.STUN;
  if(/流血|撕裂/.test(name))return STATUS_PICTOGRAMS.BLEED;
  return STATUS_PICTOGRAMS[type]||{symbol:"◆",kind:"debuff"};
}
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
    this.hudUnitId=null;
    this.floats=[];

    const battleScreen=document.getElementById("battleScreen");
    if(!battleScreen)throw new Error("UnitHudOverlay requires #battleScreen.");
    this.root=createElement("div","unit-hud-layer");
    this.root.setAttribute("aria-hidden","true");
    battleScreen.appendChild(this.root);

    // The input controller owns pointer lifetime. A simple tap may select or
    // inspect a unit, but can never leave a floating HUD covering the map.
    this.onHold=event=>{
      const x=event.detail?.x,y=event.detail?.y;
      const unit=Number.isFinite(x)&&Number.isFinite(y)
        ?this.units.find(candidate=>candidate.x===x&&candidate.y===y)
        :null;
      this.hudUnitId=unit?.id||null;
      this.applyVisibility();
      this.updateFrame();
    };
    window.addEventListener("cardtactics:unit-hud-hold",this.onHold);
  }

  createHud(unit){
    const node=createElement("div","unit-hud");
    const row=createElement("div","unit-hud-row");
    const name=createElement("strong","unit-hud-name");
    const hpRow=createElement("div","unit-hud-vital-row unit-hud-hp-row");
    const hpIcon=createElement("span","unit-hud-orb unit-hud-orb-hp");
    hpIcon.setAttribute("aria-hidden","true");
    const hp=createElement("span","unit-hud-hp");
    const track=createElement("div","unit-hud-track unit-hud-hp-track");
    const fill=createElement("i","unit-hud-fill unit-hud-hp-fill");
    const manaRow=createElement("div","unit-hud-vital-row unit-hud-mana-row");
    const manaIcon=createElement("span","unit-hud-orb unit-hud-orb-mp");
    manaIcon.setAttribute("aria-hidden","true");
    const mana=createElement("span","unit-hud-mana");
    const manaTrack=createElement("div","unit-hud-track unit-hud-mana-track");
    const manaFill=createElement("i","unit-hud-fill unit-hud-mana-fill");
    const resourceBox=createElement("div","unit-hud-resource-box");
    const statuses=createElement("div","unit-hud-statuses");
    statuses.setAttribute("aria-label","目前增益與異常狀態");
    const portrait=createElement("div","unit-hud-portrait");
    const image=createElement("img","unit-hud-portrait-image");
    image.alt="";image.draggable=false;image.decoding="async";image.loading="lazy";
    const fallback=createElement("span","unit-hud-portrait-fallback");
    fallback.textContent="◆";
    image.hidden=true;
    image.onload=()=>{image.hidden=false;fallback.hidden=true;};
    image.onerror=()=>{image.hidden=true;fallback.hidden=false;};
    portrait.append(image,fallback);
    const details=createElement("div","unit-hud-details");
    row.appendChild(name);
    hpRow.append(hpIcon,hp);
    track.appendChild(fill);
    manaRow.append(manaIcon,mana);
    manaTrack.appendChild(manaFill);
    details.append(row,hpRow,track,manaRow,manaTrack,resourceBox,statuses);
    node.append(portrait,details);
    this.root.appendChild(node);
    const hud={node,name,hp,fill,manaRow,mana,manaTrack,manaFill,resourceBox,statuses,image,fallback,portraitPath:undefined,key:""};
    this.nodes.set(unit.id,hud);
    return hud;
  }

  updateContent(hud,unit){
    const hp=Math.max(0,Number(unit.hp||0));
    const maxHp=Math.max(1,Number(unit.maxHp||hp||1));
    const pct=clamp01(hp/maxHp);
    const mana=Math.max(0,Number(unit.mana||0)),maxMana=Math.max(0,Number(unit.maxMana||0)),manaPct=maxMana>0?clamp01(mana/maxMana):0;
    const resources=unit.resources||{},resourceKey=Object.entries(resources).map(([id,r])=>`${id}:${r.value}/${r.max}`).join("|");
    const picture=globalThis.VisualDatabase?.characterHudPortrait?.(unit.characterId)||null;
    if(hud.portraitPath!==picture){
      hud.portraitPath=picture;
      // Show an immediate fallback until the full illustration is decoded.
      // Loading starts eagerly only for the actually held unit; other units
      // keep their existing lazy portrait state to avoid mobile memory spikes.
      hud.image.hidden=true;hud.fallback.hidden=false;
      if(picture)hud.image.src=new URL(picture,document.baseURI).href;
      else hud.image.removeAttribute("src");
      hud.fallback.textContent=String(unit.name||"◆").slice(0,1);
    }
    const indicators=globalThis.UnitAnimationEngine?.statusIndicators?.(unit)||[];
    const statusKey=indicators.map(effect=>`${effect.id}:${effect.classification}:${effect.name}:${effect.remaining??""}`).join("|");
    const key=`${unit.name}|${hp}|${maxHp}|${mana}|${maxMana}|${resourceKey}|${statusKey}|${unit.team}|${unit.finished?1:0}`;
    if(hud.key===key)return;
    hud.key=key;
    hud.name.textContent=String(unit.name||unit.id||"UNIT");
    hud.hp.textContent=`${hp}/${maxHp}`;
    hud.fill.style.width=`${Math.round(pct*10000)/100}%`;
    const showMana=maxMana>0;
    hud.manaRow.hidden=!showMana;hud.manaTrack.hidden=!showMana;
    if(showMana){hud.mana.textContent=`${Math.round(mana)}/${Math.round(maxMana)}`;hud.manaFill.style.width=`${Math.round(manaPct*10000)/100}%`;}
    hud.resourceBox.replaceChildren();
    for(const[id,resource]of Object.entries(resources)){
      const value=Math.max(0,Number(resource?.value||0)),max=Math.max(0,Number(resource?.max||0));if(max<=0)continue;
      const wrap=createElement("div","unit-hud-resource"),label=createElement("div","unit-hud-mana-row"),track=createElement("div","unit-hud-track unit-hud-mana-track"),fill=createElement("i","unit-hud-fill unit-hud-mana-fill");
      label.textContent=`${resource?.label||id.toUpperCase()} ${Math.round(value)}/${Math.round(max)}`;
      fill.style.width=`${Math.round(clamp01(value/max)*10000)/100}%`;
      fill.style.background="#8d5bd6";
      track.appendChild(fill);wrap.append(label,track);hud.resourceBox.appendChild(wrap);
    }
    hud.statuses.replaceChildren();
    for(const effect of indicators){
      const graphic=statusPictogram(effect);
      const chip=createElement("span","unit-hud-status");
      chip.dataset.statusKind=graphic.kind;
      chip.textContent=graphic.symbol;
      // Only the icon is visible; naming and duration remain available as
      // accessible metadata and can later accompany a dedicated PNG.
      const detail=effect.remaining==null?effect.name:`${effect.name}｜剩餘 ${effect.remaining} 回合`;
      chip.title=detail;
      chip.setAttribute("role","img");
      chip.setAttribute("aria-label",detail);
      hud.statuses.appendChild(chip);
    }
    hud.statuses.hidden=indicators.length===0;
    hud.node.dataset.team=String(unit.team||"NEUTRAL");
    hud.node.classList.toggle("finished",!!unit.finished);
    hud.fill.classList.toggle("warn",pct<=.5&&pct>.25);
    hud.fill.classList.toggle("danger",pct<=.25);
  }

  applyVisibility(){
    for(const[id,hud]of this.nodes){
      hud.node.hidden=id!==this.hudUnitId;
      // Loading a full-size card painting while hidden is deliberately lazy.
      // Once a long hold selects it, request the real portrait immediately.
      if(id===this.hudUnitId&&hud.portraitPath)hud.image.loading="eager";
    }
  }

  presentEvents(events){
    const now=performance.now();
    const living=new Set(this.units.map(unit=>String(unit.id)));
    for(const event of events||[]){
      if(event?.type!=="UNIT_FLOAT_TEXT"||!event.unitId)continue;
      // The snapshot is already filtered by TacticalEngine visibility.
      if(!living.has(String(event.unitId))&&!event.afterDeath)continue;
      const outcomes={MISS:"miss",DODGE:"dodge",BLOCK:"block",PARRY:"parry",GRAZE:"graze"};
      const kind=outcomes[event.kind]||
        (event.kind==="DOT"?"dot":event.kind==="HEAL"?"heal":event.kind==="STATUS"?"status":event.kind==="CRITICAL"?"critical":"damage");
      const text=outcomes[event.kind]?event.kind:
        kind==="dot"?`${String(event.label||"持續傷害")} -${Math.round(Number(event.value)||0)}`:
        kind==="heal"?`+${Math.round(Number(event.value)||0)}`:
        kind==="status"?String(event.value||""):`-${Math.round(Number(event.value)||0)}`;
      if(!text||text==="+0"||text==="-0")continue;
      const node=createElement("span",`unit-float-text unit-float-${kind}`);
      node.textContent=text;
      this.root.appendChild(node);
      const stack=Math.min(3,this.floats.filter(item=>item.unitId===event.unitId&&now-item.start<260).length);
      this.floats.push({node,unitId:event.unitId,x:event.x,y:event.y,
        renderZ:event.renderZ,afterDeath:!!event.afterDeath,start:now,stack,
        lifetime:kind==="status"?1400:kind==="critical"?1250:kind==="dot"?1350:1100});
    }
    // Bound DOM work under AoE and mass-status effects; never retain old nodes.
    while(this.floats.length>40)this.floats.shift().node.remove();
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
      hud.node.remove();this.nodes.delete(id);
      if(this.hudUnitId===id)this.hudUnitId=null;
    }
    const living=new Set(this.units.map(unit=>String(unit.id)));
    this.floats=this.floats.filter(item=>{
      if(item.afterDeath||living.has(String(item.unitId)))return true;
      item.node.remove();return false;
    });
    this.applyVisibility();this.updateFrame();
  }

  updateFrame(){
    if(!this.root.isConnected||!this.camera)return;
    // No expanded long-hold and no transient text means there is nothing
    // to project. Avoid repeated DOM layout reads and world-space projection
    // on every Babylon frame when the tactical HUD is dormant.
    if(this.hudUnitId==null&&this.floats.length===0)return;
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
      const hud=this.nodes.get(unit.id);if(!hud)continue;
      if(unit.id!==this.hudUnitId){hud.node.hidden=true;continue;}
      const world=new BABYLON.Vector3(Number(unit.x)*TILE_SIZE,Number(unit.renderZ??unit.z??0)*ELEVATION_HEIGHT+UNIT_VISUAL_HEIGHT+.52,Number(unit.y)*TILE_SIZE);
      const projected=BABYLON.Vector3.Project(world,BABYLON.Matrix.Identity(),transform,viewport);
      const x=offsetX+projected.x*scaleX,y=offsetY+projected.y*scaleY;
      const visible=projected.z>=0&&projected.z<=1&&x>-180&&x<rootRect.width+180&&y>-100&&y<rootRect.height+100;
      hud.node.hidden=!visible;
      if(!visible)continue;
      hud.node.style.transform=`translate3d(${Math.round(x)}px,${Math.round(y)}px,0) translate(-50%,-100%)`;
    }
    if(!this.floats.length)return;
    const now=performance.now(),retained=[];
    for(const item of this.floats){
      const elapsed=now-item.start;
      if(elapsed>=item.lifetime){item.node.remove();continue;}
      const progress=Math.max(0,elapsed/item.lifetime);
      const world=new BABYLON.Vector3(Number(item.x)*TILE_SIZE,
        Number(item.renderZ||0)*ELEVATION_HEIGHT+UNIT_VISUAL_HEIGHT+.73,
        Number(item.y)*TILE_SIZE);
      const projected=BABYLON.Vector3.Project(world,BABYLON.Matrix.Identity(),transform,viewport);
      if(projected.z<0||projected.z>1){item.node.hidden=true;retained.push(item);continue;}
      const x=offsetX+projected.x*scaleX,y=offsetY+projected.y*scaleY;
      item.node.hidden=x<-100||x>rootRect.width+100||y<-100||y>rootRect.height+100;
      item.node.style.opacity=String(Math.min(1,(1-progress)*2));
      item.node.style.transform=`translate3d(${Math.round(x)}px,${Math.round(y-12-48*progress-item.stack*16)}px,0) translate(-50%,-100%)`;
      retained.push(item);
    }
    this.floats=retained;
  }

  diagnostics(){return{count:this.nodes.size,expandedUnitId:this.hudUnitId,activeFloats:this.floats.length};}
  dispose(){
    window.removeEventListener("cardtactics:unit-hud-hold",this.onHold);
    this.root.remove();this.nodes.clear();this.units=[];this.hudUnitId=null;this.floats=[];
  }
}
