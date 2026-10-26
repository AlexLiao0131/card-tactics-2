function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function visual(obj,keys){if(!obj)return null;for(const key of keys){let cur=obj;for(const p of key.split(".")){cur=cur?.[p];if(cur==null)break}if(typeof cur==="string"&&cur)return cur}return null}
function cardArt(card){return visual(card,["card","art.card","visual.card","assets.card","image","portrait"])||visual(globalThis.CHARACTERS?.[card?.characterId],["card","art.card","visual.card","assets.card","portrait","image"])}
function describe(card){
  if(!card)return"";
  if(card.type==="CHARACTER"){const c=globalThis.CHARACTERS?.[card.characterId],s=c?.combat||{};return`部署 ${c?.name||card.name}。HP ${s.hp??"-"}｜ATK ${s.atk??"-"}｜DEF ${s.def??"-"}｜MOVE ${s.move??"-"}。`}
  const e=card.effect||{};if(e.type==="WEATHER")return`改變天候為 ${e.weather||"WEATHER"}${e.durationTurns?`，持續 ${e.durationTurns} 回合`:""}。`;
  if(e.type==="AREA_DAMAGE")return`範圍 ${e.radius??0}｜傷害 ${e.damage??0}`;if(e.type==="AREA_HEAL")return`範圍治療 ${e.heal??0}`;
  if(e.type==="AREA_PUSH")return`範圍位移 ${e.distance??0} 格`;return"施放卡牌效果。";
}

// One presentation contract shared by battle hand, expanded preview, collection and pack results.
// No card numbers or combat authority are stored in the PNG or duplicated here.
export function isHeroCard(card){return card?.type==="CHARACTER"&&card.unitType==="HERO"}

// All card faces read the official character/loadout/skill databases; no duplicate stats.
function heroDisplay(card){
  const character=globalThis.CharacterDatabase?.get?.(card.characterId)||globalThis.CHARACTERS?.[card.characterId]||null;
  let configured=null;
  try{configured=globalThis.LoadoutDatabase?.resolveCharacter?.(card.characterId,card.loadoutId)||null}catch(_error){}
  const c=configured||character;
  const maxHP=c?.combat?.hp;
  const maxMP=c?.resourceRules?.mana===false?0:(c?.attributes?globalThis.UnitRuntimeEngine?.maxManaFromAttributes?.(c.attributes):null);
  const cardVisual=globalThis.VisualDatabase?.card?.(card.id);
  const artwork=visual(cardVisual,["art","card","image","portrait"])||cardArt(card)||`assets/images/cards/heroes/${encodeURIComponent(card.characterId)}.png`;
  const role=c?.lore?.role||c?.title||c?.archetype||"英雄單位";
  // Description is character lore, never the generated skill summary.
  const introduction=c?.lore?.introduction||c?.lore?.summary||c?.lore?.notes||"角色簡介尚未設定。";
  const skills=(c?.skills||[]).map(id=>{try{return globalThis.SkillDatabase?.get?.(id)||{id,name:id}}catch(_error){return{id,name:id}}});
  return{artwork,hp:maxHP??"—",mp:maxMP??"—",role,introduction,skills,character:c,stats:c?.combat||{},extraResources:heroExtraResources(c)};
}

// Extra resources use each character's official resourceRules; these values
// are display-only and never become a parallel combat resource authority.
function heroExtraResources(character){
  return Object.entries(character?.resourceRules||{}).filter(([key,rule])=>key!=="mana"&&rule&&typeof rule==="object").map(([key,rule])=>({
    id:key,label:String(rule.shortLabel||rule.label||key.toUpperCase()),
    initial:Number(rule.initial??rule.max??0),max:Number(rule.max??0),
    naturalRecovery:Number(rule.naturalRecovery??0),
    allowOverdraft:rule.allowOverdraft===true,
    magicScaling:rule.magicScaling||null
  }));
}

// Inline SVG icon shares the game's DOM presentation layer; this is not a card image or runtime.
function heroRoleIcon(archetype){
  const t=String(archetype||"").toUpperCase();
  let category=t.includes("HEAL")||t.includes("SAINT")||t.includes("SUPPORT")?"support":t.includes("DEFEND")||t.includes("TANK")?"shield":t.includes("MAGE")||t.includes("MAGIC")?"magic":t.includes("RANG")||t.includes("ARCHER")||t.includes("SCOUT")?"ranged":"melee";
  const paths={
    melee:'<path d="M4 19l5-5m6-6 5-5-1-2-2-1-5 5m-2 2 9 9m-5-5-8 8 2 2 8-8"/><path d="m5 3 16 16M4 16l4 4m9-16 3 3"/>',
    ranged:'<path d="M3 21c10-2 16-8 18-18M4 4c5 0 16 10 16 16M6 18 20 4"/><path d="m15 4 5 0 0 5"/>',
    shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M12 6v12M7 12h10"/>',
    magic:'<path d="m3 21 12-12m-2-6 1 3 3 1-3 1-1 3-1-3-3-1 3-1Zm6 8 1 2 2 1-2 1-1 2-1-2-2-1 2-1ZM5 7l1 2 2 1-2 1-1 2-1-2-2-1 2-1Z"/>',
    support:'<path d="M12 22V4M4 12h16"/><path d="M12 22c-5-3-8-6-8-10s3-5 8-8c5 3 8 4 8 8s-3 7-8 10Z"/>'
  };
  const label={melee:"近戰",ranged:"遠程",shield:"防衛",magic:"魔法",support:"支援"}[category];
  return{label,svg:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[category]}</svg>`};
}

// Present only mechanics that exist in the official SkillDatabase. Every skill,
// including nested variants, uses the same explanation contract.
function skillExplanation(skill,{variant=false,parent=null,resourceRules={}}={}){
  const s=skill||{},base=parent||s,lines=[];
  const add=value=>{if(value)lines.push(value)};
  const target={SELF:"自己",ALLY:"友方單位",ENEMY:"敵方單位",TILE:"指定地格",CORE:"核心"};
  const category=base.category==="ATTACK"?"攻擊":base.category==="MAGIC"?"魔法":"特殊技能";
  const kind=s.target||base.target||"ENEMY",range=s.range||base.range;
  if(!variant)add(`操作：選取角色 → ${base.category==="ATTACK"?"攻擊":"魔法／特殊技能"} → 選擇「${s.name||s.id}」${Array.isArray(s.variants)&&s.variants.length?" → 選擇變化型態":""}${kind==="SELF"?"（以自己為目標）":` → 指定${target[kind]||kind}`}`);
  else add(`目標：${target[kind]||kind}`);
  if(range?.min!=null&&range?.max!=null)add(`施放距離：${String(range.min)}～${String(range.max)} 格`);
  const mana=variant?base.manaCost:s.manaCost;
  if(Number(mana)>0)add(`消耗：MP ${String(mana)}`);
  for(const [resource,cost] of Object.entries(s.resourceCosts||base.resourceCosts||{}))if(Number(cost)>0)add(`消耗：${String(resourceRules[resource]?.shortLabel||resourceRules[resource]?.label||resource.toUpperCase())} ${String(cost)}`);
  if(s.weapon||(!variant&&base.weapon))add(`使用武器：${String(s.weapon||base.weapon)}`);
  if(Number(s.power)>0)add(`傷害係數：${String(s.power)} 倍（不是固定傷害值）`);
  if(s.attackType&&s.attackType!=="INHERIT")add(`攻擊種類：${String(s.attackType)}`);
  if(s.element&&s.element!=="INHERIT"&&s.element!=="NONE")add(`元素：${String(s.element)}`);
  if(s.radius!=null)add(`範圍：半徑 ${String(s.radius)} 格`);
  if(s.aoeDamage!=null)add(`範圍效果傷害：${String(s.aoeDamage)}`);
  if(s.backstabMultiplier!=null)add(`背刺倍率：${String(s.backstabMultiplier)} 倍`);
  if(s.onHitBonusDamage)add(`命中附加傷害：${String(s.onHitBonusDamage.amount??"—")}（${String(s.onHitBonusDamage.damageType||"額外效果")}）`);
  if(s.moveToTarget)add("施放後會依技能規則移動施放者的位置");
  if(s.ignorePath)add("移動效果不依一般路徑檢查");
  if(s.requiresVision)add("條件：目標必須位於可觀測範圍內");
  if(s.environmentRequirement)add(`環境條件：${String(s.environmentRequirement)}`);
  if(s.targeting?.requiresObservationNetwork)add(`必須具備 ${String(s.targeting.requiresObservationNetwork)} 觀測網路`);
  if(s.targeting?.companionId)add(`遠距觀測夥伴：${String(s.targeting.companionId)}`);
  if(s.targeting?.directRange)add(`直接觀測距離：${String(s.targeting.directRange.min)}～${String(s.targeting.directRange.max)} 格`);
  if(s.targeting?.remoteRange)add(`共享觀測距離：${String(s.targeting.remoteRange.min)}～${String(s.targeting.remoteRange.max)} 格`);
  if(s.trajectory)add(`彈道：${String(s.trajectory)}`);
  const requirements={water:"必須位於水域",carrying:"需要正在攜帶目標",notCarrying:"不能正在攜帶目標",notMoved:"本回合尚未移動"};
  for(const [key,value] of Object.entries(s.requirements||{}))if(value===true)add(`使用條件：${requirements[key]||String(key)}`);
  if(s.trapPlacement)add(`放置陷阱：${String(s.trapPlacement.name||"陷阱")}｜傷害 ${String(s.trapPlacement.damage??"—")}｜持續 ${String(s.trapPlacement.duration??"—")} 回合`);
  if(s.hydrologyFlood)add(`水文效果：水面上升 ${String(s.hydrologyFlood.surfaceRise??"—")}`);
  if(s.soundMagic)add("此技能標記為聲音魔法");
  if(s.informationSkill)add("此技能用於觀測／資訊支援");
  if(s.support)add("允許參與支援攻擊（仍須符合戰鬥條件）");
  const utility={STEAL_CARD:"偷取卡牌",ENTER_STEALTH:"進入潛行",CARRY_ENEMY:"抓取敵人／空運摔落",CARRY_ALLY:"攜帶友軍",RELEASE_CARRIED:"放下攜帶目標",SET_VERTICAL_MODE:"切換垂直移動模式"};
  if(s.utilityAction){
    const u=s.utilityAction;
    add(`特殊操作：${utility[u.type]||String(u.type||"技能操作")}${u.mode?`（${String(u.mode)}）`:""}`);
    if(u.minDrop!=null)add(`最低摔落高度：${String(u.minDrop)}`);
    if(u.consumeTurn===false)add("資料設定：此操作不消耗本回合行動");
    if(u.consumeTurn===true)add("資料設定：此操作會消耗本回合行動");
  }
  const effectLabel={BUFF:"增益／減益",HEAL:"恢復 HP",HEAL_OVER_TIME:"持續治療",DAMAGE_OVER_TIME:"持續傷害",DAMAGE:"傷害",KNOCKBACK:"擊退",SHIELD:"護盾",BURN:"燃燒",STUN:"暈眩"};
  function describeEffect(effect){
    if(!effect||typeof effect!=="object")return"";
    const name=effect.name||effectLabel[effect.type]||effect.type||"效果";
    const parts=[name];
    if(effect.amount!=null)parts.push(`數值 ${effect.amount}`);
    if(effect.duration!=null)parts.push(`持續 ${effect.duration} 回合`);
    if(effect.chance!=null)parts.push(`觸發率 ${effect.chance}%`);
    if(effect.distance!=null)parts.push(`位移 ${effect.distance} 格`);
    if(effect.modifiers){const labels=Object.entries(effect.modifiers).map(([k,v])=>`${k} ${v>=0?"+":""}${v}`);if(labels.length)parts.push(labels.join("／"));}
    if(effect.movementRules?.immobilized)parts.push("不能移動");
    if(effect.negativeEffectGuard?.charges!=null)parts.push(`抵消負面效果 ${effect.negativeEffectGuard.charges} 次`);
    return parts.join("｜");
  }
  for(const key of ["statusEffects","effects","postEffects","relationEffects"]){
    for(const e of s[key]||[]){
      const rel=e?.relation?`${({ALLY:"友方",ENEMY:"敵方",SELF:"自己"}[e.relation]||e.relation)}：`:"";
      add(`附加效果：${rel}${describeEffect(e)}`);
    }
  }
  if(s.description)add(s.description);
  const variants=Array.isArray(s.variants)?s.variants:[];
  const children=variants.map(v=>`<li><strong>${esc(v.name||v.id)}</strong><div class="hero-skill-points">${skillExplanation(v,{variant:true,parent:s,resourceRules})}</div></li>`).join("");
  const details=lines.map(t=>`<li>${esc(t)}</li>`).join("")||"<li>目前資料庫未提供更詳細的效果描述。</li>";
  return `<ul class="hero-skill-points">${details}</ul>${children?`<strong class="hero-skill-variants-title">技能變化</strong><ul class="hero-skill-variants">${children}</ul>`:""}`;
}

function heroDetailedInformation(card,{unit=null}={}){
  if(!card)return"";
  const m=heroDisplay(card),c=unit?.character||m.character||{},combat=c.combat||m.stats||{},attr=c.attributes||{};
  const combatKeys=[["hp","HP"],["atk","ATK"],["matk","MATK"],["def","DEF"],["mdef","MDEF"],["move","MOVE"]];
  const attributeKeys=[["str","STR"],["agi","AGI"],["int","INT"],["wil","WIL"],["vit","VIT"],["luk","LUK"]];
  const values=(entries,obj)=>entries.map(([key,label])=>`<div class="hero-info-value"><span>${label}</span><strong>${esc(obj[key]??"—")}</strong></div>`).join("");
  const passives=(c.passives||[]).map(id=>{let p=null;try{p=globalThis.SkillDatabase?.getPassive?.(id)}catch(_error){}return`<li><strong>${esc(p?.name||id)}</strong><small>${esc(p?.description||"此被動尚無文字說明。")}</small></li>`}).join("");
  const ids=unit?(globalThis.EffectEngine?.skillIds?.(unit)||c.skills||[]):(c.skills||[]);
  const skills=ids.map(id=>{try{return globalThis.SkillDatabase?.get?.(id)||{id,name:id}}catch(_error){return{id,name:id}}});
  const skillList=skills.map(s=>`<li class="hero-info-skill"><details><summary>${esc(s.name||s.id)}<span>${esc(s.category||"SKILL")}</span></summary>${skillExplanation(s,{resourceRules:c.resourceRules||{}})}</details></li>`).join("");
  const resourceRules=heroExtraResources(c);
  const resourceBasics=resourceRules.map(rule=>`<div class="hero-info-value hero-info-resource"><span>${esc(rule.label)}</span><strong>${esc(rule.initial)}/${esc(rule.max)}</strong></div>`).join("");
  const resourceGuides=resourceRules.map(rule=>{
    const lines=[`初始 ${rule.initial}／上限 ${rule.max}`];
    lines.push(rule.naturalRecovery===0?"每回合不會自然恢復":`每回合自然恢復 ${rule.naturalRecovery}`);
    if(rule.allowOverdraft)lines.push("即使資源不足仍可能允許使用，消耗後最低為 0（依技能規則判定）");
    const cap=Number(rule.magicScaling?.maxBonus);
    if(Number.isFinite(cap)&&cap>0)lines.push(`此資源越低，魔法技能威力加成最高 ${Math.round(cap*100)}%`);
    return `<li><strong>${esc(rule.label)}</strong><small>${esc(lines.join("；"))}</small></li>`;
  }).join("");
  const resources=unit?Object.entries(unit.resources||{}).map(([key,resource])=>`<div class="hero-info-value"><span>${esc(resource.label||key.toUpperCase())}</span><strong>${esc(resource.value??0)}/${esc(resource.max??0)}</strong></div>`).join(""):"";
  const liveInfo=unit?`<h4>戰場即時狀態</h4><div class="hero-info-value-list"><div class="hero-info-value"><span>目前 HP</span><strong>${esc(unit.hp)}/${esc(combat.hp??unit.hp)}</strong></div><div class="hero-info-value"><span>目前 MP</span><strong>${esc(unit.mana??0)}/${esc(unit.maxMana??0)}</strong></div>${resources}</div><p class="hero-info-action">${esc(unit.acted?(unit.waited?"已待機":"已完成主動行動"):unit.moved?"已移動／尚可行動":"尚未行動")}｜位置（${esc(unit.x)}, ${esc(unit.y)}）</p>`:"";
  const cost=card.cost==null?"":`<div class="hero-info-value"><span>水晶</span><strong>${esc(card.cost)}</strong></div>`;
  const introduction=c.lore?.introduction||c.lore?.summary||c.lore?.notes||m.introduction;
  return `<div class="hero-info-overlay" data-close-hero-info="backdrop">
    <section class="hero-info-dialog" role="dialog" aria-modal="true" aria-label="${esc(c.name||card.name)} 詳細資訊">
      <header class="hero-info-header"><strong>${esc(c.name||card.name)} · 詳細資訊</strong><button type="button" data-close-hero-info="button" aria-label="關閉詳細資訊">✕</button></header>
      <div class="hero-info-content">
        <p class="hero-info-intro">${esc(introduction)}</p>
        ${liveInfo}
        <h4>角色能力（${unit?"目前角色配置":"卡牌基礎配置"}）</h4><div class="hero-info-value-list">${cost}<div class="hero-info-value"><span>最大 MP</span><strong>${esc(unit?.maxMana??m.mp)}</strong></div>${values(combatKeys,combat)}</div>
        ${resourceRules.length?`<h4>特殊資源（${unit?"基礎設定":"初始值"}）</h4><div class="hero-info-value-list">${resourceBasics}</div><ul class="hero-info-resources">${resourceGuides}</ul>`:""}
        <h4>角色屬性</h4><div class="hero-info-value-list">${values(attributeKeys,attr)}</div>
        <h4>技能說明</h4><p class="hero-info-help">點擊技能名稱，展開操作方法、消耗、距離、效果與施放條件。</p><ul class="hero-info-skills">${skillList||"<li>尚無技能資料</li>"}</ul>
        <h4>被動能力</h4><ul class="hero-info-skills">${passives||"<li>尚無被動資料</li>"}</ul>
      </div>
    </section>
  </div>`;
}

export function ensureHeroCardStyles(){
  if(!document.querySelector('link[data-card-tactics-hero-style]')){
    const css=document.createElement("link");css.rel="stylesheet";css.dataset.cardTacticsHeroStyle="";
    const boot=new URL(import.meta.url).searchParams.get("boot");
    const path=new URL("../css/hero-card.css",import.meta.url);
    if(boot)path.searchParams.set("boot",boot);
    css.href=path.href;document.head.appendChild(css);
  }
  if(!document.documentElement.dataset.cardTacticsHeroErrors){
    document.documentElement.dataset.cardTacticsHeroErrors="1";
    document.addEventListener("error",event=>{
      const img=event.target;if(!(img instanceof HTMLImageElement)||!img.classList.contains("hero-card__figure"))return;
      img.closest(".hero-card")?.classList.add("hero-card--missing-art");img.hidden=true;
    },true);
  }
}

export function heroCardFace(card,{variant="hand"}={}){
  if(!isHeroCard(card))return"";
  const model=heroDisplay(card),src=esc(model.artwork),name=esc(card.name);
  const icon=heroRoleIcon(model.character?.archetype);
  const resourceLine=model.extraResources.map(resource=>`<span class="hero-card__resource" title="${esc(resource.label)} 初始值">${esc(resource.label)} ${esc(resource.initial)}/${esc(resource.max)}</span>`).join("");
  return `<span class="hero-card hero-card--${esc(variant)}${resourceLine?" hero-card--has-resources":""}" data-hero-card="${esc(card.id)}" aria-label="${name}，消耗 ${esc(card.cost)} 水晶，HP ${esc(model.hp)}，MP ${esc(model.mp)}">
    <span class="hero-card__background" aria-hidden="true"></span>
    <span class="hero-card__art"><span class="hero-card__missing">立繪待上傳</span><img class="hero-card__figure" src="${src}" alt="" draggable="false" loading="lazy"></span>
    <span class="hero-card__frame" aria-hidden="true"></span>
    <span class="hero-card__cost" title="消耗水晶數">${esc(card.cost)}</span>
    <span class="hero-card__name">${name}</span>
    <span class="hero-card__role" aria-label="${icon.label}" title="${icon.label}">${icon.svg}</span>
    <span class="hero-card__details">${esc(model.introduction)}</span>
    <span class="hero-card__resources" aria-label="特殊能量">${resourceLine}</span>
    <span class="hero-card__hp" title="角色基礎 HP">${esc(model.hp)}</span>
    <span class="hero-card__mp" title="角色初始最大 MP">${esc(model.mp)}</span>
    <span class="hero-card__rarity">HERO</span>
  </span>`;
}

globalThis.CardTacticsHeroCard=Object.freeze({
  face:heroCardFace,isHero:isHeroCard,ensureStyles:ensureHeroCardStyles,
  introduction:card=>heroDisplay(card).introduction,
  detail:heroDetailedInformation,describe
});

export class CardHandUI{
  constructor(){
    this.host=document.getElementById("cardPhasePanel");
    this.runtime=null;this.previewId=null;this.detailsOpen=false;this.mulligan=new Set();this.openingHandRef=null;
    this.regions=null;this.regionMarkup=new Map();
    ensureHeroCardStyles();
  }
  bind(runtime){
    this.runtime=runtime;
    window.addEventListener("cardtactics:state",()=>this.render());
    window.addEventListener("cardtactics:battle-render",()=>this.render());
    // Delegate interactions once: card image DOM survives unrelated battlefield updates.
    this.host.addEventListener("click",event=>this.handleClick(event));
    window.addEventListener("keydown",event=>{
      if(event.key==="Escape"&&this.detailsOpen){this.detailsOpen=false;this.render();}
    });
    this.render();
  }
  ensureRegions(){
    if(this.regions)return;
    this.regions=new Map();this.regionMarkup.clear();
    const fragment=document.createDocumentFragment();
    for(const name of ["enemy","status","hand","mulligan","preview","details","targeting","actions"]){
      const region=document.createElement("div");
      region.dataset.cardRegion=name;
      fragment.appendChild(region);
      this.regions.set(name,region);
    }
    this.host.replaceChildren(fragment);
  }
  syncRegion(name,markup){
    const region=this.regions.get(name);
    if(this.regionMarkup.get(name)===markup)return;
    region.innerHTML=markup;
    this.regionMarkup.set(name,markup);
  }
  syncHand(markup){
    if(this.regionMarkup.get("hand")===markup)return;
    const region=this.regions.get("hand");
    const parsed=document.createElement("template");
    parsed.innerHTML=markup;
    const nextHand=parsed.content.querySelector(".fan-hand");
    const currentHand=region.querySelector(".fan-hand");
    const visualSignature=button=>button.innerHTML.replace(/<small>[^<]*<\/small>/g,"<small></small>");
    if(!currentHand||!nextHand||!nextHand.querySelector(".fan-card")||!currentHand.querySelector(".fan-card")){
      region.replaceChildren(parsed.content);
      region.querySelectorAll(".fan-card").forEach(button=>button._visualSignature=visualSignature(button));
      this.regionMarkup.set("hand",markup);
      return;
    }
    // Reuse card buttons by card ID (including duplicate occurrences) across draws,
    // order changes, resource changes and selection state. Their image elements survive.
    const reusable=new Map();
    for(const button of currentHand.querySelectorAll(":scope > .fan-card")){
      const id=button.dataset.card;
      if(!reusable.has(id))reusable.set(id,[]);
      reusable.get(id).push(button);
    }
    const updated=[];
    for(const next of [...nextHand.children]){
      if(!next.matches(".fan-card")){
        updated.push(next);
        continue;
      }
      const existing=reusable.get(next.dataset.card)?.shift();
      const nextSignature=visualSignature(next);
      if(!existing){next._visualSignature=nextSignature;updated.push(next);continue;}
      // Compare the authored card face rather than live IMG attributes. An image
      // load/error may add `hidden`, but this must not trigger replacement.
      if(existing._visualSignature!==nextSignature){existing.innerHTML=next.innerHTML;}
      else{
        const oldLabel=existing.querySelector(":scope > small");
        const newLabel=next.querySelector(":scope > small");
        if(oldLabel&&newLabel)oldLabel.textContent=newLabel.textContent;
      }
      existing._visualSignature=nextSignature;
      existing.dataset.handIndex=next.dataset.handIndex;
      existing.className=next.className;
      existing.disabled=next.disabled;
      existing.style.cssText=next.style.cssText;
      updated.push(existing);
    }
    // Moving an existing node preserves its image; do not replace the hand container.
    for(let i=0;i<updated.length;i++){
      if(currentHand.children[i]!==updated[i])currentHand.insertBefore(updated[i],currentHand.children[i]||null);
    }
    for(const node of [...currentHand.children])if(!updated.includes(node))node.remove();
    this.regionMarkup.set("hand",markup);
  }
  handleClick(event){
    const origin=event.target instanceof Element?event.target:event.target?.parentElement;
    if(!origin)return;
    const close=origin.closest("[data-close-hero-info]");
    if(close&&this.host.contains(close)){
      if(close.dataset.closeHeroInfo==="backdrop"&&event.target!==close)return;
      this.detailsOpen=false;this.render();return;
    }
    const button=origin.closest("button");
    if(!button||!this.host.contains(button)||button.disabled)return;
    const r=this.runtime,state=r?.getCardState(),phase=r?.getPhase();
    if(!r||!state)return;
    const opening=phase==="CARD_PHASE"&&state.mulliganAvailable&&!state.mulliganDone;
    const id=button.dataset.card;
    if(id){
      if(opening){
        const index=Number(button.dataset.handIndex);
        if(!Number.isInteger(index)||index<0||state.zones.hand[index]!==id)return;
        this.mulligan.has(index)?this.mulligan.delete(index):this.mulligan.add(index);
      }else{this.previewId=id;this.detailsOpen=false;}
      this.render();return;
    }
    switch(button.id){
      case "confirmMulligan":
        globalThis.CardPhaseEngine.mulligan(state,[...this.mulligan]);this.mulligan.clear();
        if(!r.maybeAutoEndCardPhase?.())window.dispatchEvent(new CustomEvent("cardtactics:state"));
        break;
      case "keepOpeningHand":
        globalThis.CardPhaseEngine.keepOpeningHand(state);this.mulligan.clear();
        if(!r.maybeAutoEndCardPhase?.())window.dispatchEvent(new CustomEvent("cardtactics:state"));
        break;
      case "confirmCardUse":{
        const chosen=this.previewId;this.previewId=null;this.detailsOpen=false;
        if(chosen)r.playCard(chosen);this.render();break;
      }
      case "cancelCardPreview":this.previewId=null;this.detailsOpen=false;this.render();break;
      case "openHeroCardInfo":this.detailsOpen=true;this.render();break;
      case "cancelCardTarget":this.previewId=null;r.cancelCard();this.render();break;
      case "endCardPhase":r.endCardPhase();break;
    }
  }
  render(){
    const r=this.runtime;if(!r)return;
    const state=r.getCardState(),phase=r.getPhase(),pending=r.getPendingCard(),enemy=r.getEnemyCardState?.(),view=r.getEnemyPresentation?.();
    if(!state){
      this.detailsOpen=false;this.mulligan.clear();this.openingHandRef=null;
      if(this.regions){this.host.replaceChildren();this.regions=null;this.regionMarkup.clear();}
      return;
    }
    this.host.classList.toggle("battle-pass-through",phase!=="CARD_PHASE");
    if(phase!=="CARD_PHASE"){this.previewId=null;this.detailsOpen=false;}
    const cards=globalThis.CardDatabase.list(state.zones.hand),opening=phase==="CARD_PHASE"&&state.mulliganAvailable&&!state.mulliganDone;
    // A new match gets a new hand array: do not carry slot choices across
    // games. The game engine and UI both identify a duplicate by hand index.
    if(opening){
      if(this.openingHandRef!==state.zones.hand){this.openingHandRef=state.zones.hand;this.mulligan.clear();}
    }else{this.openingHandRef=null;this.mulligan.clear();}
    if(pending){this.previewId=null;this.detailsOpen=false;}
    if(this.previewId&&!cards.some(c=>c.id===this.previewId)){this.previewId=null;this.detailsOpen=false;}
    const preview=this.previewId?globalThis.CardDatabase.get(this.previewId):null,targeting=!!pending;
    const previousInfoScroll=this.regions?.get("details")?.querySelector(".hero-info-content")?.scrollTop||0;
    this.host.classList.toggle("hero-preview-open",isHeroCard(preview));
    this.host.classList.toggle("hero-info-open",this.detailsOpen&&isHeroCard(preview));
    const enemyMotion=phase==="ENEMY_TURN"?(view?.kind==="DRAW"?"enemy-draw":view?.kind==="CARD_SELECT"?"enemy-select":"enemy-thinking"):"";
    const enemyHtml=enemy?`<div class="opponent-hand ${enemyMotion}">${Array.from({length:enemy.zones?.hand?.length||0},(_,i)=>`<i class="opponent-card-back" style="--fan:${i-((enemy.zones?.hand?.length||1)-1)/2};--i:${i}"></i>`).join("")}</div><div class="opponent-meta">敵方　💎 ${enemy.crystals||0}/${enemy.crystalCapacity||0}　牌庫 ${enemy.zones?.deck?.length||0}</div>${phase==="ENEMY_TURN"?`<div class="opponent-message">${esc(view?.message||"敵方思考中…")}</div>`:""}`:"";
    const hand=cards.map((c,i)=>{const art=cardArt(c),off=i-(cards.length-1)/2,selected=this.mulligan.has(i),disabled=!opening&&!(phase==="CARD_PHASE"&&(r.canPlayCard?.(c.id)??globalThis.CardPhaseEngine.canPlay(state,c))),hero=isHeroCard(c);return`<button class="fan-card ${hero?"hero-fan-card":""} ${selected?"mulligan-selected":""} ${pending?.id===c.id?"pending":""}" data-card="${esc(c.id)}" data-hand-index="${i}" style="--fan:${off};--i:${i}" ${disabled?"disabled":""}>${hero?heroCardFace(c,{variant:"hand"}):`${art?`<span class="fan-art" style="background-image:url('${art.replace(/'/g,"%27")}')"></span>`:""}<span class="fan-sheen"></span><span class="fan-cost">${c.cost}</span><span class="fan-name">${esc(c.name)}</span><small>${opening?(selected?"將換掉":"保留"):(c.type==="CHARACTER"?(c.unitType==="HERO"?"HERO":"UNIT"):(c.spellType||"SPELL"))}</small>`}</button>`}).join("");
    const art=preview?cardArt(preview):null,heroPreview=isHeroCard(preview);
    const previewHtml=!opening&&!targeting&&preview?`<div class="card-preview ${heroPreview?"hero-preview":""}">${heroPreview?heroCardFace(preview,{variant:"preview"}):`<div class="preview-card-face">${art?`<span class="preview-art" style="background-image:url('${art.replace(/'/g,"%27")}')"></span>`:""}<span class="preview-cost">${preview.cost}</span><strong>${esc(preview.name)}</strong><small>${esc(preview.type)}</small><p>${esc(describe(preview))}</p></div>`}<div class="preview-actions"><button id="confirmCardUse">使用</button>${heroPreview?`<button id="openHeroCardInfo" type="button">詳細資訊</button>`:""}<button id="cancelCardPreview">取消</button></div></div>`:"";
    const mulliganHtml=opening?`<div class="mulligan-guide"><strong>起手換牌</strong><span>選擇不要的牌；整場僅一次。</span></div><div class="mulligan-actions"><button id="confirmMulligan" ${this.mulligan.size?"":"disabled"}>換掉 ${this.mulligan.size} 張</button><button id="keepOpeningHand">全部保留</button></div>`:"";
    const targetingHtml=targeting?`<div class="card-targeting-bar"><button id="cancelCardTarget">← 取消</button><strong>${esc(pending.name)}</strong><span>${pending.type==="CHARACTER"?"請選擇出生區中的部署格":"請在戰場選擇目標"}</span></div>`:"";
    const actionsHtml=!opening&&!targeting&&phase==="CARD_PHASE"?`<div class="card-phase-actions"><button id="endCardPhase">結束卡牌階段</button></div>`:"";
    this.ensureRegions();
    // Render by independent regions. Unchanged hand/preview image elements keep their identity.
    this.syncRegion("enemy",enemyHtml);
    this.syncRegion("status",`<div class="battle-resource">💎 ${state.crystals}/${state.crystalCapacity||state.startingCrystals||4}</div><div class="battle-deck-count">牌庫 ${state.zones.deck.length}</div>`);
    this.syncHand(`<div class="fan-hand">${hand||`<div class="deck-empty">目前沒有手牌</div>`}</div>`);
    this.syncRegion("mulligan",mulliganHtml);
    this.syncRegion("preview",previewHtml);
    this.syncRegion("details",this.detailsOpen&&heroPreview&&preview?heroDetailedInformation(preview):"");
    this.syncRegion("targeting",targetingHtml);
    this.syncRegion("actions",actionsHtml);
    const scroller=this.regions.get("details").querySelector(".hero-info-content");
    if(scroller)scroller.scrollTop=previousInfoScroll;
  }
}
