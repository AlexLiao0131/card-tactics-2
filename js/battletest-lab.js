/**
 * Dedicated Battle Test entry. This file is never imported by index.html.
 * The ONE production CardTacticsRuntime is used for combat, climate, AI,
 * unit creation and Babylon presentation; this module only controls its
 * existing debug API and registers a deterministic test stage/map fixture.
 */
import {
  LAB_STAGE_ID,LAB_WIDTH,LAB_HEIGHT,LAB_REGIONS,regionAt,registerBattleTestArena
} from './battletest-arena.js';

const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const labelTeam=team=>team==='P'?'我方':team==='E'?'敵方':'中立';
const sleepReady=async()=>{
  // Main uses top-level await. Do not race ShellUI.bind()/renderer event wiring.
  for(let n=0;n<1200;n++){
    if(globalThis.MAPS&&globalThis.STAGES&&globalThis.CARDS&&
       globalThis.CardTacticsRuntime?.debug?.spawnCharacterCard&&
       globalThis.CardTacticsPresentation&&
       $('titleScreen')?.classList.contains('active'))return;
    if($('bootStatus')?.textContent?.includes('啟動失敗'))throw Error($('bootStatus').textContent);
    await sleep(50);
  }
  throw Error('正式遊戲啟動逾時；請檢查 Babylon.js 或其他核心程式是否成功載入。');
};
const uniqueLabel=(unit)=>`${labelTeam(unit.team)}｜${unit.name}｜${unit.id} (${unit.x},${unit.y})`;

function buildPanel(){
  const panel=document.createElement('aside');
  panel.id='battleTestLab';panel.className='bt-lab';panel.setAttribute('aria-label','獨立戰鬥測試控制台');
  panel.innerHTML=`<header><strong>BATTLE TEST｜自由召喚</strong><button id="labHide" type="button" title="收起控制台">收起</button><button id="labExit" type="button">離開</button></header>
    <div class="bt-lab-body">
      <section><h4>固定矩形地形｜20 × 14</h4><div class="bt-lab-grid" id="labGrid" role="grid" aria-label="測試地形座標選擇"></div>
        <p id="labCellInfo" class="bt-lab-legend">選格設定召喚／移動座標。</p>
        <p class="bt-lab-hint">平地／森林／高地／岩壁／泥地／淺水／深水／斷崖／砂地各為規則矩形。這是真正的戰場地形，不是顯示用圖片。</p>
      </section>
      <section><h4>直接召喚角色</h4><label for="labCharacter">角色卡（可重複召喚同角色）</label><input id="labSearch" type="search" placeholder="搜尋角色名稱／ID"><select id="labCharacter" aria-label="角色"></select>
        <div class="bt-lab-row three"><label>陣營<select id="labOwner"><option value="PLAYER">我方</option><option value="ENEMY">敵方</option><option value="NEUTRAL">中立</option></select></label>
          <label>X<input id="labSpawnX" type="number" min="0" max="19" step="1" value="2"></label>
          <label>Y<input id="labSpawnY" type="number" min="0" max="13" step="1" value="2"></label></div>
        <button id="labSpawn" type="button" style="width:100%">在指定座標生成角色</button></section>
      <section><h4>已生成角色／重設站位</h4><select id="labUnits" aria-label="現有角色"></select>
        <div class="bt-lab-row three"><label>X<input id="labMoveX" type="number" min="0" max="19" step="1" value="0"></label>
          <label>Y<input id="labMoveY" type="number" min="0" max="13" step="1" value="0"></label>
          <button id="labMove" type="button" style="align-self:end">移到座標</button></div></section>
      <section><h4>氣候與環境回合</h4><div class="bt-lab-row"><select id="labWeather" aria-label="氣候">
          <option value="CLEAR">晴朗</option><option value="FOG">迷霧</option><option value="RAIN">下雨</option><option value="HEAVY_RAIN">豪雨</option><option value="THUNDERSTORM">雷雨</option><option value="TYPHOON">颱風</option><option value="SNOW">降雪</option><option value="BLIZZARD">暴風雪</option><option value="SCORCHING_SUN">烈日</option>
        </select><button id="labSetWeather" type="button">切換天氣</button></div>
        <div class="bt-lab-row"><select id="labDayNight" aria-label="日夜"><option value="DAY">白天</option><option value="NIGHT">夜晚</option></select><button id="labSetTime" type="button">切換日夜</button></div>
        <div class="bt-lab-row"><select id="labMoon" aria-label="月光"><option value="FULL">滿月</option><option value="PARTIAL">半月</option><option value="NONE">無月</option></select><button id="labSetMoon" type="button">切換月光</button></div>
        <div class="bt-lab-row"><select id="labWind" aria-label="風向"><option value="CALM">無風</option><option value="N">向北</option><option value="E">向東</option><option value="S">向南</option><option value="W">向西</option><option value="NE">向東北</option><option value="SE">向東南</option><option value="SW">向西南</option><option value="NW">向西北</option></select><button id="labSetWind" type="button">風向／風力</button></div>
        <label>風力（0–8）<input id="labWindStrength" type="number" min="0" max="8" step="0.5" value="2"></label>
        <div class="bt-lab-row"><button id="labAdvance" type="button">環境推進 1 回合</button><button id="labReset" type="button">清空／重設戰場</button></div>
        <p class="bt-lab-hint">降雨、積雪、水流等由原環境引擎運算。按環境推進可觀察變化；角色技能與一般攻擊使用原始戰鬥選單。</p>
      </section><p id="labStatus" class="bt-lab-status" role="status" aria-live="polite">啟動測試場...</p>
    </div>`;
  const toggle=document.createElement('button');toggle.className='bt-lab-toggle';toggle.id='labRestore';toggle.type='button';toggle.hidden=true;toggle.textContent='開啟 TEST 控制台';
  document.body.append(panel,toggle);
  return {panel,toggle};
}

async function start(){
  await sleepReady();
  document.body.classList.add('battletest-page');
  registerBattleTestArena(globalThis.MAPS,globalThis.STAGES);
  // No second game engine. This selects a stage for the existing resetBattle().
  globalThis.CardTacticsBattleSetup={stageId:LAB_STAGE_ID};
  const game=globalThis.CardTacticsRuntime;
  game.resetBattle();
  for(const screen of document.querySelectorAll('.game-screen'))
    screen.classList.toggle('active',screen.id==='battleScreen');
  await new Promise(resolve=>requestAnimationFrame(resolve));
  window.dispatchEvent(new CustomEvent('cardtactics:battle-screen-enter'));
  $('battleBack').onclick=()=>window.location.assign('./index.html');
  const {panel,toggle}=buildPanel();
  const find=id=>panel.querySelector('#'+id);
  const info=(message,bad=false)=>{
    const target=find('labStatus');target.textContent=message;target.classList.toggle('error',bad);
  };
  const valid=(x,y)=>Number.isInteger(x)&&Number.isInteger(y)&&!!regionAt(x,y);
  const coords=(xId,yId)=>[xId,yId].map(id=>{const v=find(id).value;return v===''?NaN:Number(v);});
  const buttons=new Map();
  const chooseCell=(x,y)=>{
    for(const id of ['labSpawnX','labMoveX'])find(id).value=x;
    for(const id of ['labSpawnY','labMoveY'])find(id).value=y;
    for(const [key,b] of buttons)b.classList.toggle('selected',key===`${x},${y}`);
    const region=regionAt(x,y);
    find('labCellInfo').textContent=`選擇 (${x},${y})｜${region?.name||'超出範圍'}｜${region?.terrain||'—'}`;
  };
  for(let y=0;y<LAB_HEIGHT;y++)for(let x=0;x<LAB_WIDTH;x++){
    const r=regionAt(x,y),button=document.createElement('button');
    button.type='button';button.style.background=r.color;
    button.title=`(${x},${y}) ${r.name}`;button.setAttribute('role','gridcell');
    button.setAttribute('aria-label',button.title);
    button.onclick=()=>chooseCell(x,y);find('labGrid').appendChild(button);
    buttons.set(`${x},${y}`,button);
  }
  chooseCell(2,2);
  const allCards=Object.values(globalThis.CARDS).filter(c=>
    globalThis.CardDatabase?.isCharacter?.(c)||c.type==='CHARACTER').sort((a,b)=>
      Number(b.unitType==='HERO')-Number(a.unitType==='HERO')||a.name.localeCompare(b.name,'zh-Hant'));
  const choices=find('labCharacter');
  const refreshCards=()=>{
    const current=choices.value,term=find('labSearch').value.trim().toLocaleLowerCase();
    choices.replaceChildren();
    for(const card of allCards){
      if(term&&!`${card.name} ${card.id} ${card.characterId||''}`.toLocaleLowerCase().includes(term))continue;
      const o=new Option(`${card.unitType==='HERO'?'★ ':''}${card.name}｜${card.characterId||card.id}`,card.id);
      choices.appendChild(o);
    }
    if([...choices.options].some(o=>o.value===current))choices.value=current;
  };
  refreshCards();find('labSearch').oninput=refreshCards;
  const liveUnits=()=>game.debug.state().units||[];
  const refreshUnits=(keep=true)=>{
    const list=find('labUnits'),previous=keep?list.value:null;
    list.replaceChildren();
    for(const unit of liveUnits())list.appendChild(new Option(uniqueLabel(unit),unit.id));
    if(previous&&[...list.options].some(o=>o.value===previous))list.value=previous;
    if(!keep||!previous)syncUnitPosition();
  };
  const syncUnitPosition=()=>{
    const unit=liveUnits().find(u=>u.id===find('labUnits').value);
    if(unit){find('labMoveX').value=unit.x;find('labMoveY').value=unit.y;}
  };
  find('labUnits').onchange=syncUnitPosition;
  find('labSpawn').onclick=()=>{
    const [x,y]=coords('labSpawnX','labSpawnY'),cardId=choices.value;
    if(!valid(x,y))return info(`無效座標：X 0–${LAB_WIDTH-1}、Y 0–${LAB_HEIGHT-1}，且必須為整數。`,true);
    if(regionAt(x,y)?.terrain==='WALL')return info('岩壁屬於不可通行地形，請選擇其他落點。',true);
    if(liveUnits().some(u=>u.x===x&&u.y===y))return info(`(${x},${y}) 已有角色，請換空格。`,true);
    const ok=cardId&&game.debug.spawnCharacterCard(cardId,find('labOwner').value,x,y);
    if(!ok)return info('召喚失敗：檢查角色卡或地形條件。',true);
    refreshUnits();info(`已生成 ${allCards.find(c=>c.id===cardId)?.name||cardId}｜${find('labOwner').selectedOptions[0].text} (${x},${y})`);
  };
  find('labMove').onclick=()=>{
    const [x,y]=coords('labMoveX','labMoveY'),id=find('labUnits').value;
    if(!valid(x,y))return info('移動座標超出 20 × 14 方格範圍。',true);
    if(!id)return info('尚未召喚任何角色。',true);
    if(regionAt(x,y)?.terrain==='WALL')return info('岩壁是不可通行地形，不能指定為站位。',true);
    const ok=game.debug.moveUnit(id,x,y);
    if(!ok)return info('移動失敗：目標已有單位或座標無效。',true);
    chooseCell(x,y);refreshUnits();info(`已將 ${id} 移到 (${x},${y})。`);
  };
  find('labSetWeather').onclick=()=>{
    const name=find('labWeather').value;
    info(game.debug.setWeather(name,8,{applyPulse:true})?`天氣已切換為 ${find('labWeather').selectedOptions[0].text}。`:'天氣切換失敗。',false);
  };
  find('labSetTime').onclick=()=>info(game.debug.setTimeOfDay(find('labDayNight').value)?'日夜已切換。':'日夜切換失敗。');
  find('labSetMoon').onclick=()=>info(game.debug.setMoonlight(find('labMoon').value)?'月光已切換。':'月光切換失敗。');
  find('labSetWind').onclick=()=>{
    const dir=find('labWind').value,n=Number(find('labWindStrength').value);
    if(!Number.isFinite(n)||n<0||n>8)return info('風力必須為 0–8。',true);
    const ok=game.debug.setWind(dir,dir==='CALM'?0:n);
    info(ok?'已透過原環境引擎更新風向／風力。':'風況切換失敗。',!ok);
  };
  find('labAdvance').onclick=()=>{
    const ok=game.debug.advanceEnvironmentTurns(1);
    info(ok?`已透過原 EnvironmentEngine 推進一個環境回合。`:'推進失敗。',!ok);
  };
  find('labReset').onclick=()=>{
    game.resetBattle();refreshUnits(false);info('已清空角色並重建固定方形測試場。');
  };
  find('labExit').onclick=()=>window.location.assign('./index.html');
  find('labHide').onclick=()=>{panel.hidden=true;toggle.hidden=false;};
  toggle.onclick=()=>{panel.hidden=false;toggle.hidden=true;};
  $('resetMap').onclick=()=>{game.resetBattle();refreshUnits(false);info('固定測試場已重置。');};
  window.addEventListener('cardtactics:state',()=>refreshUnits());
  refreshUnits(false);
  info(`測試場載入完成｜${LAB_WIDTH} × ${LAB_HEIGHT}｜角色卡 ${allCards.length} 張。可直接召喚並使用原戰棋選單測試。`);
}

start().catch(error=>{
  const message=`Battle Test 啟動失敗：${error?.message||String(error)}`;
  const boot=$('bootStatus');
  if(boot){boot.textContent=message;boot.style.color='#ff9b9b';}
  const visible=document.createElement('div');visible.setAttribute('role','alert');
  visible.style.cssText='position:fixed;z-index:9999;top:10px;left:10px;right:10px;padding:14px;background:#3d1820;color:#ffd6d6;border:1px solid #e17b89;border-radius:8px';
  visible.textContent=message;document.body.appendChild(visible);
  console.error(message,error);
});
