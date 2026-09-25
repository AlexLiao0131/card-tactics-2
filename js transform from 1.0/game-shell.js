(()=>{
  const $=id=>document.getElementById(id);
  const screens=[...document.querySelectorAll(".game-screen")];
  const deck=[...DeckEngine.getActive()];
  let activeGroup="LIVIA_SUPPLEMENT",deckReturn="menuScreen",deckCanDeploy=false,activeShopPack="IMPERIAL_SEASON_TEST";
  function show(id){screens.forEach(s=>s.classList.toggle("active",s.id===id));}
  function cardLabel(card){
    const type=card.type==="CHARACTER"?(card.unitType==="HERO"?"HERO":"UNIT"):(card.spellType||"SPELL");
    return `<strong>${card.name}</strong><span>${type}　💎 ${card.cost}</span>`;
  }
  function renderDeck(){
    $("deckCount").textContent=`目前牌組 ${deck.length} 張`;
    $("deckList").innerHTML=deck.length?deck.map((id,i)=>{
      const c=CardDatabase.get(id);return `<button class="deck-row" data-remove="${i}">${c?.name||id}<span>移除</span></button>`;
    }).join(""):`<div class="deck-empty">尚未加入卡牌</div>`;
    document.querySelectorAll("[data-remove]").forEach(btn=>btn.onclick=()=>{deck.splice(Number(btn.dataset.remove),1);renderDeck();renderGroup();});
    $("deployDeck").hidden=!deckCanDeploy;
    $("deployDeck").disabled=deck.length===0;
  }
  function renderGroupTabs(){
    $("packTabs").innerHTML=PackDatabase.list().map(p=>`<button class="pack-tab ${p.id===activeGroup?"active":""}" data-group="${p.id}">${p.name}</button>`).join("");
    document.querySelectorAll("[data-group]").forEach(btn=>btn.onclick=()=>{activeGroup=btn.dataset.group;renderGroupTabs();renderGroup();});
  }
  function renderGroup(){
    const cards=PackDatabase.cards(activeGroup);
    $("packCards").innerHTML=cards.map(card=>{
      const count=deck.filter(id=>id===card.id).length;
      const hero=card.unitType==="HERO";
      const chosen=count>0;
      return `<button class="collection-card ${chosen?"chosen":""}" data-card="${card.id}">${cardLabel(card)}<em>${hero?(chosen?"HERO 已加入":"加入牌組"):(chosen?`牌組 ×${count}｜再加入`:"加入牌組")}</em></button>`;
    }).join("");
    document.querySelectorAll("[data-card]").forEach(btn=>btn.onclick=()=>{
      const id=btn.dataset.card,card=CardDatabase.get(id);
      if(card?.unitType==="HERO"&&deck.includes(id))return;
      deck.push(id);renderDeck();renderGroup();
    });
  }
  function openDeckBuilder({from="menuScreen",deploy=false}={}){
    deckReturn=from;deckCanDeploy=deploy;
    $("deckScreenTitle").textContent=deploy?"出擊牌組設定":"卡牌整理";
    renderGroupTabs();renderGroup();renderDeck();show("deckScreen");
  }
  function replaceDeck(ids){deck.splice(0,deck.length,...DeckEngine.normalize(ids));renderDeck();renderGroup();}
  function autoDeck(){replaceDeck(DeckEngine.autoBuild(activeGroup,{size:15}));}
  function applyDeck(){DeckEngine.setActive(deck);$("deckCount").textContent=`目前牌組 ${deck.length} 張｜已套用`;setTimeout(renderDeck,900);}
  function saveDeck(){const name=prompt("牌組名稱",PackDatabase.get(activeGroup)?.name||"我的牌組");if(name)DeckEngine.save(name,deck);}
  function loadDeck(){const names=Object.keys(DeckEngine.saved());if(!names.length){alert("目前沒有已儲存牌組。");return;}const name=prompt(`輸入要載入的牌組名稱：\n${names.join("\n")}`,names[0]);if(name)replaceDeck(DeckEngine.load(name));}
  function renderShop(){
    const products=PackDatabase.products({season:"TEST_SEASON"});
    $("shopTabs").innerHTML=products.map(p=>`<button class="pack-tab ${p.id===activeShopPack?"active":""}" data-shop-pack="${p.id}">${p.name}</button>`).join("");
    document.querySelectorAll("[data-shop-pack]").forEach(btn=>btn.onclick=()=>{activeShopPack=btn.dataset.shopPack;renderShop();});
    const pack=PackDatabase.product(activeShopPack)||products[0];
    if(!pack)return;
    activeShopPack=pack.id;
    $("shopPackInfo").innerHTML=`<h3>${pack.name}</h3><p>${pack.description||""}</p><p class="shop-season">${pack.season==="PERMANENT"?"常駐補充包":`季度：${pack.season}`}</p><button id="testOpenPack" class="deploy-button">${pack.kind==="SUPPLEMENT"?"查看固定內容":"測試開包"}</button>`;
    $("testOpenPack").onclick=()=>openShopPack(pack.id);
  }
  function openShopPack(id){
    const opened=PackEngine.open(id);
    if(!opened.ok){$("shopResults").innerHTML=`<div class="deck-empty">開包失敗：${opened.reason}</div>`;return;}
    const counts=new Map();
    opened.cards.forEach(id=>counts.set(id,(counts.get(id)||0)+1));
    $("shopResults").innerHTML=[...counts.entries()].map(([id,count])=>{
      const card=CardDatabase.get(id); if(!card)return "";
      return `<div class="shop-result-card ${card.unitType==="HERO"?"hero":""}">${cardLabel(card)}<em>×${count}</em></div>`;
    }).join("");
  }
  function updateVersusMapMeta(){
    const select=$("versusMapSize"),meta=$("versusMapMeta");if(!select||!meta||!window.MapGenerator)return;
    const p=MapGenerator.preset(select.value);meta.textContent=`${p.label}｜${p.width} × ${p.height}｜高低差、湖泊、森林與據點會依 Seed 程序生成`;
  }

  $("pressStart").onclick=()=>{AudioManager.playBgm("assets/audio/title-theme.mp3");show("menuScreen");};
  $("autoDeck").onclick=autoDeck;
  $("applyDeck").onclick=applyDeck;
  $("saveDeck").onclick=saveDeck;
  $("loadDeck").onclick=loadDeck;
  $("menuCampaign").onclick=()=>show("campaignScreen");
  $("campaignPrototype").onclick=()=>openDeckBuilder({from:"campaignScreen",deploy:true});
  $("menuVersus").onclick=()=>{updateVersusMapMeta();show("versusScreen");};
  $("versusAi").onclick=()=>openDeckBuilder({from:"versusScreen",deploy:true});
  $("versusMapSize")?.addEventListener("change",updateVersusMapMeta);
  $("menuCards").onclick=()=>openDeckBuilder({from:"menuScreen",deploy:false});
  $("menuShop").onclick=()=>{renderShop();show("shopScreen");};
  $("menuSave").onclick=()=>show("saveScreen");
  $("menuSettings").onclick=()=>show("settingsScreen");
  document.querySelectorAll("[data-back]").forEach(btn=>btn.onclick=()=>show(btn.dataset.back));
  $("deckBack").onclick=()=>show(deckReturn);
  $("deployDeck").onclick=()=>{
    DeckEngine.setActive(deck);
    const versus=deckReturn==="versusScreen";
    window.CardTacticsBattleSetup={
      stageId:versus?"versus_core_battle":"prototype_battle",
      deck:[...deck],
      ...(versus?{mapSize:$("versusMapSize")?.value||"MEDIUM",seed:window.MapGenerator?.randomSeed?.()}: {})
    };
    window.CardTacticsRuntime?.resetBattle?.();show("battleScreen");
  };
  $("battleBack").onclick=()=>show("menuScreen");
  $("bgmToggle").onchange=e=>AudioManager.setBgmEnabled(e.target.checked);
  $("bgmVolume").oninput=e=>AudioManager.setBgmVolume(e.target.value/100);
  $("seToggle").onchange=e=>AudioManager.setSeEnabled(e.target.checked);
  $("seVolume").oninput=e=>AudioManager.setSeVolume(e.target.value/100);
  updateVersusMapMeta();
  show("titleScreen");
})();
