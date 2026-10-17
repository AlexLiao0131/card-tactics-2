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
  return{artwork,hp:maxHP??"—",mp:maxMP??"—",role,introduction,skills,character:c,stats:c?.combat||{}};
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

function heroDetailedInformation(card){
  const m=heroDisplay(card),c=m.character||{},combat=m.stats,attr=c.attributes||{};
  const combatKeys=[["hp","HP"],["atk","ATK"],["matk","MATK"],["def","DEF"],["mdef","MDEF"],["move","MOVE"]];
  const attributeKeys=[["str","STR"],["agi","AGI"],["int","INT"],["wil","WIL"],["vit","VIT"],["luk","LUK"]];
  const values=(entries,obj)=>entries.map(([key,label])=>`<div class="hero-info-value"><span>${label}</span><strong>${esc(obj[key]??"—")}</strong></div>`).join("");
  const passives=(c.passives||[]).map(id=>{let p=null;try{p=globalThis.SkillDatabase?.getPassive?.(id)}catch(_error){}return`<li>${esc(p?.name||id)}</li>`}).join("");
  const skills=m.skills.map(s=>{
    const facts=[];
    if(Number.isFinite(Number(s.manaCost))&&Number(s.manaCost)>0)facts.push(`MP ${esc(s.manaCost)}`);
    if(s.range?.min!=null&&s.range?.max!=null)facts.push(`距離 ${esc(s.range.min)}–${esc(s.range.max)}`);
    if(s.description)facts.push(esc(s.description));
    return `<li><strong>${esc(s.name||s.id)}</strong>${facts.length?`<small>${facts.join(" · ")}</small>`:""}</li>`;
  }).join("");
  return `<div class="hero-info-overlay" data-close-hero-info="backdrop">
    <section class="hero-info-dialog" role="dialog" aria-modal="true" aria-label="${esc(card.name)} 詳細資訊">
      <header class="hero-info-header"><strong>${esc(card.name)} · 詳細資訊</strong><button type="button" data-close-hero-info="button" aria-label="關閉詳細資訊">✕</button></header>
      <div class="hero-info-content">
        <p class="hero-info-intro">${esc(m.introduction)}</p>
        <div class="hero-info-value-list"><div class="hero-info-value"><span>水晶</span><strong>${esc(card.cost)}</strong></div><div class="hero-info-value"><span>MP</span><strong>${esc(m.mp)}</strong></div>${values(combatKeys,combat)}</div>
        <h4>角色屬性</h4><div class="hero-info-value-list">${values(attributeKeys,attr)}</div>
        <h4>角色技能</h4><ul class="hero-info-skills">${skills||"<li>尚無技能資料</li>"}</ul>
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
  return `<span class="hero-card hero-card--${esc(variant)}" data-hero-card="${esc(card.id)}" aria-label="${name}，消耗 ${esc(card.cost)} 水晶，HP ${esc(model.hp)}，MP ${esc(model.mp)}">
    <span class="hero-card__background" aria-hidden="true"></span>
    <span class="hero-card__art"><span class="hero-card__missing">立繪待上傳</span><img class="hero-card__figure" src="${src}" alt="" draggable="false" loading="lazy"></span>
    <span class="hero-card__frame" aria-hidden="true"></span>
    <span class="hero-card__cost" title="消耗水晶數">${esc(card.cost)}</span>
    <span class="hero-card__name">${name}</span>
    <span class="hero-card__role" aria-label="${icon.label}" title="${icon.label}">${icon.svg}</span>
    <span class="hero-card__details">${esc(model.introduction)}</span>
    <span class="hero-card__hp" title="角色基礎 HP">${esc(model.hp)}</span>
    <span class="hero-card__mp" title="角色初始最大 MP">${esc(model.mp)}</span>
    <span class="hero-card__rarity">HERO</span>
  </span>`;
}

globalThis.CardTacticsHeroCard=Object.freeze({face:heroCardFace,isHero:isHeroCard,ensureStyles:ensureHeroCardStyles});

export class CardHandUI{
  constructor(){this.host=document.getElementById("cardPhasePanel");this.runtime=null;this.previewId=null;this.detailsOpen=false;this.mulligan=new Set();ensureHeroCardStyles()}
  bind(runtime){this.runtime=runtime;window.addEventListener("cardtactics:state",()=>this.render());window.addEventListener("cardtactics:battle-render",()=>this.render());this.render();window.addEventListener("keydown",event=>{if(event.key==="Escape"&&this.detailsOpen){this.detailsOpen=false;this.render()}})}
  render(){
    const r=this.runtime;if(!r)return;const state=r.getCardState(),phase=r.getPhase(),pending=r.getPendingCard(),enemy=r.getEnemyCardState?.(),view=r.getEnemyPresentation?.();
    if(!state){this.detailsOpen=false;this.host.innerHTML="";return}
    this.host.classList.toggle("battle-pass-through",phase!=="CARD_PHASE");
    if(phase!=="CARD_PHASE"){this.previewId=null;this.detailsOpen=false;}
    const cards=globalThis.CardDatabase.list(state.zones.hand),opening=phase==="CARD_PHASE"&&state.mulliganAvailable&&!state.mulliganDone;
    if(pending){this.previewId=null;this.detailsOpen=false;}if(this.previewId&&!cards.some(c=>c.id===this.previewId)){this.previewId=null;this.detailsOpen=false;}
    const preview=this.previewId?globalThis.CardDatabase.get(this.previewId):null,targeting=!!pending;
    const previousInfoScroll=this.host.querySelector(".hero-info-content")?.scrollTop||0;
    this.host.classList.toggle("hero-preview-open",isHeroCard(preview));
    this.host.classList.toggle("hero-info-open",this.detailsOpen&&isHeroCard(preview));
    const enemyMotion=phase==="ENEMY_TURN"?(view?.kind==="DRAW"?"enemy-draw":view?.kind==="CARD_SELECT"?"enemy-select":"enemy-thinking"):"";
    const enemyHtml=enemy?`<div class="opponent-hand ${enemyMotion}">${Array.from({length:enemy.zones?.hand?.length||0},(_,i)=>`<i class="opponent-card-back" style="--fan:${i-((enemy.zones?.hand?.length||1)-1)/2};--i:${i}"></i>`).join("")}</div><div class="opponent-meta">敵方　💎 ${enemy.crystals||0}/${enemy.crystalCapacity||0}　牌庫 ${enemy.zones?.deck?.length||0}</div>${phase==="ENEMY_TURN"?`<div class="opponent-message">${esc(view?.message||"敵方思考中…")}</div>`:""}`:"";
    const hand=cards.map((c,i)=>{const art=cardArt(c),off=i-(cards.length-1)/2,selected=this.mulligan.has(c.id),disabled=!opening&&!(phase==="CARD_PHASE"&&(r.canPlayCard?.(c.id)??globalThis.CardPhaseEngine.canPlay(state,c))),hero=isHeroCard(c);return`<button class="fan-card ${hero?"hero-fan-card":""} ${selected?"mulligan-selected":""} ${pending?.id===c.id?"pending":""}" data-card="${esc(c.id)}" style="--fan:${off};--i:${i}" ${disabled?"disabled":""}>${hero?heroCardFace(c,{variant:"hand"}):`${art?`<span class="fan-art" style="background-image:url('${art.replace(/'/g,"%27")}')"></span>`:""}<span class="fan-sheen"></span><span class="fan-cost">${c.cost}</span><span class="fan-name">${esc(c.name)}</span><small>${opening?(selected?"將換掉":"保留"):(c.type==="CHARACTER"?(c.unitType==="HERO"?"HERO":"UNIT"):(c.spellType||"SPELL"))}</small>`}</button>`}).join("");
    const art=preview?cardArt(preview):null,heroPreview=isHeroCard(preview);
    this.host.innerHTML=enemyHtml+
      `<div class="battle-resource">💎 ${state.crystals}/${state.crystalCapacity||state.startingCrystals||4}</div><div class="battle-deck-count">牌庫 ${state.zones.deck.length}</div>`+
      `<div class="fan-hand">${hand||`<div class="deck-empty">目前沒有手牌</div>`}</div>`+
      (opening?`<div class="mulligan-guide"><strong>起手換牌</strong><span>選擇不要的牌；整場僅一次。</span></div><div class="mulligan-actions"><button id="confirmMulligan" ${this.mulligan.size?"":"disabled"}>換掉 ${this.mulligan.size} 張</button><button id="keepOpeningHand">全部保留</button></div>`:"")+
      (!opening&&!targeting&&preview?`<div class="card-preview ${heroPreview?"hero-preview":""}">${heroPreview?heroCardFace(preview,{variant:"preview"}):`<div class="preview-card-face">${art?`<span class="preview-art" style="background-image:url('${art.replace(/'/g,"%27")}')"></span>`:""}<span class="preview-cost">${preview.cost}</span><strong>${esc(preview.name)}</strong><small>${esc(preview.type)}</small><p>${esc(describe(preview))}</p></div>`}<div class="preview-actions"><button id="confirmCardUse">使用</button>${heroPreview?`<button id="openHeroCardInfo" type="button">詳細資訊</button>`:""}<button id="cancelCardPreview">取消</button></div></div>`:"")+
      (this.detailsOpen&&heroPreview&&preview?heroDetailedInformation(preview):"")+
      (targeting?`<div class="card-targeting-bar"><button id="cancelCardTarget">← 取消</button><strong>${esc(pending.name)}</strong><span>${pending.type==="CHARACTER"?"請選擇出生區中的部署格":"請在戰場選擇目標"}</span></div>`:"")+
      (!opening&&!targeting&&phase==="CARD_PHASE"?`<div class="card-phase-actions"><button id="endCardPhase">結束卡牌階段</button></div>`:"");
    this.host.querySelectorAll("[data-card]").forEach(btn=>btn.onclick=()=>{const id=btn.dataset.card;if(opening){this.mulligan.has(id)?this.mulligan.delete(id):this.mulligan.add(id);this.render()}else{this.previewId=id;this.detailsOpen=false;this.render()}});
    this.host.querySelector("#confirmMulligan")?.addEventListener("click",()=>{globalThis.CardPhaseEngine.mulligan(state,[...this.mulligan]);this.mulligan.clear();if(!r.maybeAutoEndCardPhase?.())window.dispatchEvent(new CustomEvent("cardtactics:state"))});
    this.host.querySelector("#keepOpeningHand")?.addEventListener("click",()=>{globalThis.CardPhaseEngine.keepOpeningHand(state);this.mulligan.clear();if(!r.maybeAutoEndCardPhase?.())window.dispatchEvent(new CustomEvent("cardtactics:state"))});
    this.host.querySelector("#confirmCardUse")?.addEventListener("click",()=>{const id=this.previewId;this.previewId=null;this.detailsOpen=false;if(id)r.playCard(id);this.render()});
    this.host.querySelector("#cancelCardPreview")?.addEventListener("click",()=>{this.previewId=null;this.detailsOpen=false;this.render()});
    this.host.querySelector("#openHeroCardInfo")?.addEventListener("click",()=>{this.detailsOpen=true;this.render()});
    this.host.querySelectorAll("[data-close-hero-info]").forEach(node=>node.addEventListener("click",event=>{if(node.dataset.closeHeroInfo==="backdrop"&&event.target!==node)return;this.detailsOpen=false;this.render()}));
    if(this.detailsOpen){
      const scroller=this.host.querySelector(".hero-info-content");
      if(scroller)scroller.scrollTop=previousInfoScroll;
    }
    this.host.querySelector("#cancelCardTarget")?.addEventListener("click",()=>{this.previewId=null;r.cancelCard();this.render()});
    this.host.querySelector("#endCardPhase")?.addEventListener("click",()=>r.endCardPhase());
  }
}
