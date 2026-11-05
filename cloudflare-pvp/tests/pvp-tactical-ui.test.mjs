import test from 'node:test';
import assert from 'node:assert/strict';
import {PvpTacticalUI} from '../../js/pvp-tactical-ui.js';
import {BattleCommandMenuUI} from '../../js/battle-command-menu-ui.js';

function element(tag='div'){
  const classes=new Set();
  return {tagName:tag.toUpperCase(),id:'',type:'',className:'',textContent:'',style:{},dataset:{},
    disabled:false,hidden:false,children:[],attributes:{},
    classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),contains:x=>classes.has(x)},
    setAttribute(k,v){this.attributes[k]=v},
    appendChild(child){this.children.push(child);return child},
    replaceChildren(...children){this.children=[...children]},
    click(){if(!this.disabled)this.onclick?.()}
  };
}
function fixture(seat=0){
  const oldDocument=globalThis.document;
  const controls={endTurn:element('button'),nextUnit:element('button'),turnStatus:element('div')};
  globalThis.document={createElement:element,getElementById:id=>controls[id]||null};
  const root=element('section');root.id='skillBar';
  const commands=[],render=[],inspect=[];
  const ui=new PvpTacticalUI({root,canvas:element('canvas'),seat,
    sendCommand:action=>(commands.push(action),true),isConnected:()=>true,
    onInspect:id=>inspect.push(id),ensureBabylon:async()=>{},
    createBridge:async()=>({accept:packet=>(render.push(packet.revision),true),close:()=>render.push('closed')})});
  ui.setPresented(true);
  return {ui,root,commands,inspect,render,controls,restore:()=>{globalThis.document=oldDocument},
    button(label){const button=root.children.find(child=>child.tagName==='BUTTON'&&child.textContent===label);
      assert.ok(button,`native #skillBar must have ${label}; found ${root.children.map(c=>c.textContent).join(' / ')}`);
      return button;},
    click(label){this.button(label).click()}};
}
const soldier={id:'unit1',team:'P',characterId:'imperial_swordsman',x:2,y:3,
  alive:true,acted:false,moved:false,waited:false,reachableTiles:[{x:3,y:3,cost:1}],attackSkills:[{id:'slash',name:'斬擊'}]};
const game=(seat,phase,revision,units=[soldier])=>({revision,view:{seat,phase,round:2,
  activeSeat:phase==='BATTLEFIELD_READY'?null:seat,
  own:{hand:[{id:'imperial_swordsman_card',name:'帝國劍士',cost:1}],crystals:4},
  opponent:{handCount:5},units,battlefield:{cores:[{owner:'E',x:8,y:7}]}}});
const clickActor=(f,unit=soldier)=>f.ui.tilePicked({seat:f.ui.seat,x:unit.x,y:unit.y});

// The HTML is the same as the original local/Gemini tactical menu; its
// presenter is not a separate PvP-specific button or rules implementation.
test('online battle reuses official #skillBar action-button presenter, not a select-only PvP panel',()=>{
  const f=fixture();try{
    const local=new BattleCommandMenuUI(f.root);f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',2));
    clickActor(f);const original=f.button('攻擊');
    assert.equal(original.className,local.button('測試',()=>{}).className);
    assert.equal(f.root.id,'skillBar');
    assert.ok(f.root.children.some(c=>c.className==='battle-command-close'));
    assert.equal(f.controls.endTurn.hidden,false);
    assert.equal(f.controls.nextUnit.hidden,false);
  }finally{f.restore()}
});
test('native PvP battle entry has NO extra Start Battle button or dummy selection prompt',()=>{
  const f=fixture();try{
    f.ui.receiveMatch(game(0,'BATTLEFIELD_READY',0));
    assert.equal(f.root.children.length,0);
    assert.deepEqual(f.commands,[],'automatic battle transition belongs to the lobby transport');
    f.ui.receiveMatch(game(0,'PLAYER_CARD_PHASE',1));
    assert.equal(f.root.children.length,0);
    assert.equal(f.controls.endTurn.hidden,true);
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',2));
    assert.equal(f.root.children.length,0,'no 點選自己的角色 overlay');
  }finally{f.restore()}
});
test('fan-hand deployment uses official card and does not submit until map tile selected',()=>{
  const f=fixture();try{
    f.ui.receiveMatch(game(0,'PLAYER_CARD_PHASE',2));
    assert.equal(f.ui.chooseCard('imperial_swordsman_card'),'TARGET');
    assert.deepEqual(f.commands,[]);
    assert.equal(f.ui.tilePicked({seat:0,x:1,y:2}),true);
    assert.deepEqual(f.commands,[{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',x:1,y:2}]);
  }finally{f.restore()}
});
test('fan-hand instant card sends one canonical card identifier, no weather calculation',()=>{
  const f=fixture();try{
    const match=game(0,'PLAYER_CARD_PHASE',4);match.view.own.hand.push({id:'fog_card',name:'霧',cost:3});
    f.ui.receiveMatch(match);
    assert.equal(f.ui.chooseCard('fog_card'),'SENT');
    assert.deepEqual(f.commands,[{type:'PLAY_INSTANT_CARD',cardId:'fog_card'}]);
  }finally{f.restore()}
});
test('fan-hand area card targets using same original battlefield tile',()=>{
  const f=fixture();try{
    const match=game(0,'PLAYER_CARD_PHASE',5);match.view.own.hand.push({id:'starfall_card',name:'星隕',cost:10});
    f.ui.receiveMatch(match);assert.equal(f.ui.chooseCard('starfall_card'),'TARGET');
    f.ui.tilePicked({seat:0,x:6,y:7});
    assert.deepEqual(f.commands,[{type:'PLAY_TARGET_CARD',cardId:'starfall_card',x:6,y:7}]);
  }finally{f.restore()}
});
test('native item UI displays original item submenu, and sends only server-certified payload',()=>{
 const f=fixture();try{
  const actor={...soldier,itemChoices:[{payloadId:'item1',itemId:'hp_potion_small',name:'小型生命藥水',usable:true},
    {payloadId:'item2',itemId:'stealth_potion',name:'隱身藥水',usable:false}]};
  f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',66,[actor]));clickActor(f);
  f.click('道具');
  assert.equal(f.button('使用｜隱身藥水').disabled,true);
  f.click('使用｜小型生命藥水');
  assert.deepEqual(f.commands.at(-1),{type:'USE_BATTLE_ITEM',unitId:'unit1',payloadId:'item1'});
  f.click('返回');assert.ok(f.button('攻擊'));
 }finally{f.restore()}
});

test('native capture menu uses only the official certified point from the server',()=>{
 const f=fixture();try{
   f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',64));clickActor(f);
   assert.equal(f.root.children.some(b=>b.textContent?.startsWith('佔領')),false);
   const certified={...soldier,capturePoint:{id:'POINT',name:'中央據點'}};
   f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',65,[certified]));
   f.click('佔領｜中央據點');
   assert.deepEqual(f.commands.at(-1),{type:'CAPTURE_POINT',unitId:soldier.id});
 }finally{f.restore()}
});

test('native UnitControlUI shares online selection, orientation and flight buttons with server authority',()=>{
  const f=fixture();try{
    const actor={...soldier,flightControl:{min:0,max:4,step:1,altitude:2}};
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',61,[actor]));
    assert.equal(f.ui.selectUnit(actor.id),true);
    assert.equal(f.ui.rotateFacing(1),true);
    assert.equal(f.ui.adjustAltitude(-1),true);
    assert.deepEqual(f.commands,[
      {type:'ROTATE_UNIT',unitId:actor.id,steps:1},
      {type:'ADJUST_FLIGHT_ALTITUDE',unitId:actor.id,steps:-1}
    ]);
    assert.equal(f.ui.adjustAltitude(2),false,'no invented step size');
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',62,[{...actor,acted:true}]));
    assert.equal(f.ui.rotateFacing(1),false,'a completed unit cannot be rotated');
  }finally{f.restore()}
});

test('original SkillDatabase long-press registry is shared with PvP buttons',()=>{
  const f=fixture();try{
    const actor={...soldier,attackSkills:[{id:'slash',name:'劍斬'}]};
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',63,[actor]));
    f.ui.selectUnit(actor.id);f.click('攻擊');
    const button=f.button('劍斬');
    assert.equal(BattleCommandMenuUI.skillRegistry.get(button)?.id,'slash');
  }finally{f.restore()}
});

test('native actor command, movement and end turn only propose canonical instructions',()=>{
  const f=fixture();try{
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',6));clickActor(f);
    f.click('狀態');assert.deepEqual(f.inspect,['unit1']);
    assert.equal(f.root.children.some(x=>x.textContent==='移動'),false);
    f.ui.tilePicked({seat:0,x:3,y:3});
    f.ui.endPhase();
    assert.deepEqual(f.commands,[{type:'MOVE_UNIT',unitId:'unit1',x:3,y:3},{type:'END_TACTICAL_PHASE'}]);
    f.click('道具');assert.equal(f.button('沒有可用道具').disabled,true);
  }finally{f.restore()}
});
test('original battlefield command mode allows map movement without a second MOVE panel',()=>{
  const f=fixture();try{
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',7));clickActor(f);
    f.ui.tilePicked({seat:0,x:3,y:3});
    assert.deepEqual(f.commands,[{type:'MOVE_UNIT',unitId:'unit1',x:3,y:3}]);
  }finally{f.restore()}
});
test('offensive skill choice survives display refresh, attacks enemy, or targets original core',()=>{
  const f=fixture();try{
    const actor={...soldier,coreAttackSkillIds:['slash','heavy_slash'],attackSkills:[{id:'slash',name:'斬擊'},{id:'heavy_slash',name:'特殊斬擊'}]};
    const enemy={...soldier,id:'victim',team:'E',x:3,y:3};
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',8,[actor,enemy]));clickActor(f);
    f.click('攻擊');f.click('特殊斬擊');
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',9,[actor,enemy]));
    f.ui.tilePicked({seat:0,x:3,y:3});
    assert.deepEqual(f.commands,[{type:'DECLARE_ATTACK',attackerId:'unit1',targetId:'victim',skillId:'heavy_slash'}]);
    f.click('攻擊');f.click('斬擊');
    f.ui.tilePicked({seat:0,x:8,y:7});
    assert.deepEqual(f.commands.at(-1),{type:'ATTACK_CORE',unitId:'unit1',skillId:'slash',coreOwner:'E'});
  }finally{f.restore()}
});
test('native special skill menu uses official ally heal and map-target magic options',()=>{
  const f=fixture();try{
    const caster={...soldier,effectSkills:[{id:'heal',name:'治療',target:'ALLY'}],mapSkills:[{id:'wave',name:'海嘯'}]};
    const ally={...soldier,id:'ally',x:3,y:3};
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',10,[caster,ally]));clickActor(f);
    f.click('魔法／特殊技能');f.click('治療');f.ui.tilePicked({seat:0,x:3,y:3});
    assert.deepEqual(f.commands.at(-1),{type:'CAST_EFFECT_SKILL',unitId:'unit1',skillId:'heal',targetId:'ally'});
    f.click('魔法／特殊技能');f.click('海嘯');f.ui.tilePicked({seat:0,x:5,y:4});
    assert.deepEqual(f.commands.at(-1),{type:'CAST_MAP_SKILL',unitId:'unit1',skillId:'wave',x:5,y:4});
  }finally{f.restore()}
});
test('enemy-target status spell can be selected only on enemy and sent without forged targeting data',()=>{
 const f=fixture();try{
   const caster={...soldier,effectSkills:[{id:'ophi_forest_entangle',name:'森之束縛',target:'ENEMY'}]};
   const enemy={...soldier,id:'enemy',team:'E',x:3,y:3};
   f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',17,[caster,enemy]));clickActor(f);
   f.click('魔法／特殊技能');f.click('森之束縛');
   assert.equal(f.ui.tilePicked({seat:0,x:2,y:3}),false);
   assert.equal(f.commands.length,0);
   assert.equal(f.ui.tilePicked({seat:0,x:3,y:3}),true);
   assert.deepEqual(f.commands.at(-1),{type:'CAST_EFFECT_SKILL',unitId:'unit1',skillId:'ophi_forest_entangle',targetId:'enemy'});
 }finally{f.restore()}
});
test('native special commands handle enchant, terrain, shadow, burst, area field, perception and transport',()=>{
  const f=fixture();try{
    const caster={...soldier,enchantmentOptions:[{skillId:'enchant',skillName:'火元素',variantId:'FIRE',
      targetId:'unit1',targetName:'自己',weaponSlot:'sword',weaponName:'劍'}],
      enchantedTerrainSkills:[{id:'slash',name:'斬擊'}],
      bloodShadowOptions:[{skillId:'shadow',skillName:'血影瞬襲',targetId:'enemy',targetName:'敵軍'}],
      bloodBurstSkills:[{id:'burst',name:'血爆'}],areaFieldSkills:[{id:'field',name:'聖域'}],
      perceptionSkills:[{id:'perception',name:'認知污染'}],
      transportOptions:[{skillId:'carry',skillName:'空運',targetId:'ally',targetName:'友軍'}]};
    const enemy={...soldier,id:'enemy',team:'E',x:5,y:3};
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',11,[caster,enemy]));clickActor(f);
    f.click('魔法／特殊技能');assert.ok(f.root.children.some(x=>x.textContent==='自己'));f.click('　⚔ 劍｜火元素');
    f.click('魔法／特殊技能');f.click('血影瞬襲 → 敵軍');
    f.click('魔法／特殊技能');f.click('血爆');
    f.click('魔法／特殊技能');f.click('聖域');
    f.click('魔法／特殊技能');f.click('地形｜斬擊');f.ui.tilePicked({seat:0,x:4,y:3});
    f.click('魔法／特殊技能');f.click('認知污染');f.ui.tilePicked({seat:0,x:5,y:3});
    f.click('魔法／特殊技能');f.click('空運 → 友軍');f.ui.tilePicked({seat:0,x:6,y:3});
    assert.deepEqual(f.commands.map(c=>c.type),['CAST_ENCHANTMENT','CAST_BLOOD_SHADOW',
      'CAST_BLOOD_BURST','CAST_AREA_FIELD','ATTACK_ENCHANTED_TERRAIN','CAST_PERCEPTION','CAST_TRANSPORT']);
    assert.deepEqual(f.commands[0],{type:'CAST_ENCHANTMENT',unitId:'unit1',skillId:'enchant',
      variantId:'FIRE',targetId:'unit1',weaponSlot:'sword'});
    assert.deepEqual(f.commands.at(-1),{type:'CAST_TRANSPORT',unitId:'unit1',skillId:'carry',targetId:'ally',x:6,y:3});
  }finally{f.restore()}
});
test('pending enchantment only offers original weapon followup and finish',()=>{
  const f=fixture();try{
    const actor={...soldier,attackSkills:[{id:'black_slash',name:'黑劍',weaponSlot:'sword'},
      {id:'bow_shot',name:'弓',weaponSlot:'bow'}]};
    const match=game(0,'PLAYER_TACTICAL_PHASE',12,[actor]);
    match.view.enchantmentFollowup={unitId:'unit1',weaponSlot:'sword'};
    f.ui.receiveMatch(match);f.ui.selectUnit('unit1');
    assert.ok(f.button('攻擊｜黑劍'));
    assert.ok(!f.root.children.some(x=>x.textContent==='攻擊｜弓'));
    f.click('保留附魔並待機');
    assert.deepEqual(f.commands,[{type:'END_ENCHANT_FOLLOWUP',unitId:'unit1'}]);
  }finally{f.restore()}
});
test('pending blood memory uses same native action menu with optional skip',()=>{
  const f=fixture();try{
    const match=game(0,'PLAYER_TACTICAL_PHASE',13,[soldier]);
    match.view.bloodMemoryChoice={unitId:'unit1',options:[{id:'slash',name:'斬擊'}]};
    f.ui.receiveMatch(match);f.click('斬擊');f.click('略過');
    assert.deepEqual(f.commands,[{type:'CHOOSE_BLOOD_MEMORY',unitId:'unit1',skillId:'slash'},
      {type:'CHOOSE_BLOOD_MEMORY',unitId:'unit1',skillId:null}]);
  }finally{f.restore()}
});
test('enemy reaction uses the exact original enemy-reaction-panel, no separate select/confirm',()=>{
  const f=fixture();try{
    const match=game(0,'PVP_REACTION_PENDING',14,[soldier]);
    match.view.reactionOptions={choices:['ACCEPT','EVADE'],defenses:[{id:'parry',name:'長劍招架'}],
      counters:[{id:'slash',name:'斬擊'}],guardians:[{guardianId:'ally',methods:[{id:'block',name:'格擋'}]}]};
    f.ui.receiveMatch(match);
    assert.equal(f.root.classList.contains('enemy-reaction-panel'),true);
    f.click('防禦｜長劍招架');f.click('反擊｜斬擊');f.click('援護｜ally｜格擋');f.click('迴避');
    assert.deepEqual(f.commands,[{type:'REACT_ATTACK',reaction:'DEFENSE',methodId:'parry'},
      {type:'REACT_ATTACK',reaction:'COUNTER',skillId:'slash'},
      {type:'REACT_ATTACK',reaction:'GUARD',guardianId:'ally',methodId:'block'},
      {type:'REACT_ATTACK',reaction:'EVADE'}]);
  }finally{f.restore()}
});
test('offline screen cannot be overwritten by delayed online match/socket render, cross-seat packet rejected',async()=>{
  const f=fixture();try{
    f.ui.setPresented(false);f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',15));
    assert.equal(f.root.children.length,0);
    f.ui.setPresented(true);assert.equal(f.root.children.length,0,'no dummy PvP selection prompt');
    f.ui.setPresented(false);f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',16));
    assert.equal(f.root.children.length,0);
    assert.equal(f.ui.receiveMatch(game(1,'PLAYER_TACTICAL_PHASE',17)),false);
    assert.equal(await f.ui.receiveRender({seat:1,revision:16}),false);
    f.ui.close();assert.equal(f.root.children.length,0);
  }finally{f.restore()}
});
test('next native unit cycles own actionable army only',()=>{
  const f=fixture();try{
    const ally={...soldier,id:'ally',x:1,y:1},enemy={...soldier,id:'enemy',team:'E',x:5,y:5};
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',18,[soldier,ally,enemy]));
    f.ui.nextUnit();assert.equal(f.ui.selectedUnitId,'unit1');
    f.ui.nextUnit();assert.equal(f.ui.selectedUnitId,'ally');
    f.ui.nextUnit();assert.equal(f.ui.selectedUnitId,'unit1');
  }finally{f.restore()}
});
test('render bridge obeys server revision, synchronizes only after Babylon resources exist',async()=>{
  const f=fixture();try{
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',19));
    assert.equal(await f.ui.receiveRender({seat:0,revision:18}),false);
    assert.equal(await f.ui.receiveRender({seat:0,revision:19}),true);
    assert.deepEqual(f.render,[19]);
    f.ui.close();assert.equal(f.render.at(-1),'closed');
  }finally{f.restore()}
});

test('same original native item menu handles drop, pickup and ally transfer with server-published choices',()=>{
 const f=fixture();try{
  const actor={...soldier,itemInteractionAvailable:true,
   itemChoices:[{payloadId:'owned-potion',itemId:'hp_potion_small',name:'小型生命藥水',usable:true}],
   groundItemChoices:[{groundId:'ground-torch',itemId:'torch',name:'火把'}],
   itemTransferTargets:[{unitId:'friend',name:'友軍'}]};
  f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',80,[actor]));clickActor(f);f.click('道具');
  f.click('放下／轉交');
  f.click('放下｜小型生命藥水');
  f.click('交給 友軍｜小型生命藥水');
  f.click('返回');
  f.click('拾取｜火把');
  assert.deepEqual(f.commands,[
   {type:'DROP_BATTLE_ITEM',unitId:'unit1',payloadId:'owned-potion'},
   {type:'TRANSFER_BATTLE_ITEM',unitId:'unit1',payloadId:'owned-potion',targetUnitId:'friend'},
   {type:'PICKUP_BATTLE_ITEM',unitId:'unit1',groundId:'ground-torch'}
  ]);
  assert.equal(f.root.id,'skillBar');
 }finally{f.restore()}
});

test('the native skill category, name, range and resources are shared by online PVP',()=>{
  const f=fixture();try{
    const actor={...soldier,attackSkills:[
      {id:'slash',name:'制式斬擊',range:{min:1,max:1},resourceLabel:'不消耗',usable:true},
      {id:'magic_bolt',name:'魔力彈',range:{min:2,max:4},resourceLabel:'10 MP',usable:true}
    ]};
    const enemy={...soldier,id:'enemy1',team:'E',x:4,y:3};
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',99,[actor,enemy]));clickActor(f);
    f.click('攻擊');
    assert.ok(f.button('制式斬擊｜射程 1-1｜不消耗'));
    assert.equal(f.root.children.some(x=>x.textContent?.includes('魔力彈')),false,
      'MAGIC must not be silently reclassified as ATTACK');
    f.click('返回');f.click('魔法／特殊技能');
    assert.ok(f.button('魔力彈｜射程 2-4｜10 MP'));
    assert.equal(f.root.children.some(x=>x.textContent?.includes('攻擊 Core')),false,
      'no invented extra Core button');
    f.click('魔力彈｜射程 2-4｜10 MP');
    f.ui.tilePicked({seat:0,x:4,y:3});
    assert.deepEqual(f.commands,[{type:'DECLARE_ATTACK',attackerId:'unit1',targetId:'enemy1',skillId:'magic_bolt'}]);
  }finally{f.restore()}
});

test('a missing server capability cannot fabricate Core attacks or an illegal skill choice',()=>{
  const f=fixture();try{
    const actor={...soldier,attackSkills:[{id:'invalid_future_skill',name:'錯誤技能'},
      {id:'slash',name:'制式斬擊'}]};
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',101,[actor]));clickActor(f);
    f.click('攻擊');assert.ok(f.button('制式斬擊'));
    assert.equal(f.root.children.some(x=>x.textContent==='錯誤技能'),false);
    f.click('制式斬擊');
    assert.equal(f.ui.tilePicked({seat:0,x:8,y:7}),false,
      'server has not certified this actor and skill for core attack');
    assert.deepEqual(f.commands,[]);
    assert.equal(f.root.children.some(x=>x.textContent==='結束戰棋階段'),false,
      'the original end-turn button is the sole command');
  }finally{f.restore()}
});

test('native no-selection PvP menu never fabricates an additional end-turn button',()=>{
  const f=fixture();try{
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',106,[soldier]));
    assert.ok(f.controls.endTurn.hidden===false);
    assert.equal(f.root.children.some(x=>x.textContent==='結束戰棋階段'),false);
    assert.equal(f.ui.endPhase(),true);
    assert.deepEqual(f.commands,[{type:'END_TACTICAL_PHASE'}]);
  }finally{f.restore()}
});

test('native movement highlight comes only from server-certified reachable tiles and restores original highlight overlay',()=>{
  const f=fixture();try{
    const own={...soldier,reachableTiles:[{x:3,y:3,cost:1},{x:4,y:3,cost:2}]};
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',120,[own]));
    const published=[];const highlights=[];const unitHuds=[];
    f.ui.onRendered=s=>published.push(s);
    f.ui.bridge={renderer:{
      highlights:{sync:s=>highlights.push(s)},unitHud:{sync:s=>unitHuds.push(s)},
      syncActionAnchor:()=>{}
    }};
    const serverFrame={revision:120,round:2,map:{id:'map',tiles:[
      {x:2,y:3,reachable:false},{x:3,y:3,reachable:false},{x:4,y:3,reachable:false},
      {x:5,y:3,reachable:false}]},units:[{id:'unit1',selected:false}],cores:[],presentation:{}};
    f.ui.serverSnapshot=serverFrame;
    assert.equal(f.ui.selectUnit('unit1'),true);
    assert.deepEqual(highlights.at(-1).map.tiles.filter(t=>t.reachable).map(t=>[t.x,t.y]),[[3,3],[4,3]]);
    assert.equal(unitHuds.at(-1).units[0].selected,true);
    assert.equal(serverFrame.map.tiles.some(t=>t.reachable),false,'authenticated frame must stay unchanged');
    assert.equal(serverFrame.units[0].selected,false);
    assert.deepEqual(f.commands,[],'selecting a unit is purely local presentation');
    assert.ok(published.length);
    // No legal server tile -> no forged move command.
    assert.equal(f.ui.tilePicked({seat:0,x:5,y:3}),true,'empty non-reachable tile only closes original menu');
    assert.deepEqual(f.commands,[],'no forged move command for non-reachable tile');
    assert.equal(f.root.children.length,0,'no leftover PvP menu column');
    assert.equal(f.ui.tilePicked({seat:0,x:3,y:3}),true);
  }finally{f.restore()}
});
test('server committed move offers original Cancel Move in the SAME command panel',()=>{
  const f=fixture();try{
    const moved={...soldier,x:3,y:3,moved:true,reachableTiles:[]};
    const match=game(0,'PLAYER_TACTICAL_PHASE',121,[moved]);
    match.view.pendingMoveUnitId='unit1';
    f.ui.receiveMatch(match);f.ui.selectUnit('unit1');
    f.click('取消移動');
    assert.deepEqual(f.commands,[{type:'CANCEL_MOVE',unitId:'unit1'}]);
    const committed=game(0,'PLAYER_TACTICAL_PHASE',122,[moved]);
    f.ui.receiveMatch(committed);
    assert.equal(f.root.children.some(x=>x.textContent==='取消移動'),false);
  }finally{f.restore()}
});


test('card targeting uses only the native CardHandUI strip, never a second floating PvP skill column',()=>{
  const f=fixture();try{
    const match=game(0,'PLAYER_CARD_PHASE',140);
    match.view.own.hand.push({id:'starfall_card',name:'星隕',cost:10});
    f.ui.receiveMatch(match);
    assert.equal(f.ui.chooseCard('starfall_card'),'TARGET');
    assert.equal(f.root.children.length,0,'only CardHandUI owns card-target cancellation');
    assert.equal(f.ui.tilePicked({seat:0,x:7,y:7}),true);
    assert.deepEqual(f.commands,[{type:'PLAY_TARGET_CARD',cardId:'starfall_card',x:7,y:7}]);
  }finally{f.restore()}
});

test('no dead online tactical control bar while it is the opponent turn',()=>{
  const f=fixture();try{
    const m=game(0,'ENEMY_TACTICAL_PHASE',142);m.view.activeSeat=1;
    f.ui.receiveMatch(m);
    assert.equal(f.controls.endTurn.hidden,true);
    assert.equal(f.controls.nextUnit.hidden,true);
    assert.equal(f.root.children.length,0);
    const mine=game(0,'PLAYER_TACTICAL_PHASE',143);
    f.ui.receiveMatch(mine);
    assert.equal(f.controls.endTurn.hidden,false);
    assert.equal(f.controls.nextUnit.hidden,false);
  }finally{f.restore()}
});

test('native PvP aim shows only original cancel-cast button, no fabricated instructional prompt',()=>{
  const f=fixture();try{
    const caster={...soldier,attackSkills:[{id:'slash',name:'劍斬'}]};
    f.ui.receiveMatch(game(0,'PLAYER_TACTICAL_PHASE',144,[caster]));
    f.ui.selectUnit(caster.id);f.click('攻擊');f.click('劍斬');
    assert.equal(f.root.children.length,1);
    f.click('取消施放');
    assert.equal(f.root.children.some(x=>x.textContent==='請點選地圖上的合法目標'),false);
    assert.ok(f.root.children.some(x=>x.textContent==='攻擊'));
  }finally{f.restore()}
});
