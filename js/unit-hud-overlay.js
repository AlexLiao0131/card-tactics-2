import { TILE_SIZE,ELEVATION_HEIGHT,UNIT_VISUAL_HEIGHT } from "./coordinate-system.js";
import {visualManagerFor} from "./vfx-manager.js";

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
  VENGEANCE_SEAL:{symbol:"✥",kind:"debuff"},
  TEMPLAR_HP_LINK:{symbol:"⬡",kind:"shield"},
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
  const live=typeof document!=='undefined'&&document.body?.dataset?.battleMode==='PVP'
    ?null:globalThis.UnitRuntimeEngine?.getLiveUnit?.(unit.id);
  const character=live?.character||unit.character||
    globalThis.CharacterDatabase?.get?.(unit.characterId);
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
  const exact=STATUS_PICTOGRAMS[id]||(id.startsWith("VENGEANCE_SEAL:")?STATUS_PICTOGRAMS.VENGEANCE_SEAL:null);
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
    this.floatMapId=null;
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
    const materials=unit.materials||{},materialKey=Object.entries(materials).filter(([,n])=>Number(n)>0)
      .sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}:${v}`).join('|');
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
    const moon=unit.characterId==='avreshi'?(this.environmentState||globalThis.CardTacticsRuntime?.getEnvironmentState?.()):null;
    const moonState=moon?.timeOfDay==='NIGHT'?String(moon.moonlight||'NONE'):'DAY';
    const key=`${unit.name}|${hp}|${maxHp}|${mana}|${maxMana}|${resourceKey}|${materialKey}|${equipKey}|${statusKey}|${unit.team}|${unit.finished?1:0}|${moonState}`;
    if(hud.key===key)return;
    hud.key=key;
    hud.name.textContent=String(unit.name||unit.id||"UNIT");
    hud.hp.textContent=`${hp}/${maxHp}`;
    hud.fill.style.width=`${Math.round(pct*10000)/100}%`;
    const showMana=maxMana>0;
    hud.manaRow.hidden=!showMana;hud.manaTrack.hidden=!showMana;
    if(showMana){hud.mana.textContent=`${Math.round(mana)}/${Math.round(maxMana)}`;hud.manaFill.style.width=`${Math.round(manaPct*10000)/100}%`;}
    hud.resourceBox.replaceChildren();
    if(unit.characterId==='avreshi'){
      const moon=this.environmentState||globalThis.CardTacticsRuntime?.getEnvironmentState?.();
      const phase=moon?.timeOfDay!=='NIGHT'?'白天':moon?.moonlight==='FULL'?'滿月':moon?.moonlight==='PARTIAL'?'半月':'無月';
      const lunar=createElement('div','unit-hud-resource');
      lunar.dataset.resource='moon-phase';
      lunar.textContent=`☾ 月神祝福｜${phase}`;
      lunar.style.color='#e7edf5';
      lunar.style.textShadow='0 0 4px #cbd7eb';
      hud.resourceBox.appendChild(lunar);
    }
    for(const[id,resource]of Object.entries(resources)){
      const value=Math.max(0,Number(resource?.value||0)),max=Math.max(0,Number(resource?.max||0));if(max<=0)continue;
      const wrap=createElement("div","unit-hud-resource"),label=createElement("div","unit-hud-mana-row"),track=createElement("div","unit-hud-track unit-hud-mana-track"),fill=createElement("i","unit-hud-fill unit-hud-mana-fill");
      label.textContent=`${resource?.label||id.toUpperCase()} ${Math.round(value)}/${Math.round(max)}`;
      wrap.dataset.resource=id;
      if(id==="alchemyRune"){
        // ONE abdominal rune. The same picture is clipped from left to right
        // at 0%, 1/3, 2/3 and 100%, never rendered as three separate icons.
        const outer=createElement('div','unit-hud-alchemy-rune');
        outer.setAttribute('role','img');
        outer.setAttribute('aria-label',`單一煉成符文由左至右充能 ${value}/${max}`);
        outer.style.cssText='width:124px;height:80px;position:relative;overflow:hidden;';
        const uri=new URL('assets/ui/alchemy_rune.png',document.baseURI).href;
        const picture=()=>{
          const img=createElement('img','unit-hud-alchemy-rune-image');
          img.src=uri;img.alt='';img.setAttribute('aria-hidden','true');
          img.style.cssText='position:absolute;top:0;left:0;width:124px;height:80px;object-fit:contain;pointer-events:none;';
          return img;
        };
        const dim=picture();dim.style.opacity='.2';dim.style.filter='grayscale(.8)';
        const revealed=createElement('div','unit-hud-alchemy-rune-charged');
        revealed.style.cssText=`position:absolute;left:0;top:0;height:80px;overflow:hidden;width:${Math.round(clamp01(value/max)*100)}%;`;
        const lit=picture();lit.style.filter='drop-shadow(0 0 3px #ef72b8)';
        revealed.appendChild(lit);outer.append(dim,revealed);wrap.append(label,outer);
      }else if(id==="holyPower"){
        const orbs=createElement("div","unit-hud-holy-orbs");
        for(let i=0;i<max;i++){
          const orb=createElement("span",`unit-hud-holy-orb${i<value?" is-charged":""}`);
          orb.setAttribute("aria-label",`聖能第 ${i+1} 顆${i<value?"已充能":"未充能"}`);
          orbs.appendChild(orb);
        }
        wrap.append(label,orbs);
      }else{
        if(id==="reputation"){
          // This gauge is HOT PINK, not the shared MP/polarity purple default.
          const hotPink=String(resource?.color||"#EC4899");
          fill.style.setProperty("background",hotPink,"important");
          fill.style.setProperty("background-image","none","important");
          fill.style.setProperty("box-shadow",`0 0 7px ${hotPink}`,"important");
        }
        fill.style.width=`${Math.round(clamp01(value/max)*10000)/100}%`;
        track.appendChild(fill);wrap.append(label,track);
      }
      hud.resourceBox.appendChild(wrap);
    }
    // Material stock is NOT a scalar resource bar. A live, read-only inventory
    // comes from the same authoritative snapshot used by offline and PvP HUDs.
    // Never use ItemDatabase consumables or assume empty inventory is full.
    if(unit.characterId==='alchemist'){
      const names={HERB:'草本',WOOD:'木質',MINERAL:'礦質',CRYSTAL_SAND:'晶砂'},
        affinityNames={NATURE:'自然',WATER:'水',ICE:'冰',FIRE:'火',THUNDER:'雷',HOLY:'神聖',DARK:'闇',STONE:'岩'};
      const box=createElement('div','unit-hud-alchemy-materials');
      box.dataset.resource='alchemy-materials';
      box.style.cssText='display:grid;gap:3px;min-width:0;padding:6px 0;font-size:12px;line-height:1.4;';
      const heading=createElement('strong','unit-hud-alchemy-materials-title');
      heading.textContent='採集素材庫';box.appendChild(heading);
      for(const kind of Object.keys(names)){
        const normal=Math.max(0,Number(materials[`${kind}:NORMAL:NONE`]||0));
        const highs=Object.entries(materials).filter(([key,n])=>key.startsWith(`${kind}:HIGH:`)&&Number(n)>0)
          .sort(([a],[b])=>a.localeCompare(b));
        const line=createElement('div','unit-hud-alchemy-material-row');
        const detail=highs.map(([key,n])=>`${affinityNames[key.split(':')[2]]||key.split(':')[2]} ${Number(n)}`).join('、');
        line.textContent=`${names[kind]}｜普通 ${normal}${detail?`｜高品質 ${detail}`:''}`;
        if(highs.length)line.style.color='#b6e4ba';
        box.appendChild(line);
      }
      hud.resourceBox.appendChild(box);
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
    // The authoritative event stream is ordered. Link an actual result to the
    // committed attacking/casting action, NOT to an invented impact timer.
    // Some AoE executors emit their resolved hit *before* the visual action;
    // resolve associations across the WHOLE authoritative drain batch.
    const actions=(events||[]).filter(event=>event?.type==='UNIT_ANIMATION'&&
      event.skillId&&(event.state==='ATTACK'||event.state==='CAST'));
    for(const event of events||[]){
      if(event?.type!=="UNIT_FLOAT_TEXT"||!event.unitId)continue;
      // The snapshot is already filtered by TacticalEngine visibility.
      if(!living.has(String(event.unitId))&&!event.afterDeath)continue;
      const outcomes={MISS:"miss",DODGE:"dodge",BLOCK:"block",PARRY:"parry",GRAZE:"graze"};
      const kind=outcomes[event.kind]||
        (event.kind==="DOT"?"dot":event.kind==="HEAL_CRITICAL"?"heal-critical":event.kind==="HEAL"?"heal":event.kind==="STATUS"?"status":
        event.kind==="PHYSICAL_CRITICAL"?"physical-critical":event.kind==="MAGIC_CRITICAL"?"magic-critical":
        event.kind==="MAGIC_DAMAGE"?"magic-damage":event.kind==="PHYSICAL_DAMAGE"?"physical-damage":
        event.kind==="CRITICAL"?"critical":"damage");
      const text=outcomes[event.kind]?event.kind:
        kind==="dot"?`${String(event.label||"持續傷害")} -${Math.round(Number(event.value)||0)}`:
        (kind==="heal"||kind==="heal-critical")?`+${Math.round(Number(event.value)||0)}`:
        kind==="status"?String(event.value||""):`-${Math.round(Number(event.value)||0)}`;
      if(!text||text==="+0"||text==="-0")continue;
      const node=createElement("span",`unit-float-text unit-float-${kind}`);
      node.textContent=text;
      this.root.appendChild(node);
      // DoT and autonomous environment changes are not part of a fresh cast;
      // leave them immediate. Single-hit, ranged and AoE results share the
      // official caster animation/VFX sequence from this same drain batch.
      const animateResult=kind!=='dot'&&(event.skillId||outcomes[event.kind]);
      // Prefer the exact official attack receipt. Skill ID alone cannot
      // identify the correct contact of a multi-hit attack or dance followup.
      const linked=Number.isSafeInteger(event.actionSequence)
        ?actions.find(candidate=>candidate.sequence===event.actionSequence)||null:null;
      const action=animateResult?(Number.isSafeInteger(event.actionSequence)?linked:
        actions.filter(candidate=>event.skillId?candidate.skillId===event.skillId:
          candidate.targetId!=null&&String(candidate.targetId)===String(event.unitId))
          .sort((a,b)=>Math.abs(Number(a.sequence)-Number(event.sequence))-
            Math.abs(Number(b.sequence)-Number(event.sequence)))[0]||null):null;
      const stack=Math.min(3,this.floats.filter(item=>item.unitId===event.unitId&&
        item.start!=null&&now-item.start<260).length);
      node.hidden=!!action;
      this.floats.push({node,kind,unitId:event.unitId,x:event.x,y:event.y,
        renderZ:event.renderZ,afterDeath:!!event.afterDeath,start:action?null:now,
        pendingAction:action||null,
        contactIndex:Number.isSafeInteger(event.contactIndex)?event.contactIndex:0,
        contactCount:Number.isSafeInteger(event.contactCount)&&event.contactCount>0?event.contactCount:1,
        stack,lifetime:kind==="status"?1400:kind==="critical"?1250:kind==="dot"?1350:1100});
    }
    // Bound DOM work under AoE and mass-status effects; never retain old nodes.
    while(this.floats.length>40)this.floats.shift().node.remove();
  }

  sync(state){
    // Map resets must never release a delayed result into the next battle.
    if(this.floatMapId!==null&&this.floatMapId!==state?.map?.id){
      for(const item of this.floats)item.node.remove();
      this.floats=[];
    }
    this.floatMapId=state?.map?.id??null;
    this.environmentState=state?.presentation?.environment||globalThis.CardTacticsRuntime?.getEnvironmentState?.()||null;
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
    const visual=visualManagerFor(this.scene);
    for(const item of this.floats){
      if(item.pendingAction){
        // BattleResolution publishes all three sword-dance hit results in one
        // synchronous batch, while the UnitRenderer plays the three official
        // attack events consecutively. A result must become visible when ITS
        // attack is on screen, not after the entire animation/VFX is gone.
        // The action sequence is authoritative; do not infer timing from MP,
        // guessed milliseconds, or the current final snapshot position.
        const action=item.pendingAction;
        const playing=visual?.units?.activeAnimations?.get(String(action.unitId))||
          visual?.units?.activeAnimations?.get(action.unitId);
        const started=playing?.event?.sequence===action.sequence&&
          String(playing.event.unitId)===String(action.unitId)&&
          playing.event.skillId===action.skillId;
        if(started){
          // The official UnitRenderer already owns action playback duration.
          // Distribute the authored contacts across that exact animation,
          // without creating extra VFX, duplicate attacks or arbitrary timers.
          const count=Math.max(1,item.contactCount);
          const index=Math.min(count-1,Math.max(0,item.contactIndex));
          const progress=Math.max(0,(now-playing.startedAt)/Math.max(1,playing.duration));
          // Contact centers align with successive attack beats. A single
          // impact preserves the existing immediate-on-start behaviour.
          const contactBeat=count===1?0:(index+.5)/count;
          if(progress<contactBeat){
            item.node.hidden=true;
            retained.push(item);
            continue;
          }
        }else if(visual?.visualPending(action)){
          item.node.hidden=true;
          retained.push(item);
          continue;
        }
        // Start after the correct contact, or reveal an authentic result if
        // the action has legitimately been filtered/skipped from the playback.
        item.pendingAction=null;
        item.start=now;
        item.stack=Math.min(3,this.floats.filter(other=>other!==item&&
          other.unitId===item.unitId&&other.start!=null&&
          now-other.start<260).length);
      }
      const elapsed=now-item.start;
      if(elapsed>=item.lifetime){item.node.remove();continue;}
      const progress=Math.max(0,elapsed/item.lifetime);
      // A moving/knocked-back target's text uses the same interpolated mesh
      // pose as the visible figure; defeated units retain the event position.
      const entry=visual?.units?.entries?.get(String(item.unitId))||
        visual?.units?.entries?.get(item.unitId);
      const pose=entry?.root&&!entry.root.isDisposed?.()
        ?entry.root.getAbsolutePosition?.()||entry.root.position:null;
      const world=pose
        ?new BABYLON.Vector3(pose.x,
            pose.y+(entry.kind==='CAPSULE'?Number(entry.height||0)/2:
              Number(entry.height||UNIT_VISUAL_HEIGHT))+.73,pose.z)
        :new BABYLON.Vector3(Number(item.x)*TILE_SIZE,
            Number(item.renderZ||0)*ELEVATION_HEIGHT+UNIT_VISUAL_HEIGHT+.73,
            Number(item.y)*TILE_SIZE);
      const projected=BABYLON.Vector3.Project(world,BABYLON.Matrix.Identity(),transform,viewport);
      if(projected.z<0||projected.z>1){item.node.hidden=true;retained.push(item);continue;}
      const lateral=item.kind==="magic-damage"||item.kind==="magic-critical"?18:item.kind==="physical-damage"||item.kind==="physical-critical"?-18:0;const x=offsetX+projected.x*scaleX+lateral,y=offsetY+projected.y*scaleY;
      item.node.hidden=x<-100||x>rootRect.width+100||y<-100||y>rootRect.height+100;
      item.node.style.opacity=String(Math.min(1,(1-progress)*2));
      item.node.style.transform=`translate3d(${Math.round(x)}px,${Math.round(y-12-48*progress-item.stack*16)}px,0) translate(-50%,-100%)`;
      retained.push(item);
    }
    this.floats=retained;
  }

  diagnostics(){return{count:this.nodes.size,expandedUnitId:this.hudUnitId,activeFloats:this.floats.length};}
  dispose(){
    for(const item of this.floats)item.node.remove();
    this.releaseInspectorHud();
    this.root.remove();this.nodes.clear();this.units=[];this.hudUnitId=null;this.inspectorUnitId=null;this.floats=[];this.failedIcons.clear();
  }
}
