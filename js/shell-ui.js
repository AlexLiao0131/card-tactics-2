const $=id=>document.getElementById(id);
export class ShellUI{
  constructor(runtime,renderer){
    this.runtime=runtime;this.renderer=renderer;this.screens=[...document.querySelectorAll(".game-screen")];
    this.deck=[...globalThis.DeckEngine.getActive()];this.activeGroup=globalThis.PackDatabase.list()[0]?.id||null;
    this.deckReturn="menuScreen";this.deckCanDeploy=false;this.activeShopPack=globalThis.PackDatabase.products?.({season:"TEST_SEASON"})?.[0]?.id||null;
    this.shopMode="PACK";this.geminiWanted=false;this.startingBattle=false;this.prepSelectedKey=null;this.cardInspector=null;this.cardInspectorOrigin=null;
  }
  show(id){if(id!=="deckScreen"&&id!=="shopScreen")this.closeCardPreview({restoreFocus:false});this.screens.forEach(s=>s.classList.toggle("active",s.id===id));if(id==="battleScreen")requestAnimationFrame(()=>{this.renderer.resize();this.renderer.resetView();window.dispatchEvent(new CustomEvent("cardtactics:battle-screen-enter"))});}
  validDeck(){const result=globalThis.DeckEngine.validate(this.deck);if(!result.valid){alert(result.errors.join("\n"));return false;}return true;}
  bind(){
    globalThis.CardTacticsHeroCard?.ensureStyles?.();
    $("pressStart").onclick=()=>this.show("menuScreen");$("menuCampaign").onclick=()=>this.show("campaignScreen");$("menuVersus").onclick=()=>{this.updateVersusMeta();this.show("versusScreen")};$("menuCards").onclick=()=>this.openDeck({from:"menuScreen",deploy:false});$("menuShop").onclick=()=>{this.renderShop();this.show("shopScreen")};$("menuSave").onclick=()=>this.show("saveScreen");$("menuSettings").onclick=()=>this.show("settingsScreen");
    document.querySelectorAll("[data-back]").forEach(b=>b.onclick=()=>this.show(b.dataset.back));
    $("campaignPrototype").onclick=()=>{this.geminiWanted=false;this.openDeck({from:"campaignScreen",deploy:true})};
    $("versusAi").onclick=()=>{this.geminiWanted=false;this.openDeck({from:"versusScreen",deploy:true})};
    const geminiButton=document.createElement("button");geminiButton.id="versusGemini";geminiButton.type="button";geminiButton.className="primary-button";
    geminiButton.textContent="VS Gemini｜AI 指揮官";geminiButton.onclick=()=>{this.geminiWanted=true;this.openDeck({from:"versusScreen",deploy:true})};
    $("versusAi").insertAdjacentElement("afterend",geminiButton);
    $("versusMapSize").onchange=()=>this.updateVersusMeta();
    $("deckBack").onclick=()=>this.show(this.deckReturn);
    $("autoDeck").onclick=()=>this.replaceDeck(globalThis.DeckEngine.autoBuild(this.activeGroup));
    $("applyDeck").onclick=()=>{if(!this.validDeck())return;globalThis.DeckEngine.setActive(this.deck);this.renderDeck()};
    $("saveDeck").onclick=()=>{if(!this.validDeck())return;const n=prompt("牌組名稱",globalThis.PackDatabase.get(this.activeGroup)?.name||"我的牌組");if(n)globalThis.DeckEngine.save(n,this.deck)};
    $("loadDeck").onclick=()=>{const names=Object.keys(globalThis.DeckEngine.saved());if(!names.length){alert("目前沒有已儲存牌組。");return}const n=prompt(`輸入牌組名稱：\n${names.join("\n")}`,names[0]);if(n)this.replaceDeck(globalThis.DeckEngine.load(n))};
    $("deployDeck").onclick=()=>this.openPreparation();$("prepBack").onclick=()=>this.show("deckScreen");$("startPreparedBattle").onclick=()=>this.startBattle();$("battleBack").onclick=()=>this.show("menuScreen");
    document.querySelectorAll("[data-shop-mode]").forEach(b=>b.onclick=()=>{this.shopMode=b.dataset.shopMode;this.renderShop()});
    document.addEventListener("keydown",event=>{if(event.key!=="Escape"||!this.cardInspector)return;const info=this.cardInspector.querySelector(".hero-info-overlay");if(info)info.remove();else this.closeCardPreview();});
    this.updateVersusMeta();this.show("titleScreen");
  }
  cardLabel(c){const type=c.type==="CHARACTER"?(c.unitType==="HERO"?"HERO":"UNIT"):(c.spellType||"SPELL");return`<strong>${c.name}</strong><span>${type}　💎 ${c.cost}</span>`}
  collectionFace(c,variant="collection"){
    const hero=globalThis.CardTacticsHeroCard?.isHero(c);
    return`<span class="collection-entry__face ${hero?"":"collection-entry__face--text"}">${hero?globalThis.CardTacticsHeroCard.face(c,{variant}):this.cardLabel(c)}</span>`;
  }
  openDeck({from,deploy}){this.deckReturn=from;this.deckCanDeploy=deploy;$("deckScreenTitle").textContent=deploy?"出擊牌組設定":"卡牌整理";this.renderTabs();this.renderGroup();this.renderDeck();this.show("deckScreen")}
  renderTabs(){const packs=globalThis.PackDatabase.list();if(!this.activeGroup)this.activeGroup=packs[0]?.id;$("packTabs").innerHTML=packs.map(p=>`<button class="pack-tab ${p.id===this.activeGroup?"active":""}" data-group="${p.id}">${p.name}</button>`).join("");document.querySelectorAll("[data-group]").forEach(b=>b.onclick=()=>{this.activeGroup=b.dataset.group;this.renderTabs();this.renderGroup()})}
  renderGroup(){
    const cards=globalThis.PackDatabase.cards(this.activeGroup);
    $("packCards").innerHTML=cards.map(c=>{
      const count=this.deck.filter(id=>id===c.id).length,chosen=count>0;
      return`<button type="button" class="collection-entry ${chosen?"chosen":""}" data-card="${c.id}" aria-label="查看 ${c.name} 的卡牌介紹">${this.collectionFace(c)}<em class="collection-entry__action">${c.unitType==="HERO"?(chosen?"HERO 已加入":"點擊查看"):(chosen?`牌組 ×${count}｜查看`:"點擊查看")}</em></button>`;
    }).join("");
    $("packCards").querySelectorAll("[data-card]").forEach(button=>button.addEventListener("click",()=>this.openCardPreview(button.dataset.card,{allowAdd:true})));
  }
  cardIntroduction(card){
    if(card.type==="CHARACTER"){
      const character=globalThis.CharacterDatabase?.get?.(card.characterId)||globalThis.CHARACTERS?.[card.characterId];
      return character?.lore?.introduction||character?.lore?.summary||character?.lore?.notes||character?.lore?.role||character?.title||"角色介紹尚未設定。";
    }
    if(card.description)return card.description;
    const effect=card.effect||{},parts=[];
    const effectType={WEATHER:"改變戰場天氣",AREA_DAMAGE:"範圍傷害",AREA_HEAL:"範圍治療",AREA_PUSH:"範圍位移",AREA_FIRE:"範圍火焰",AREA_BUFF:"範圍增益",DISPEL:"狀態驅散",TRAP:"陷阱",BUFF:"增益",REVIVE:"復甦",HYDROLOGY_FLOOD:"水文洪水",WHIRLPOOL:"漩渦",RACE_NIGHT_BUFF:"夜間族群增益",AREA_RELATION:"範圍陣營效果"};
    parts.push(effectType[effect.type]||card.spellType||"法術卡");
    if(effect.weather)parts.push(`天氣：${effect.weather}`);
    if(effect.durationTurns!=null)parts.push(`持續 ${effect.durationTurns} 回合`);
    if(effect.radius!=null)parts.push(`範圍半徑 ${effect.radius}`);
    if(effect.damage!=null)parts.push(`傷害 ${effect.damage}`);
    if(effect.heal!=null)parts.push(`治療 ${effect.heal}`);
    if(effect.distance!=null)parts.push(`位移 ${effect.distance} 格`);
    return parts.join("｜");
  }
  openCardPreview(id,{allowAdd=false}={}){
    const card=globalThis.CardDatabase.get(id);if(!card)return;
    this.closeCardPreview({restoreFocus:false});this.cardInspectorOrigin=document.activeElement;
    const escapeText=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const introduction=this.cardIntroduction(card),isCharacter=card.type==="CHARACTER";
    const root=document.createElement("div");root.className="collection-inspector";
    const canAdd=allowAdd&&globalThis.DeckEngine.canAdd(this.deck,card.id);
    const status=this.deck.length>=globalThis.DeckEngine.BATTLE_DECK_SIZE?"牌組已滿":card.unitType==="HERO"&&this.deck.includes(card.id)?"HERO 已加入牌組":`目前牌組 ${this.deck.filter(cardId=>cardId===card.id).length} 張`;
    root.innerHTML=`<section class="collection-inspector__dialog" role="dialog" aria-modal="true" aria-label="${escapeText(card.name)} 卡牌預覽">
      <header class="collection-inspector__header"><strong>${escapeText(card.name)}</strong><button type="button" data-inspector-close aria-label="關閉卡牌預覽">✕</button></header>
      <div class="collection-inspector__body">
        <div class="collection-inspector__card">${this.collectionFace(card,"preview")}</div>
        <div class="collection-inspector__description">
          <p class="collection-inspector__meta">${escapeText(card.unitType||card.spellType||card.type)}　💎 ${escapeText(card.cost)}</p>
          <h3>${isCharacter?"角色介紹":"卡牌效果"}</h3>
          <div class="collection-inspector__introduction" role="region" tabindex="0" aria-label="${isCharacter?"角色介紹":"卡牌效果"}，可上下捲動"><p>${escapeText(introduction)}</p></div>
          ${isCharacter?'<button type="button" data-inspector-details>詳細資訊（能力／技能／被動）</button>':""}
        </div>
      </div>
      <footer class="collection-inspector__footer"><span data-inspector-status>${escapeText(status)}</span>${allowAdd?`<button type="button" data-inspector-add ${canAdd?"":"disabled"}>${canAdd?"加入牌組":status}</button>`:""}<button type="button" data-inspector-close>關閉</button></footer>
    </section>`;
    root.addEventListener("click",event=>{
      if(event.target===root||event.target.closest("[data-inspector-close]")){this.closeCardPreview();return;}
      const closeInfo=event.target.closest("[data-close-hero-info]");
      if(closeInfo){if(closeInfo.dataset.closeHeroInfo!=="backdrop"||event.target===closeInfo)root.querySelector(".hero-info-overlay")?.remove();return;}
      if(event.target.closest("[data-inspector-details]")){
        const info=globalThis.CardTacticsHeroCard?.detail?.(card);
        if(info&&!root.querySelector(".hero-info-overlay")){root.insertAdjacentHTML("beforeend",info);root.querySelector(".hero-info-header button")?.focus();}
        return;
      }
      if(event.target.closest("[data-inspector-add]")&&allowAdd){
        if(!globalThis.DeckEngine.canAdd(this.deck,card.id))return;
        this.deck.push(card.id);this.renderDeck();this.renderGroup();
        const statusLabel=root.querySelector("[data-inspector-status]");
        if(statusLabel)statusLabel.textContent=this.deck.length>=globalThis.DeckEngine.BATTLE_DECK_SIZE?"牌組已滿":`目前牌組 ${this.deck.filter(cardId=>cardId===card.id).length} 張`;
        const addButton=root.querySelector("[data-inspector-add]");
        if(addButton){const canContinue=globalThis.DeckEngine.canAdd(this.deck,card.id);addButton.disabled=!canContinue;addButton.textContent=canContinue?"再加入一張":(this.deck.length>=globalThis.DeckEngine.BATTLE_DECK_SIZE?"牌組已滿":"HERO 已加入");}
      }
    });
    document.body.appendChild(root);this.cardInspector=root;root.querySelector("[data-inspector-close]")?.focus();
  }
  closeCardPreview({restoreFocus=true}={}){
    if(!this.cardInspector)return;this.cardInspector.remove();this.cardInspector=null;
    const origin=this.cardInspectorOrigin;this.cardInspectorOrigin=null;
    if(restoreFocus&&origin?.isConnected)origin.focus();
  }
  renderDeck(){
    const result=globalThis.DeckEngine.validate(this.deck);
    $("deckCount").textContent=`目前牌組 ${this.deck.length}/${result.required} 張${result.valid?"｜整備完成":"｜尚未完成"}`;
    $("deckList").innerHTML=this.deck.length?this.deck.map((id,i)=>`<div class="deck-row deck-row--preview"><button type="button" data-deck-preview="${id}" aria-label="查看 ${globalThis.CardDatabase.get(id)?.name||id} 的卡牌介紹">${globalThis.CardDatabase.get(id)?.name||id}</button><button type="button" data-remove="${i}">移除</button></div>`).join(""):`<div class="deck-empty">尚未加入卡牌</div>`;
    $("deckList").querySelectorAll("[data-deck-preview]").forEach(b=>b.addEventListener("click",()=>this.openCardPreview(b.dataset.deckPreview,{allowAdd:false})));
    $("deckList").querySelectorAll("[data-remove]").forEach(b=>b.addEventListener("click",()=>{this.deck.splice(Number(b.dataset.remove),1);this.renderDeck();this.renderGroup()}));
    $("deployDeck").hidden=!this.deckCanDeploy;$("deployDeck").disabled=!result.valid;
    $("applyDeck").disabled=!result.valid;$("saveDeck").disabled=!result.valid;
  }
  replaceDeck(ids){this.deck.splice(0,this.deck.length,...globalThis.DeckEngine.normalize(ids).slice(0,globalThis.DeckEngine.BATTLE_DECK_SIZE));this.renderDeck();this.renderGroup()}
  openPreparation(){if(!this.validDeck())return;globalThis.DeckEngine.setActive(this.deck);ItemInventoryEngine.syncPreparationsForDeck(this.deck);const entries=ItemInventoryEngine.deckEntries(this.deck);this.prepSelectedKey=entries[0]?.key||null;this.renderPreparation();this.show("preparationScreen")}
  renderPreparation(){
    const entries=ItemInventoryEngine.deckEntries(this.deck),selected=entries.find(e=>e.key===this.prepSelectedKey)||entries[0]||null;if(selected)this.prepSelectedKey=selected.key;
    $("prepGold").textContent=`Gold ${ItemInventoryEngine.gold()} G`;$("prepSummary").textContent=`出擊牌組 ${this.deck.length}/${globalThis.DeckEngine.BATTLE_DECK_SIZE} 張｜角色卡 ${entries.length} 張｜道具倉庫 ${Object.values(ItemInventoryEngine.stash()).reduce((a,b)=>a+Number(b||0),0)} 件`;
    $("prepCharacters").innerHTML=entries.length?entries.map(entry=>{const slots=ItemInventoryEngine.slotCountForCard(entry.card),prep=ItemInventoryEngine.preparation(entry.key,slots);return`<article class="prep-character ${entry.key===this.prepSelectedKey?"active":""}" data-prep-character="${entry.key}"><button class="prep-character-select" type="button"><strong>${entry.card.name}${entry.occurrence>1?` #${entry.occurrence}`:""}</strong><span>${entry.card.unitType==="HERO"?"HERO":"UNIT"}</span></button><div class="prep-slots">${prep.slots.map((id,i)=>`<button type="button" data-prep-slot="${entry.key}|${i}" class="prep-slot">${id?(ItemDatabase.get(id)?.name||id):`空欄 ${i+1}`}</button>`).join("")}</div></article>`}).join(""):`<div class="deck-empty">牌組內沒有角色卡。</div>`;
    document.querySelectorAll("[data-prep-character]").forEach(node=>node.querySelector(".prep-character-select").onclick=()=>{this.prepSelectedKey=node.dataset.prepCharacter;this.renderPreparation()});
    document.querySelectorAll("[data-prep-slot]").forEach(b=>b.onclick=()=>{const[key,slot]=b.dataset.prepSlot.split("|");const entry=entries.find(e=>e.key===key);if(entry&&ItemInventoryEngine.unequip(key,Number(slot),ItemInventoryEngine.slotCountForCard(entry.card)))this.renderPreparation()});
    const stash=ItemInventoryEngine.stash();$("prepStash").innerHTML=ItemDatabase.list().map(item=>{const have=Number(stash[item.id]||0),available=ItemInventoryEngine.availableCount(item.id),disabled=!selected||available<=0;return`<button class="prep-stash-row" type="button" data-prep-item="${item.id}" ${disabled?"disabled":""}><strong>${item.name}</strong><span>持有 ${have}｜可配置 ${available}</span><small>${item.description}</small></button>`}).join("");
    document.querySelectorAll("[data-prep-item]").forEach(b=>b.onclick=()=>{if(!selected)return;const slots=ItemInventoryEngine.slotCountForCard(selected.card),prep=ItemInventoryEngine.preparation(selected.key,slots),slot=prep.slots.findIndex(id=>!id);if(slot<0){alert("這個角色的道具欄已滿。");return}if(ItemInventoryEngine.equip(selected.key,slot,b.dataset.prepItem,slots))this.renderPreparation()});
  }
  async startBattle(){
    if(this.startingBattle||!this.validDeck())return;
    this.startingBattle=true;
    const versus=this.deckReturn==="versusScreen",itemLoadouts=ItemInventoryEngine.loadoutsForDeck(this.deck);
    globalThis.CardTacticsBattleSetup={stageId:versus?"versus_core_battle":"prototype_battle",deck:[...this.deck],itemLoadouts,...(versus?{mapSize:$("versusMapSize").value||"MEDIUM",seed:globalThis.MapGenerator.randomSeed()}: {})};
    try{
      if(this.geminiWanted&&versus){
        // Preparation completes BEFORE the authoritative battle is created.
        // The player's deck/item choices remain unchanged.
        await this.runtime.prepareGeminiMatch();
      }else this.runtime.clearGeminiMatch();
      ItemInventoryEngine.beginBattle(itemLoadouts);this.runtime.resetBattle();this.show("battleScreen");
    }finally{this.startingBattle=false;}
  }
  updateVersusMeta(){const p=globalThis.MapGenerator?.preset?.($("versusMapSize").value);$("versusMapMeta").textContent=p?`${p.label}｜${p.width} × ${p.height}｜對戰專用程序生成地圖`:""}
  renderShop(){document.querySelectorAll("[data-shop-mode]").forEach(b=>b.classList.toggle("active",b.dataset.shopMode===this.shopMode));if(this.shopMode==="ITEM"){this.renderItemShop();return}this.renderPackShop();}
  renderPackShop(){const products=globalThis.PackDatabase.products?.({season:"TEST_SEASON"})||globalThis.PackDatabase.list?.()||[];$("shopSubtitle").textContent="卡包測試介面";$("shopResultTitle").textContent="開包結果";$("shopTabs").hidden=false;$("shopTabs").innerHTML=products.map(p=>`<button class="pack-tab ${p.id===this.activeShopPack?"active":""}" data-shop="${p.id}">${p.name}</button>`).join("");document.querySelectorAll("[data-shop]").forEach(b=>b.onclick=()=>{this.activeShopPack=b.dataset.shop;this.renderShop()});const pack=globalThis.PackDatabase.product?.(this.activeShopPack)||products[0];if(!pack){$("shopPackInfo").innerHTML="<p>目前沒有卡包資料。</p>";return}this.activeShopPack=pack.id;$("shopPackInfo").innerHTML=`<h3>${pack.name}</h3><p>${pack.description||""}</p><button id="testOpenPack" class="deploy-button">測試開包</button>`;$("shopResults").classList.add("collection-grid");$("shopResults").innerHTML="";$("testOpenPack").onclick=()=>{const opened=globalThis.PackEngine.open(pack.id);$("shopResults").innerHTML=opened.ok?opened.cards.map(id=>{const card=globalThis.CardDatabase.get(id);return`<button type="button" data-card-preview="${card.id}" class="collection-entry collection-entry--result">${this.collectionFace(card,"pack")}</button>` }).join(""):`<div class="deck-empty">${opened.reason}</div>`;$("shopResults").querySelectorAll("[data-card-preview]").forEach(b=>b.addEventListener("click",()=>this.openCardPreview(b.dataset.cardPreview,{allowAdd:false})))}}
  renderItemShop(){$("shopResults").classList.remove("collection-grid");$("shopSubtitle").textContent=`道具商店｜Gold ${ItemInventoryEngine.gold()} G`;$("shopResultTitle").textContent="道具倉庫";$("shopTabs").hidden=true;$("shopPackInfo").innerHTML=`<h3>道具商店</h3><div class="item-shop-grid">${ItemDatabase.shopList().map(item=>`<button type="button" class="item-shop-card" data-buy-item="${item.id}"><strong>${item.name}</strong><span>${item.shop.buyPrice} G</span><small>${item.description}</small></button>`).join("")}</div>`;$("shopResults").innerHTML=ItemDatabase.list().map(item=>`<div class="shop-stash-row"><span>${item.name}</span><strong>×${ItemInventoryEngine.stashCount(item.id)}</strong></div>`).join("");document.querySelectorAll("[data-buy-item]").forEach(b=>b.onclick=()=>{const result=ItemInventoryEngine.buy(b.dataset.buyItem,1);if(!result.ok){alert(result.reason==="NOT_ENOUGH_GOLD"?"Gold 不足。":"購買失敗。");return}this.renderItemShop()})}
}
