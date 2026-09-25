(()=> {
  const host=document.getElementById("cardPhasePanel");if(!host||!window.CardTacticsRuntime)return;
  host.closest(".card")?.classList.add("battle-hand-shell");
  let previewId=null,mulliganSelected=new Set();

  const WEATHER_LABEL=Object.freeze({
    CLEAR:"晴朗",FOG:"迷霧",RAIN:"降雨",HEAVY_RAIN:"豪大雨",
    THUNDERSTORM:"雷雨",SNOW:"降雪",BLIZZARD:"暴風雪"
  });
  const TRAIT_LABEL=Object.freeze({
    AQUATIC:"水棲",WATER_WALK:"水上行走",FOREST_WALK:"森林行走",
    MOUNTAIN_WALK:"山地行走",IGNORE_GROUND_TERRAIN:"無視地面地形"
  });


  const VISUAL_STYLE_ID="ct-card-visual-style";
  function ensureVisualStyles(){
    if(document.getElementById(VISUAL_STYLE_ID))return;
    const style=document.createElement("style");
    style.id=VISUAL_STYLE_ID;
    style.textContent=`
      .fan-card,.preview-card-face{position:relative;overflow:hidden}
      .fan-card .fan-art,.preview-card-illustration{position:absolute;inset:0;background-size:cover;background-position:center top;background-repeat:no-repeat;pointer-events:none}
      .fan-card .fan-art{opacity:.72;filter:saturate(1.04)}
      .fan-card .fan-sheen,.preview-card-illustration::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,10,18,.04) 0%,rgba(4,10,18,.18) 28%,rgba(4,10,18,.58) 74%,rgba(4,10,18,.86) 100%);pointer-events:none}
      .fan-card > *:not(.fan-art):not(.fan-sheen){position:relative;z-index:1}
      .fan-card.has-art small{color:#e7edf5;text-shadow:0 1px 2px rgba(0,0,0,.8)}
      .preview-card-face{min-height:250px;padding-top:156px!important}
      .preview-card-illustration{opacity:.95;inset:0 0 auto 0;height:172px;border-bottom:1px solid rgba(255,255,255,.12)}
      .preview-card-face > *:not(.preview-card-illustration){position:relative;z-index:1}
      .preview-card-face strong,.preview-card-face small,.preview-card-face .preview-cost{text-shadow:0 1px 2px rgba(0,0,0,.8)}
      .preview-card-face.no-art{padding-top:52px!important}
    `;
    document.head.appendChild(style);
  }
  function resolveVisualCandidate(obj,keys){if(!obj)return null;for(const k of keys){const path=String(k).split(".");let cur=obj;for(const seg of path){cur=cur?.[seg];if(cur==null)break;}if(typeof cur==="string"&&cur)return cur}return null}
  function resolveCardArt(card){if(!card)return null;const self=resolveVisualCandidate(card,["card","art.card","visual.card","assets.card","portrait","art.portrait","visual.portrait","assets.portrait","image"]);if(self)return self;const character=window.CHARACTERS?.[card.characterId];return resolveVisualCandidate(character,["card","art.card","visual.card","assets.card","portrait","art.portrait","visual.portrait","assets.portrait","image"])}
  function artLayer(url,cls){return url?`<span class="${cls}" style="background-image:url('${String(url).replace(/'/g,"%27")}')"></span>`:"";}

  function kind(card){return card.type==="CHARACTER"?(card.unitType==="HERO"?"英雄角色卡":"角色卡"):"卡牌魔法";}

  function keywords(card){
    const out=[];
    if(card.type==="CHARACTER"){
      out.push(card.unitType==="HERO"?"英雄":"角色");
      if(card.faction&&card.faction!=="NEUTRAL")out.push(card.faction);
      const character=window.CHARACTERS?.[card.characterId];
      const trait=(character?.terrainTraits||[]).find(t=>TRAIT_LABEL[t]);
      if(trait)out.push(TRAIT_LABEL[trait]);
    }else{
      out.push(card.spellType==="WEATHER"?"天候":"魔法");
      const effect=card.effect||{};
      if(effect.weather)out.push(WEATHER_LABEL[effect.weather]||effect.weather);
      else if(effect.type==="AREA_FIRE")out.push("火焰");
      else if(effect.type==="AREA_PUSH")out.push("位移");
      else if(effect.type==="AREA_HEAL")out.push("治療");
      else if(effect.type==="AREA_DAMAGE")out.push("範圍");
      else if(effect.type==="HYDROLOGY_FLOOD")out.push("水文");
      else if(effect.type==="TRAP")out.push("陷阱");
      else if(effect.type==="REVIVE")out.push("復活");
      if(effect.durationTurns)out.push(`${effect.durationTurns}回合`);
    }
    return out.slice(0,3);
  }

  function describeCharacter(card){
    const c=window.CHARACTERS?.[card.characterId];
    if(!c)return"部署一名角色到我方可部署區域。";
    const s=c.combat||{};
    const traits=(c.terrainTraits||[]).map(t=>TRAIT_LABEL[t]).filter(Boolean);
    const base=`部署 ${c.name}。HP ${s.hp??"-"}｜ATK ${s.atk??"-"}｜DEF ${s.def??"-"}｜MOVE ${s.move??"-"}。`;
    return traits.length?`${base} 地形特性：${traits.join("、")}。`:base;
  }

  function describeWeather(effect){
    const duration=Number(effect.durationTurns||0);
    const suffix=duration?`，持續 ${duration} 回合`:"";
    if(effect.weather==="FOG")return`將天候改為迷霧${suffix}；限制視野與遠距離觀測。`;
    if(effect.weather==="RAIN")return`開始降雨${suffix}；先使地面泥濘，土壤飽和後才逐步形成積水。`;
    if(effect.weather==="HEAVY_RAIN")return`降下豪大雨${suffix}；快速增加地表與河川水量，可能造成河流暴漲與低窪淹水。`;
    if(effect.weather==="THUNDERSTORM")return`形成雷雨${suffix}；具有豪雨級降水，雷擊命中水域時可沿相連水體傳導。`;
    if(effect.weather==="SNOW")return`開始降雪${suffix}；低溫區與高地累積積雪，水域可能逐步結冰。`;
    if(effect.weather==="BLIZZARD")return`形成暴風雪${suffix}；快速積雪、降低視野，並提高高山雪崩風險。`;
    return`將天候改為 ${WEATHER_LABEL[effect.weather]||effect.weather}${suffix}。`;
  }

  function describeSpell(card){
    const e=card.effect||{};
    if(e.type==="WEATHER")return describeWeather(e);
    if(e.type==="AREA_FIRE")return`以指定格為中心半徑 ${Number(e.radius||0)} 點燃區域；可燃地形著火後會向相鄰可燃物延燒。`;
    if(e.type==="AREA_PUSH")return`以指定格為中心半徑 ${Number(e.radius||0)} 產生強風，推動 ${Number(e.distance||0)} 格並造成抬升；可能引發碰撞與墜落。`;
    if(e.type==="AREA_HEAL")return`治療指定範圍內的我方單位，每名回復 ${Number(e.heal||0)} HP。`;
    if(e.type==="AREA_DAMAGE")return`對指定格周圍半徑 ${Number(e.radius||0)} 造成 ${Number(e.damage||0)} 傷害，並觸發其環境力量。`;
    if(e.type==="HYDROLOGY_FLOOD")return`向指定區域注入水量並提高水面；水會依地勢重新分配，可能造成局部淹水。`;
    if(e.type==="TRAP")return"在指定位置設置陷阱；敵方進入時觸發。";
    if(e.type==="BUFF")return"為目標提供增益效果；實際效果依此卡牌設定解析。";
    if(e.type==="REVIVE")return"從墓地復甦符合條件的角色卡。";
    return"施放卡牌效果；實際目標與環境互動會依戰場狀態解析。";
  }

  function describe(card){
    if(!card)return"";
    return card.type==="CHARACTER"?describeCharacter(card):describeSpell(card);
  }

  function render(){
    ensureVisualStyles();
    const state=CardTacticsRuntime.getCardState();if(!state)return;
    const phase=CardTacticsRuntime.getPhase(),pending=CardTacticsRuntime.getPendingCard();
    const enemyState=CardTacticsRuntime.getEnemyCardState?.(),enemyView=CardTacticsRuntime.getEnemyPresentation?.();
    const cards=CardDatabase.list(state.zones.hand);
    const opening=phase==="CARD_PHASE"&&state.mulliganAvailable&&!state.mulliganDone;
    if(previewId&&!cards.some(c=>c.id===previewId))previewId=null;
    if(pending)previewId=null;
    const preview=previewId?CardDatabase.get(previewId):null,targeting=!!pending;
    host.classList.toggle("targeting-mode",targeting);host.classList.toggle("mulligan-mode",opening);
    const enemyMotion=phase==="ENEMY_TURN"?(enemyView?.kind==="DRAW"?"enemy-draw":enemyView?.kind==="CARD_SELECT"?"enemy-select":"enemy-thinking"):"";
    const enemyHtml=enemyState?`<div class="opponent-hand ${enemyMotion}">${Array.from({length:enemyState.zones?.hand?.length||0},(_,i)=>`<i class="opponent-card-back" style="--fan:${i-((enemyState.zones?.hand?.length||1)-1)/2};--i:${i}"></i>`).join("")}</div><div class="opponent-meta">敵方　💎 ${enemyState.crystals||0}/${enemyState.crystalCapacity||0}　牌庫 ${enemyState.zones?.deck?.length||0}</div>${phase==="ENEMY_TURN"?`<div class="opponent-message">${enemyView?.message||"敵方思考中…"}</div>`:""}${phase==="ENEMY_TURN"&&enemyView?.cardId?`<div class="enemy-play-reveal">${CardDatabase.get(enemyView.cardId)?.name||""}</div>`:""}`:"";
    host.innerHTML=enemyHtml+
      `<div class="battle-resource">💎 ${state.crystals}/${state.crystalCapacity||state.startingCrystals||4}</div><div class="battle-deck-count">牌庫 ${state.zones.deck.length}</div>`+
      (opening?`<div class="mulligan-guide"><strong>起手換牌</strong><span>選擇不要的牌；整場僅一次。</span></div>`:"")+
      `<div class="fan-hand">${cards.map((c,i)=>{const sel=mulliganSelected.has(c.id),offset=i-(cards.length-1)/2;const tags=keywords(c).join("・");const art=resolveCardArt(c);return `<button class="fan-card ${art?"has-art":""} ${sel?"mulligan-selected":""} ${pending?.id===c.id?"pending":""}" data-card="${c.id}" style="--fan:${offset};--i:${i}" ${!opening&&!(phase==="CARD_PHASE"&&CardPhaseEngine.canPlay(state,c))?"disabled":""}>${artLayer(art,"fan-art")}<span class="fan-sheen"></span><span class="fan-cost">${c.cost}</span><span class="fan-name">${c.name}</span><small>${opening?(sel?"將換掉":"保留"):(tags||kind(c))}</small></button>`;}).join("")||`<div class="empty-hand">目前沒有手牌</div>`}</div>`+
      (opening?`<div class="mulligan-actions"><button id="confirmMulligan" ${mulliganSelected.size?"":"disabled"}>換掉 ${mulliganSelected.size} 張</button><button id="keepOpeningHand">全部保留</button></div>`:"")+
      (!opening&&!targeting&&preview?(()=>{const art=resolveCardArt(preview);return `<div class="card-preview"><div class="preview-card-face ${art?"":"no-art"}">${artLayer(art,"preview-card-illustration")}<span class="preview-cost">${preview.cost}</span><strong>${preview.name}</strong><small>${keywords(preview).join("・")||kind(preview)}</small><p class="preview-description">${describe(preview)}</p></div><div class="preview-question">要使用這張卡嗎？</div><div class="preview-actions"><button id="confirmCardUse">使用</button><button id="cancelCardPreview">取消</button></div></div>`;})():"")+
      (targeting?`<div class="card-targeting-bar"><button id="cancelCardDeploy">← 取消</button><strong>${pending.name}</strong><span>${pending.type==="CHARACTER"?"請選擇部署位置":"請在戰場選擇目標"}</span></div>`:"")+
      (!opening?`<div class="card-phase-compact-actions"><button id="endCardPhase" ${phase==="CARD_PHASE"&&!targeting?"":"disabled"}>結束卡牌階段</button></div>`:"");
    host.querySelectorAll("[data-card]").forEach(btn=>btn.onclick=()=>{
      const id=btn.dataset.card;
      if(opening){mulliganSelected.has(id)?mulliganSelected.delete(id):mulliganSelected.add(id);render();return;}
      previewId=id;render();
    });
    host.querySelector("#confirmMulligan")?.addEventListener("click",()=>{
      CardPhaseEngine.mulligan(state,[...mulliganSelected]);mulliganSelected.clear();
      window.dispatchEvent(new CustomEvent("cardtactics:state"));
    });
    host.querySelector("#keepOpeningHand")?.addEventListener("click",()=>{
      CardPhaseEngine.keepOpeningHand(state);mulliganSelected.clear();
      window.dispatchEvent(new CustomEvent("cardtactics:state"));
    });
    host.querySelector("#confirmCardUse")?.addEventListener("click",()=>{
      const id=previewId;
      previewId=null;
      if(id)CardTacticsRuntime.playCard(id);
      render();
    });
    host.querySelector("#cancelCardPreview")?.addEventListener("click",()=>{previewId=null;render();});
    host.querySelector("#endCardPhase")?.addEventListener("click",()=>CardTacticsRuntime.endCardPhase());
    host.querySelector("#cancelCardDeploy")?.addEventListener("click",()=>{
      previewId=null;
      CardTacticsRuntime.cancelCard();
      render();
    });
  }
  window.addEventListener("cardtactics:state",render);render();
})();
