(()=>{
"use strict";

const WEATHER_OPTIONS=[
  ["CLEAR","晴朗"],["FOG","迷霧"],["RAIN","雨"],["HEAVY_RAIN","豪大雨"],
  ["THUNDERSTORM","雷雨"],["SNOW","降雪"],["BLIZZARD","暴風雪"]
];
const FORCE_OPTIONS=[
  ["FIRE","火"],["HEAVY_FIRE","高熱"],["EXPLOSION","爆炸"],["WIND","風"],
  ["THUNDER","雷"],["IMPACT","衝擊"],["AVALANCHE_TRIGGER","雪崩觸發"]
];

function runtime(){return window.CardTacticsRuntime?.debug||null}
function cards(){return Object.values(window.CARDS||{}).filter(Boolean).sort((a,b)=>String(a.name).localeCompare(String(b.name),"zh-Hant"))}
function option(value,label){return`<option value="${value}">${label}</option>`}

function ensureStyles(){
  if(document.getElementById("battleTestConsoleStyles"))return;
  const style=document.createElement("style");
  style.id="battleTestConsoleStyles";
  style.textContent=`
    .battle-test-console{display:none;position:absolute;z-index:135;right:80px;bottom:96px;width:min(430px,calc(100vw - 92px));max-height:72vh;overflow:auto;border:1px solid #8a7147;border-radius:11px;background:#081018f7;box-shadow:0 16px 48px #000c;font-size:11px}
    .battle-test-console.open{display:block}
    .battle-test-console>header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #3c4654;background:#081018fc}
    .battle-test-console>header button{width:30px;height:30px;padding:0}
    .battle-test-body{padding:8px;display:grid;gap:8px}
    .battle-test-section{border:1px solid #2f3b49;border-radius:8px;padding:8px;background:#0b141e}
    .battle-test-section h4{margin:0 0 6px;color:#f0d494;font-size:11px}
    .battle-test-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}
    .battle-test-row.triple{grid-template-columns:1fr 1fr 1fr}
    .battle-test-console select,.battle-test-console input,.battle-test-console button{min-width:0;width:100%;padding:7px;font-size:10px}
    .battle-test-status{padding:6px 8px;border-radius:6px;background:#071018;color:#b9c6d4;min-height:28px}
    .battle-test-status.ok{color:#9ff2af}.battle-test-status.bad{color:#ff9b9b}
    @media(max-width:700px){.battle-test-console{right:68px;bottom:92px;width:calc(100vw - 78px);max-height:66vh}.battle-test-row,.battle-test-row.triple{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function mount(){
  const battle=document.getElementById("battleScreen"),rail=document.querySelector(".battle-right-rail");
  if(!battle||!rail||document.getElementById("battleTestConsole"))return;
  ensureStyles();

  const toggle=document.createElement("button");
  toggle.id="battleTestToggle";
  toggle.type="button";
  toggle.textContent="TEST";
  toggle.title="Battle Test Console";
  rail.insertBefore(toggle,rail.querySelector("#endTurn")||null);

  const panel=document.createElement("aside");
  panel.id="battleTestConsole";
  panel.className="battle-test-console";
  panel.innerHTML=`
    <header><strong>Battle Test Console</strong><button id="battleTestClose" type="button">×</button></header>
    <div class="battle-test-body">
      <section class="battle-test-section">
        <h4>天氣／環境</h4>
        <div class="battle-test-row">
          <select id="testWeather">${WEATHER_OPTIONS.map(([v,n])=>option(v,n)).join("")}</select>
          <input id="testWeatherTurns" type="number" min="0" max="99" value="5" inputmode="numeric" aria-label="天氣回合">
        </div>
        <button id="testApplyWeather" type="button">立即切換天氣</button>
        <div class="battle-test-row triple">
          <input id="testEnvX" type="number" min="0" value="0" inputmode="numeric" placeholder="X">
          <input id="testEnvY" type="number" min="0" value="0" inputmode="numeric" placeholder="Y">
          <select id="testEnvForce">${FORCE_OPTIONS.map(([v,n])=>option(v,n)).join("")}</select>
        </div>
        <div class="battle-test-row">
          <button id="testApplyForce" type="button">套用環境力</button>
          <button id="testClearTileEffects" type="button">清除格子效果</button>
        </div>
      </section>

      <section class="battle-test-section">
        <h4>卡牌／生成單位</h4>
        <select id="testCard"></select>
        <div class="battle-test-row">
          <button id="testGivePlayerCard" type="button">加入我方手牌</button>
          <button id="testGiveEnemyCard" type="button">加入敵方手牌</button>
        </div>
        <div class="battle-test-row triple">
          <select id="testSpawnOwner">
            <option value="PLAYER">我方</option>
            <option value="ENEMY" selected>敵方</option>
            <option value="NEUTRAL">中立</option>
          </select>
          <input id="testSpawnX" type="number" min="0" value="0" inputmode="numeric" placeholder="X">
          <input id="testSpawnY" type="number" min="0" value="0" inputmode="numeric" placeholder="Y">
        </div>
        <button id="testSpawnUnit" type="button">以角色卡直接生成</button>
      </section>

      <section class="battle-test-section">
        <h4>單位站位</h4>
        <select id="testUnit"></select>
        <div class="battle-test-row">
          <input id="testMoveX" type="number" min="0" value="0" inputmode="numeric" placeholder="X">
          <input id="testMoveY" type="number" min="0" value="0" inputmode="numeric" placeholder="Y">
        </div>
        <button id="testMoveUnit" type="button">立即改變站位</button>
      </section>

      <div id="battleTestStatus" class="battle-test-status">待命。</div>
    </div>`;
  battle.appendChild(panel);

  const $=id=>panel.querySelector(`#${id}`);
  const status=(message,ok=true)=>{
    const el=$("battleTestStatus");el.textContent=message;el.classList.toggle("ok",ok);el.classList.toggle("bad",!ok);
  };

  const cardSelect=$("testCard");
  for(const card of cards()){
    const kind=card.type==="CHARACTER"?"角色":"法術";
    cardSelect.insertAdjacentHTML("beforeend",option(card.id,`[${kind}] ${card.name}｜${card.id}`));
  }

  function refreshUnits(){
    const debug=runtime(),data=debug?.state?.(),select=$("testUnit"),previous=select.value;
    select.innerHTML="";
    for(const unit of data?.units||[]){
      const team=unit.team==="P"?"我":unit.team==="E"?"敵":"中";
      select.insertAdjacentHTML("beforeend",option(unit.id,`[${team}] ${unit.name} (${unit.x},${unit.y})${unit.stealthed?"｜潛行":""}`));
    }
    if([...select.options].some(o=>o.value===previous))select.value=previous;
    syncMoveCoords();
  }

  function selectedUnit(){
    return runtime()?.state?.()?.units?.find(unit=>unit.id===$("testUnit").value)||null;
  }
  function syncMoveCoords(){
    const unit=selectedUnit();if(!unit)return;
    $("testMoveX").value=unit.x;$("testMoveY").value=unit.y;
  }

  toggle.onclick=()=>{panel.classList.toggle("open");if(panel.classList.contains("open"))refreshUnits();};
  $("battleTestClose").onclick=()=>panel.classList.remove("open");
  $("testUnit").onchange=syncMoveCoords;

  $("testApplyWeather").onclick=()=>{
    const ok=runtime()?.setWeather?.($("testWeather").value,Number($("testWeatherTurns").value));
    status(ok?`天氣已切換：${$("testWeather").selectedOptions[0]?.textContent}`:"天氣切換失敗。",!!ok);
  };
  $("testApplyForce").onclick=()=>{
    const ok=runtime()?.applyEnvironmentForce?.(Number($("testEnvX").value),Number($("testEnvY").value),$("testEnvForce").value);
    status(ok?"環境力已套用。":"環境力套用失敗，請檢查座標。",!!ok);
  };
  $("testClearTileEffects").onclick=()=>{
    const ok=runtime()?.clearTileEffects?.(Number($("testEnvX").value),Number($("testEnvY").value));
    status(ok?"格子暫時效果已清除。":"清除失敗，請檢查座標。",!!ok);
  };
  $("testGivePlayerCard").onclick=()=>{
    const card=window.CARDS?.[cardSelect.value],ok=runtime()?.giveCard?.(cardSelect.value,"PLAYER");
    status(ok?`我方手牌加入：${card?.name||cardSelect.value}`:"加入我方手牌失敗。",!!ok);
  };
  $("testGiveEnemyCard").onclick=()=>{
    const card=window.CARDS?.[cardSelect.value],ok=runtime()?.giveCard?.(cardSelect.value,"ENEMY");
    status(ok?`敵方手牌加入：${card?.name||cardSelect.value}`:"加入敵方手牌失敗。",!!ok);
  };
  $("testSpawnUnit").onclick=()=>{
    const card=window.CARDS?.[cardSelect.value],ok=runtime()?.spawnCharacterCard?.(
      cardSelect.value,$("testSpawnOwner").value,Number($("testSpawnX").value),Number($("testSpawnY").value)
    );
    status(ok?`已生成：${card?.name||cardSelect.value}`:"生成失敗：必須選角色卡、合法空格。",!!ok);
    if(ok)refreshUnits();
  };
  $("testMoveUnit").onclick=()=>{
    const unit=selectedUnit(),ok=runtime()?.moveUnit?.($("testUnit").value,Number($("testMoveX").value),Number($("testMoveY").value));
    status(ok?`${unit?.name||"單位"} 站位已更新。`:"移動失敗：請檢查單位、座標或該格是否被占用。",!!ok);
    if(ok)refreshUnits();
  };

  window.addEventListener("cardtactics:state",()=>{if(panel.classList.contains("open"))refreshUnits();});
  window.addEventListener("cardtactics:battle-render",()=>{if(panel.classList.contains("open"))refreshUnits();});
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);
else mount();
})();
