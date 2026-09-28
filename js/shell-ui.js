const $=id=>document.getElementById(id);
export class ShellUI{
  constructor(runtime,renderer){
    this.runtime=runtime;this.renderer=renderer;this.screens=[...document.querySelectorAll(".game-screen")];
    this.deck=[...globalThis.DeckEngine.getActive()];this.activeGroup=globalThis.PackDatabase.list()[0]?.id||null;
    this.deckReturn="menuScreen";this.deckCanDeploy=false;this.activeShopPack=globalThis.PackDatabase.products?.({season:"TEST_SEASON"})?.[0]?.id||null;
  }
  show(id){
    this.screens.forEach(s=>s.classList.toggle("active",s.id===id));
    if(id==="battleScreen")requestAnimationFrame(()=>{this.renderer.resize();this.renderer.resetView();window.dispatchEvent(new CustomEvent("cardtactics:battle-screen-enter"))});
  }
  bind(){
    $("pressStart").onclick=()=>this.show("menuScreen");
    $("menuCampaign").onclick=()=>this.show("campaignScreen");
    $("menuVersus").onclick=()=>{this.updateVersusMeta();this.show("versusScreen")};
    $("menuCards").onclick=()=>this.openDeck({from:"menuScreen",deploy:false});
    $("menuShop").onclick=()=>{this.renderShop();this.show("shopScreen")};
    $("menuSave").onclick=()=>this.show("saveScreen");$("menuSettings").onclick=()=>this.show("settingsScreen");
    document.querySelectorAll("[data-back]").forEach(b=>b.onclick=()=>this.show(b.dataset.back));
    $("campaignPrototype").onclick=()=>this.openDeck({from:"campaignScreen",deploy:true});
    $("versusAi").onclick=()=>this.openDeck({from:"versusScreen",deploy:true});
    $("versusMapSize").onchange=()=>this.updateVersusMeta();
    $("deckBack").onclick=()=>this.show(this.deckReturn);
    $("autoDeck").onclick=()=>this.replaceDeck(globalThis.DeckEngine.autoBuild(this.activeGroup,{size:15}));
    $("applyDeck").onclick=()=>{globalThis.DeckEngine.setActive(this.deck);this.renderDeck()};
    $("saveDeck").onclick=()=>{const n=prompt("牌組名稱",globalThis.PackDatabase.get(this.activeGroup)?.name||"我的牌組");if(n)globalThis.DeckEngine.save(n,this.deck)};
    $("loadDeck").onclick=()=>{const names=Object.keys(globalThis.DeckEngine.saved());if(!names.length){alert("目前沒有已儲存牌組。");return}const n=prompt(`輸入牌組名稱：\n${names.join("\n")}`,names[0]);if(n)this.replaceDeck(globalThis.DeckEngine.load(n))};
    $("deployDeck").onclick=()=>this.deploy();
    $("battleBack").onclick=()=>this.show("menuScreen");
    this.updateVersusMeta();this.show("titleScreen");
  }
  cardLabel(c){const type=c.type==="CHARACTER"?(c.unitType==="HERO"?"HERO":"UNIT"):(c.spellType||"SPELL");return`<strong>${c.name}</strong><span>${type}　💎 ${c.cost}</span>`}
  openDeck({from,deploy}){this.deckReturn=from;this.deckCanDeploy=deploy;$("deckScreenTitle").textContent=deploy?"出擊牌組設定":"卡牌整理";this.renderTabs();this.renderGroup();this.renderDeck();this.show("deckScreen")}
  renderTabs(){const packs=globalThis.PackDatabase.list();if(!this.activeGroup)this.activeGroup=packs[0]?.id;$("packTabs").innerHTML=packs.map(p=>`<button class="pack-tab ${p.id===this.activeGroup?"active":""}" data-group="${p.id}">${p.name}</button>`).join("");document.querySelectorAll("[data-group]").forEach(b=>b.onclick=()=>{this.activeGroup=b.dataset.group;this.renderTabs();this.renderGroup()})}
  renderGroup(){const cards=globalThis.PackDatabase.cards(this.activeGroup);$("packCards").innerHTML=cards.map(c=>{const count=this.deck.filter(id=>id===c.id).length,chosen=count>0;return`<button class="collection-card ${chosen?"chosen":""}" data-card="${c.id}">${this.cardLabel(c)}<em>${c.unitType==="HERO"?(chosen?"HERO 已加入":"加入牌組"):(chosen?`牌組 ×${count}｜再加入`:"加入牌組")}</em></button>`}).join("");document.querySelectorAll("[data-card]").forEach(b=>b.onclick=()=>{const c=globalThis.CardDatabase.get(b.dataset.card);if(c?.unitType==="HERO"&&this.deck.includes(c.id))return;this.deck.push(c.id);this.renderDeck();this.renderGroup()})}
  renderDeck(){$("deckCount").textContent=`目前牌組 ${this.deck.length} 張`;$("deckList").innerHTML=this.deck.length?this.deck.map((id,i)=>`<button class="deck-row" data-remove="${i}">${globalThis.CardDatabase.get(id)?.name||id}<span>移除</span></button>`).join(""):`<div class="deck-empty">尚未加入卡牌</div>`;document.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{this.deck.splice(Number(b.dataset.remove),1);this.renderDeck();this.renderGroup()});$("deployDeck").hidden=!this.deckCanDeploy;$("deployDeck").disabled=this.deck.length===0}
  replaceDeck(ids){this.deck.splice(0,this.deck.length,...globalThis.DeckEngine.normalize(ids));this.renderDeck();this.renderGroup()}
  deploy(){
    globalThis.DeckEngine.setActive(this.deck);
    const versus=this.deckReturn==="versusScreen";
    globalThis.CardTacticsBattleSetup={stageId:versus?"versus_core_battle":"prototype_battle",deck:[...this.deck],...(versus?{mapSize:$("versusMapSize").value||"MEDIUM",seed:globalThis.MapGenerator.randomSeed()}: {})};
    this.runtime.resetBattle();this.show("battleScreen");
  }
  updateVersusMeta(){const p=globalThis.MapGenerator?.preset?.($("versusMapSize").value);$("versusMapMeta").textContent=p?`${p.label}｜${p.width} × ${p.height}｜對戰專用程序生成地圖`:""}
  renderShop(){
    const products=globalThis.PackDatabase.products?.({season:"TEST_SEASON"})||globalThis.PackDatabase.list?.()||[];
    $("shopTabs").innerHTML=products.map(p=>`<button class="pack-tab ${p.id===this.activeShopPack?"active":""}" data-shop="${p.id}">${p.name}</button>`).join("");
    document.querySelectorAll("[data-shop]").forEach(b=>b.onclick=()=>{this.activeShopPack=b.dataset.shop;this.renderShop()});
    const pack=globalThis.PackDatabase.product?.(this.activeShopPack)||products[0];if(!pack){$("shopPackInfo").innerHTML="<p>目前沒有卡包資料。</p>";return}
    this.activeShopPack=pack.id;$("shopPackInfo").innerHTML=`<h3>${pack.name}</h3><p>${pack.description||""}</p><button id="testOpenPack" class="deploy-button">測試開包</button>`;
    $("testOpenPack").onclick=()=>{const opened=globalThis.PackEngine.open(pack.id);$("shopResults").innerHTML=opened.ok?opened.cards.map(id=>`<div class="collection-card">${this.cardLabel(globalThis.CardDatabase.get(id))}</div>`).join(""):`<div class="deck-empty">${opened.reason}</div>`}
  }
}
