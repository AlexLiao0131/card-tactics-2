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
// HUD is a presentation consumer of the existing EquipmentDatabase and
// VisualDatabase. The paths are stable PNG entry points, not generated assets.
// Missing PNGs keep a simple typographic fallback without broken-image boxes.
const EQUIPMENT_FALLBACK=Object.freeze({
  "weapon-bow":"弓","weapon-sword":"劍","weapon-polearm":"槍",
  "weapon-hammer":"錘","weapon-staff":"杖","weapon-knife":"刀",
  "weapon-trident":"戟","weapon-greatsword":"巨","weapon-rapier":"刺",
  "weapon-claw":"爪","weapon-club":"棍","weapon-weapon":"武",
  "armor-light":"輕","armor-medium":"中","armor-heavy":"重",
  "armor-none":"無","shield":"盾","accessory":"飾"
});
function weaponIconKind(weapon){
  const declared=String(weapon?.weaponKind||"").toUpperCase();
  if(declared)return declared;
  // These two legacy equipment definitions have no weaponKind field.
  if(weapon?.id==="forest_claw")return"CLAW";
  if(weapon?.id==="training_club")return"CLUB";
  return"WEAPON";
}
function equipmentIcons(unit){
  const live=globalThis.UnitRuntimeEngine?.getLiveUnit?.(unit.id);
  const character=live?.character||unit.character;
  if(!character)return[];
  const icons=[],seen=new Set();
  const append=(item,group,key,label,typeLabel="")=>{
    if(!item||seen.has(item.id||item))return;
    seen.add(item.id||item);
    icons.push({group,key,name:item.name||label,label,typeLabel});
  };
  for(const weapon of Object.values(character.weapons||{}).filter(Boolean)){
    const key=`weapon-${weaponIconKind(weapon).toLowerCase()}`;
    append(weapon,"weapon",key,EQUIPMENT_FALLBACK[key]||"武");
  }
  const armor=character.armor;
  if(armor){
    const kind=String(armor.type||armor.types?.[0]||"NONE").toLowerCase();
    const normalized=["light","medium","heavy"].includes(kind)?kind:"none";
    const label={light:"輕甲",medium:"中甲",heavy:"重甲",none:"無甲"}[normalized];
    append(armor,"armor",`armor-${normalized}`,EQUIPMENT_FALLBACK[`armor-${normalized}`],label);
  }
  for(const item of [...(character.equipment||[]),character.guard].filter(Boolean)){
    const isShield=item.defenseProfiles?.some(profile=>profile.method==="GUARD")||item.id?.includes("shield")||item.id==="buckler";
    const key=isShield?"shield":"accessory";
    append(item,"other",key,isShield?"盾":"飾");
  }
  return icons;
}
function iconAsset(group,key){
  const override=globalThis.VisualDatabase?.asset?.(group,key,"hudIcon");
  if(override)return override;
  const category=group==="equipment"?"equipment":"status";
  return`assets/images/ui/icons/${category}/${key}.png`;
}

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
    this.inspectorUnitId=null;
    this.failedIcons=new Set();

    const battleScreen=document.getElementById("battleScreen");
    if(!battleScreen)throw new Error("UnitHudOverlay requires #battleScreen.");
    this.root=createElement("div","unit-hud-layer");
    this.root.setAttribute("aria-hidden","true");
    battleScreen.appendChild(this.root);

    // BattleUI owns the sole character-detail panel. UnitHudOverlay owns the
    // portrait, HP/MP, equipment and status contents rendered INSIDE it.
    // The battlefield overlay itself is only for damage/outcome float text.
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
    const equipment=createElement("div","unit-hud-equipment");
    equipment.setAttribute("aria-label","武器、護甲與其他裝備");
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
    const statusSection=createElement("section","unit-hud-equipment-row unit-hud-effects-row");
    const statusLabel=createElement("span","unit-hud-equipment-label");statusLabel.textContent="狀態";
    statusSection.append(statusLabel,statuses);
    details.append(row,hpRow,track,manaRow,manaTrack,resourceBox,equipment,statusSection);
    node.append(portrait,details);
    this.root.appendChild(node);
    const hud={node,name,hp,fill,manaRow,mana,manaTrack,manaFill,resourceBox,equipment,statuses,statusSection,image,fallback,portraitPath:undefined,key:""};
    this.nodes.set(unit.id,hud);
    return hud;
  }

  makeIcon(key,label,name,kind="equipment"){
    const item=createElement("span",kind==="status"?"unit-hud-status":"unit-hud-equipment-slot");
    const image=createElement("img","unit-hud-icon-image");
    const fallback=createElement("span","unit-hud-icon-fallback");
    const src=iconAsset(kind==="status"?"effects":"equipment",key);
    image.alt="";image.draggable=false;image.hidden=true;
    image.dataset.iconSource=src;
    fallback.textContent=label;
    item.title=name;item.setAttribute("role","img");item.setAttribute("aria-label",name);
    image.onload=()=>{image.hidden=false;fallback.hidden=true;};
    image.onerror=()=>{this.failedIcons.add(src);image.hidden=true;fallback.hidden=false;};
    item.append(image,fallback);
    return item;
  }

  // Only a held HUD requests its PNGs. Do not load 10+ missing PNGs per unit
  // when a large army is initialized. The fallback is always available.
  loadIcons(hud){
    for(const image of hud.node.querySelectorAll("img[data-icon-source]")){
      if(image.dataset.iconRequested==="1")continue;
      image.dataset.iconRequested="1";
      const src=image.dataset.iconSource;
      if(src&&!this.failedIcons.has(src))image.src=new URL(src,document.baseURI).href;
    }
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
    const equipped=equipmentIcons(unit);
    const equipKey=equipped.map(item=>`${item.group}:${item.key}:${item.name}`).join("|");
    const key=`${unit.name}|${hp}|${maxHp}|${mana}|${maxMana}|${resourceKey}|${equipKey}|${statusKey}|${unit.team}|${unit.finished?1:0}`;
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
    hud.equipment.replaceChildren();
    for(const [group,label] of [["weapon","武器"],["armor","護甲"],["other","裝備"]]){
      const items=equipped.filter(item=>item.group===group);
      if(!items.length)continue;
      const row=createElement("section","unit-hud-equipment-row");
      const heading=createElement("span","unit-hud-equipment-label");heading.textContent=label;
      const icons=createElement("div","unit-hud-equipment-icons");
      for(const item of items){
        const slot=this.makeIcon(item.key,item.label,item.name);
        if(group==="armor"){
          const type=createElement("span","unit-hud-armor-label");type.textContent=item.typeLabel;
          slot.appendChild(type);
        }
        icons.appendChild(slot);
      }
      row.append(heading,icons);hud.equipment.appendChild(row);
    }
    hud.statuses.replaceChildren();
    for(const effect of indicators){
      const graphic=statusPictogram(effect);
      const detail=effect.remaining==null?effect.name:`${effect.name}｜剩餘 ${effect.remaining} 回合`;
      const chip=this.makeIcon(graphic.kind,graphic.symbol,detail,"status");
      chip.dataset.statusKind=graphic.kind;
      hud.statuses.appendChild(chip);
    }
    hud.statusSection.hidden=indicators.length===0;
    hud.node.dataset.team=String(unit.team||"NEUTRAL");
    hud.node.classList.toggle("finished",!!unit.finished);
    hud.fill.classList.toggle("warn",pct<=.5&&pct>.25);
    hud.fill.classList.toggle("danger",pct<=.25);
  }

  // A single physical HUD node moves between its dormant float layer and the
  // canonical inspector. No cloned portrait, bars or effects can diverge.
  mountInInspector(unitId,host){
    this.releaseInspectorHud();
    if(!host)return false;
    const unit=this.units.find(candidate=>candidate.id===unitId);
    if(!unit)return false;
    const hud=this.nodes.get(unitId)||this.createHud(unit);
    this.updateContent(hud,unit);
    host.appendChild(hud.node);
    hud.node.style.removeProperty("transform");
    this.inspectorUnitId=unitId;
    this.hudUnitId=unitId;
    this.applyVisibility();
    return true;
  }
  releaseInspectorHud(){
    const hud=this.nodes.get(this.inspectorUnitId);
    if(hud){
      hud.node.hidden=true;
      hud.node.style.removeProperty("transform");
      if(this.root.isConnected)this.root.appendChild(hud.node);
    }
    this.inspectorUnitId=null;
    this.hudUnitId=null;
    this.applyVisibility();
  }
  applyVisibility(){
    for(const [id,hud] of this.nodes){
      hud.node.hidden=id!==this.inspectorUnitId;
      if(id===this.inspectorUnitId){
        if(hud.portraitPath)hud.image.loading="eager";
        this.loadIcons(hud);
      }
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
      if(this.inspectorUnitId===id){this.inspectorUnitId=null;this.hudUnitId=null;}
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
    if(!this.floats.length)return;
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
    this.releaseInspectorHud();
    this.root.remove();this.nodes.clear();this.units=[];this.hudUnitId=null;this.inspectorUnitId=null;this.floats=[];this.failedIcons.clear();
  }
}
