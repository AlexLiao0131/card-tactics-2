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

function heroDisplay(card){
  const character=globalThis.CharacterDatabase?.get?.(card.characterId)||globalThis.CHARACTERS?.[card.characterId]||null;
  let configured=null;
  try{configured=globalThis.LoadoutDatabase?.resolveCharacter?.(card.characterId,card.loadoutId)||null}catch(_error){}
  const c=configured||character;
  const maxHP=c?.combat?.hp;
  const maxMP=c?.resourceRules?.mana===false?0:(c?.attributes?globalThis.UnitRuntimeEngine?.maxManaFromAttributes?.(c.attributes):null);
  const cardVisual=globalThis.VisualDatabase?.card?.(card.id);
  const artwork=visual(cardVisual,["art","card","image","portrait"])||cardArt(card)||`assets/images/cards/heroes/${encodeURIComponent(card.characterId)}.png`;
  const skills=(c?.skills||[]).slice(0,3).map(id=>{try{return globalThis.SkillDatabase?.get?.(id)?.name||id}catch(_error){return id}});
  const role=c?.lore?.role||c?.title||c?.archetype||"英雄單位";
  const stats=c?.combat||{};
  return{artwork,hp:maxHP??"—",mp:maxMP??"—",role,skills,stats};
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
  const model=heroDisplay(card),src=esc(model.artwork),name=esc(card.name),role=esc(model.role);
  const detail=[...new Set(model.skills)].map(esc).join(" · ");
  const compact=variant==="hand"||variant==="deck";
  return `<span class="hero-card hero-card--${esc(variant)}" data-hero-card="${esc(card.id)}" aria-label="${name}，消耗 ${esc(card.cost)} 水晶，HP ${esc(model.hp)}，MP ${esc(model.mp)}">
    <span class="hero-card__background" aria-hidden="true"></span>
    <span class="hero-card__art"><span class="hero-card__missing">立繪待上傳</span><img class="hero-card__figure" src="${src}" alt="" draggable="false" loading="lazy"></span>
    <span class="hero-card__frame" aria-hidden="true"></span>
    <span class="hero-card__cost" title="消耗水晶數">${esc(card.cost)}</span>
    <span class="hero-card__name">${name}</span>
    <span class="hero-card__role">${role}</span>
    <span class="hero-card__details">${compact?"":esc(detail||describe(card))}</span>
    <span class="hero-card__hp" title="角色基礎 HP">${esc(model.hp)}</span>
    <span class="hero-card__mp" title="角色初始 MP">${esc(model.mp)}</span>
    <span class="hero-card__rarity">HERO</span>
  </span>`;
}

globalThis.CardTacticsHeroCard=Object.freeze({face:heroCardFace,isHero:isHeroCard,ensureStyles:ensureHeroCardStyles});

export class CardHandUI{
  constructor(){this.host=document.getElementById("cardPhasePanel");this.runtime=null;this.previewId=null;this.mulligan=new Set();ensureHeroCardStyles()}
  bind(runtime){this.runtime=runtime;window.addEventListener("cardtactics:state",()=>this.render());window.addEventListener("cardtactics:battle-render",()=>this.render());this.render()}
  render(){
    const r=this.runtime;if(!r)return;const state=r.getCardState(),phase=r.getPhase(),pending=r.getPendingCard(),enemy=r.getEnemyCardState?.(),view=r.getEnemyPresentation?.();
    if(!state){this.host.innerHTML="";return}
    this.host.classList.toggle("battle-pass-through",phase!=="CARD_PHASE");
    if(phase!=="CARD_PHASE")this.previewId=null;
    const cards=globalThis.CardDatabase.list(state.zones.hand),opening=phase==="CARD_PHASE"&&state.mulliganAvailable&&!state.mulliganDone;
    if(pending)this.previewId=null;if(this.previewId&&!cards.some(c=>c.id===this.previewId))this.previewId=null;
    const preview=this.previewId?globalThis.CardDatabase.get(this.previewId):null,targeting=!!pending;
    const enemyMotion=phase==="ENEMY_TURN"?(view?.kind==="DRAW"?"enemy-draw":view?.kind==="CARD_SELECT"?"enemy-select":"enemy-thinking"):"";
    const enemyHtml=enemy?`<div class="opponent-hand ${enemyMotion}">${Array.from({length:enemy.zones?.hand?.length||0},(_,i)=>`<i class="opponent-card-back" style="--fan:${i-((enemy.zones?.hand?.length||1)-1)/2};--i:${i}"></i>`).join("")}</div><div class="opponent-meta">敵方　💎 ${enemy.crystals||0}/${enemy.crystalCapacity||0}　牌庫 ${enemy.zones?.deck?.length||0}</div>${phase==="ENEMY_TURN"?`<div class="opponent-message">${esc(view?.message||"敵方思考中…")}</div>`:""}`:"";
    const hand=cards.map((c,i)=>{const art=cardArt(c),off=i-(cards.length-1)/2,selected=this.mulligan.has(c.id),disabled=!opening&&!(phase==="CARD_PHASE"&&(r.canPlayCard?.(c.id)??globalThis.CardPhaseEngine.canPlay(state,c))),hero=isHeroCard(c);return`<button class="fan-card ${hero?"hero-fan-card":""} ${selected?"mulligan-selected":""} ${pending?.id===c.id?"pending":""}" data-card="${esc(c.id)}" style="--fan:${off};--i:${i}" ${disabled?"disabled":""}>${hero?heroCardFace(c,{variant:"hand"}):`${art?`<span class="fan-art" style="background-image:url('${art.replace(/'/g,"%27")}')"></span>`:""}<span class="fan-sheen"></span><span class="fan-cost">${c.cost}</span><span class="fan-name">${esc(c.name)}</span><small>${opening?(selected?"將換掉":"保留"):(c.type==="CHARACTER"?(c.unitType==="HERO"?"HERO":"UNIT"):(c.spellType||"SPELL"))}</small>`}</button>`}).join("");
    const art=preview?cardArt(preview):null,heroPreview=isHeroCard(preview);
    this.host.innerHTML=enemyHtml+
      `<div class="battle-resource">💎 ${state.crystals}/${state.crystalCapacity||state.startingCrystals||4}</div><div class="battle-deck-count">牌庫 ${state.zones.deck.length}</div>`+
      `<div class="fan-hand">${hand||`<div class="deck-empty">目前沒有手牌</div>`}</div>`+
      (opening?`<div class="mulligan-guide"><strong>起手換牌</strong><span>選擇不要的牌；整場僅一次。</span></div><div class="mulligan-actions"><button id="confirmMulligan" ${this.mulligan.size?"":"disabled"}>換掉 ${this.mulligan.size} 張</button><button id="keepOpeningHand">全部保留</button></div>`:"")+
      (!opening&&!targeting&&preview?`<div class="card-preview ${heroPreview?"hero-preview":""}"><div class="preview-card-face">${heroPreview?heroCardFace(preview,{variant:"preview"}):`${art?`<span class="preview-art" style="background-image:url('${art.replace(/'/g,"%27")}')"></span>`:""}<span class="preview-cost">${preview.cost}</span><strong>${esc(preview.name)}</strong><small>${esc(preview.type)}</small><p>${esc(describe(preview))}</p>`}</div><div class="preview-actions"><button id="confirmCardUse">使用</button><button id="cancelCardPreview">取消</button></div></div>`:"")+
      (targeting?`<div class="card-targeting-bar"><button id="cancelCardTarget">← 取消</button><strong>${esc(pending.name)}</strong><span>${pending.type==="CHARACTER"?"請選擇出生區中的部署格":"請在戰場選擇目標"}</span></div>`:"")+
      (!opening&&!targeting&&phase==="CARD_PHASE"?`<div class="card-phase-actions"><button id="endCardPhase">結束卡牌階段</button></div>`:"");
    this.host.querySelectorAll("[data-card]").forEach(btn=>btn.onclick=()=>{const id=btn.dataset.card;if(opening){this.mulligan.has(id)?this.mulligan.delete(id):this.mulligan.add(id);this.render()}else{this.previewId=id;this.render()}});
    this.host.querySelector("#confirmMulligan")?.addEventListener("click",()=>{globalThis.CardPhaseEngine.mulligan(state,[...this.mulligan]);this.mulligan.clear();if(!r.maybeAutoEndCardPhase?.())window.dispatchEvent(new CustomEvent("cardtactics:state"))});
    this.host.querySelector("#keepOpeningHand")?.addEventListener("click",()=>{globalThis.CardPhaseEngine.keepOpeningHand(state);this.mulligan.clear();if(!r.maybeAutoEndCardPhase?.())window.dispatchEvent(new CustomEvent("cardtactics:state"))});
    this.host.querySelector("#confirmCardUse")?.addEventListener("click",()=>{const id=this.previewId;this.previewId=null;if(id)r.playCard(id);this.render()});
    this.host.querySelector("#cancelCardPreview")?.addEventListener("click",()=>{this.previewId=null;this.render()});
    this.host.querySelector("#cancelCardTarget")?.addEventListener("click",()=>{this.previewId=null;r.cancelCard();this.render()});
    this.host.querySelector("#endCardPhase")?.addEventListener("click",()=>r.endCardPhase());
  }
}
