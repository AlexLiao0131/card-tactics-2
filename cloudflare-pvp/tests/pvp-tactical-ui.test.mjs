import test from 'node:test';
import assert from 'node:assert/strict';
import {PvpTacticalUI} from '../../js/pvp-tactical-ui.js';
globalThis.document={createElement:tag=>{if(tag!=='option')throw Error('MOCK_UNKNOWN_ELEMENT');return {value:'',textContent:''};}};

class Select {
  options=[];value='';
  replaceChildren(){this.options=[];this.value='';}
  append(v){this.options.push(v);if(this.options.length===1)this.value=v.value;}
}
function build(seat=0){
  const controls=Object.fromEntries(['BEGIN','DEPLOY','INSTANT','TARGET_CARD','END_CARD','MOVE','ATTACK','CORE',
    'EFFECT','ENCHANT','TERRAIN','FINISH_ENCHANT','BLOOD_SHADOW','BLOOD_BURST','BLOOD_MEMORY','MAP_SKILL','TRANSPORT','PERCEPTION','CAPTURE','WAIT','REACT','END_TACTICAL'].map(name=>[name,{
    dataset:{pvpAction:name},disabled:false,addEventListener(_,handler){this.trigger=handler},click(){this.trigger()}
  }]));
  const status={textContent:''},cards=new Select(),instantCards=new Select(),targetCards=new Select(),skills=new Select(),effectSkills=new Select(),enchantments=new Select(),enchantedAttacks=new Select(),bloodShadow=new Select(),bloodBurst=new Select(),bloodMemory=new Select(),mapSkills=new Select(),transports=new Select(),perceptionSkills=new Select(),reactions=new Select();
  const root={hidden:true,querySelector:x=>({
    '[data-pvp-battle-status]':status,'[data-pvp-cards]':cards,
    '[data-pvp-skills]':skills,'[data-pvp-instant-cards]':instantCards,'[data-pvp-target-cards]':targetCards,'[data-pvp-effect-skills]':effectSkills,'[data-pvp-enchantments]':enchantments,'[data-pvp-enchanted-attacks]':enchantedAttacks,'[data-pvp-blood-shadow]':bloodShadow,'[data-pvp-blood-burst]':bloodBurst,'[data-pvp-blood-memory]':bloodMemory,'[data-pvp-map-skills]':mapSkills,'[data-pvp-transports]':transports,'[data-pvp-perception-skills]':perceptionSkills,'[data-pvp-reactions]':reactions
  }[x]),querySelectorAll:()=>Object.values(controls)};
  const actions=[],renders=[],canvas={};
  const ui=new PvpTacticalUI({root,canvas,seat,
    sendCommand:action=>{actions.push(action);return true},ensureBabylon:async()=>{},
    createBridge:async()=>({accept:packet=>(renders.push(packet.revision),true),close:()=>renders.push('closed')})});
  return {ui,actions,root,controls,cards,instantCards,targetCards,skills,effectSkills,enchantments,enchantedAttacks,bloodShadow,bloodBurst,bloodMemory,mapSkills,transports,perceptionSkills,reactions,status,renders};
}
const make=(seat,phase,revision,units=[],reactionOptions=null)=>({revision,view:{seat,phase,
  activeSeat:phase==='BATTLEFIELD_READY'?null:seat,round:2,
  own:{hand:[{id:'imperial_swordsman_card',name:'帝國劍士',cost:1}],crystals:4},
  opponent:{handCount:5},units,reactionOptions,battlefield:{cores:[{owner:'ENEMY',x:8,y:7}]}}});
const soldier={id:'unit1',team:'P',characterId:'imperial_swordsman',x:2,y:3,
  alive:true,acted:false,moved:false,waited:false,attackSkills:[{id:'slash',name:'斬擊'}]};

test('mobile tactical UI renders official view and only sends proposed deployment/turn/move commands',()=>{
  const v=build();
  v.ui.receiveMatch(make(0,'BATTLEFIELD_READY',0));
  assert.equal(v.root.hidden,false);
  v.controls.BEGIN.click();
  v.ui.receiveMatch(make(0,'PLAYER_CARD_PHASE',1));
  assert.equal(v.cards.options.length,1);
  v.controls.DEPLOY.click();v.ui.tilePicked({seat:0,x:1,y:3});
  v.controls.END_CARD.click();
  v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',4,[soldier]));
  v.ui.tilePicked({seat:0,x:2,y:3});
  assert.equal(v.skills.options.some(x=>x.value==='slash'),true);
  v.controls.MOVE.click();v.ui.tilePicked({seat:0,x:3,y:3});
  assert.deepEqual(v.actions.map(x=>x.type),['BEGIN_BATTLE','DEPLOY_CARD','END_CARD_PHASE','MOVE_UNIT']);
  assert.deepEqual(v.actions[1],{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',x:1,y:3});
  assert.deepEqual(v.actions[3],{type:'MOVE_UNIT',unitId:'unit1',x:3,y:3});
  assert.equal(v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',3,[soldier])),false,'stale view rejected');
});

test('effect targeting button uses server-authored eligible skill option and sends target ID, no local healing',()=>{
  const v=build(0);const caster={...soldier,id:'caster',x:1,y:3,
    effectSkills:[{id:'saint_hero_heal',name:'治癒祈禱',target:'ALLY'}]};
  const ally={...soldier,id:'ally',x:2,y:3};
  v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',3,[caster,ally]));
  v.ui.tilePicked({seat:0,x:1,y:3});
  assert.equal(v.effectSkills.value,'saint_hero_heal');
  assert.equal(v.controls.EFFECT.disabled,false);
  v.controls.EFFECT.click();
  v.ui.tilePicked({seat:0,x:2,y:3});
  assert.deepEqual(v.actions,[{type:'CAST_EFFECT_SKILL',unitId:'caster',targetId:'ally',skillId:'saint_hero_heal'}]);
});

test('reaction controls accept only current defender seat data; cross seat tiles and stale render ignored' ,async()=>{
  const v=build(0),opts={choices:['ACCEPT','EVADE','DEFENSE','COUNTER'],
    defenses:[{id:'sword_parry',name:'長劍招架'}],counters:[{id:'slash',name:'斬擊'}],guardians:[]};
  v.ui.receiveMatch(make(0,'PVP_REACTION_PENDING',7,[soldier],opts));
  v.reactions.value='DEFENSE|sword_parry';
  v.controls.REACT.click();
  assert.deepEqual(v.actions,[{type:'REACT_ATTACK',reaction:'DEFENSE',methodId:'sword_parry'}]);
  assert.equal(v.controls.ATTACK.disabled,true);
  v.ui.tilePicked({seat:1,x:2,y:3});
  assert.equal(v.actions.length,1);
  await v.ui.receiveRender({seat:0,matchId:'ABCDEFGH',revision:7,snapshot:{revision:7}});
  await v.ui.receiveRender({seat:0,matchId:'ABCDEFGH',revision:6,snapshot:{revision:6}});
  await v.ui.receiveRender({seat:1,matchId:'ABCDEFGH',revision:8,snapshot:{revision:8}});
  assert.deepEqual(v.renders,[7]);
  v.ui.close();v.ui.close();
  assert.deepEqual(v.renders,[7,'closed']);
});

test('weather card control sends only its card ID and never an environment override',()=>{
 const v=build(0);
 const view=make(0,'PLAYER_CARD_PHASE',4);
 view.view.own.hand.push({id:'fog_card',name:'迷霧',cost:3});
 v.ui.receiveMatch(view);
 assert.equal(v.instantCards.options.length,1);
 assert.equal(v.controls.INSTANT.disabled,false);
 v.controls.INSTANT.click();
 assert.deepEqual(v.actions,[{type:'PLAY_INSTANT_CARD',cardId:'fog_card'}]);
});


test('targeted area spell and meteor UI only submit official card ID and tile, not client damage',()=>{
 const v=build(0),view=make(0,'PLAYER_CARD_PHASE',11);
 view.view.own.hand.push({id:'starfall_card',name:'星隕',cost:10});
 v.ui.receiveMatch(view);
 assert.equal(v.targetCards.options.length,1);
 assert.equal(v.controls.TARGET_CARD.disabled,false);
 v.controls.TARGET_CARD.click();
 v.ui.tilePicked({seat:0,x:7,y:2});
 assert.deepEqual(v.actions,[{type:'PLAY_TARGET_CARD',cardId:'starfall_card',x:7,y:2}]);
});

test('server-authored enchant choice produces only canonical option identifiers; self followup is stateful',()=>{
 const v=build(0),caster={...soldier,id:'caster',x:3,y:4,
   attackSkills:[{id:'black_slash',name:'黑劍斬擊',weaponSlot:'black_sword'},
     {id:'bow_shot',name:'弓箭射擊',weaponSlot:'kahns_bow'}],
   enchantmentOptions:[{skillId:'elemental_enchant',skillName:'火元素',variantId:'ENCHANT_FIRE',
     targetId:'caster',targetName:'自己',weaponSlot:'black_sword',weaponName:'黑劍'}],
   enchantedTerrainSkills:[{id:'black_slash',name:'黑劍斬擊',weaponSlot:'black_sword'}]};
 v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',8,[caster]));
 v.ui.tilePicked({seat:0,x:3,y:4});
 assert.equal(v.controls.ENCHANT.disabled,false);
 assert.equal(v.enchantments.options.length,1);
 v.controls.ENCHANT.click();
 assert.deepEqual(v.actions,[{type:'CAST_ENCHANTMENT',unitId:'caster',skillId:'elemental_enchant',
   variantId:'ENCHANT_FIRE',targetId:'caster',weaponSlot:'black_sword'}]);
 const after=make(0,'PLAYER_TACTICAL_PHASE',9,[caster]);
 after.view.enchantmentFollowup={unitId:'caster',weaponSlot:'black_sword'};
 v.ui.receiveMatch(after);
 assert.equal(v.skills.options.length,1,'self-followup limits attack to enchanted weapon');
 assert.equal(v.skills.value,'black_slash');
 assert.equal(v.controls.ENCHANT.disabled,true);
 assert.equal(v.controls.MOVE.disabled,true);
 assert.equal(v.controls.END_TACTICAL.disabled,true);
 assert.equal(v.controls.FINISH_ENCHANT.disabled,false);
 v.controls.FINISH_ENCHANT.click();
 assert.deepEqual(v.actions[1],{type:'END_ENCHANT_FOLLOWUP',unitId:'caster'});
});


test('terrain attack sends only the selected official weapon skill ID and target tile',()=>{
 const v=build(0),caster={...soldier,id:'caster',x:2,y:3,
   enchantedTerrainSkills:[{id:'bow_shot',name:'弓箭射擊',weaponSlot:'kahns_bow'}]};
 v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',4,[caster]));
 v.ui.tilePicked({seat:0,x:2,y:3});
 assert.equal(v.controls.TERRAIN.disabled,false);
 v.controls.TERRAIN.click();
 v.ui.tilePicked({seat:0,x:5,y:3});
 assert.deepEqual(v.actions,[{type:'ATTACK_ENCHANTED_TERRAIN',unitId:'caster',skillId:'bow_shot',x:5,y:3}]);
});


test('blood-shadow server options and pending memory selection send identifiers only',()=>{
 const v=build(0),vampire={...soldier,id:'vampire',characterId:'seraphina',
   bloodShadowOptions:[{skillId:'seraphina_blood_drain',skillName:'血影瞬襲',targetId:'victim',targetName:'帝國劍士'}]};
 v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',41,[vampire]));
 v.ui.tilePicked({seat:0,x:vampire.x,y:vampire.y});
 assert.equal(v.controls.BLOOD_SHADOW.disabled,false);
 v.controls.BLOOD_SHADOW.click();
 assert.deepEqual(v.actions[0],{type:'CAST_BLOOD_SHADOW',unitId:'vampire',
   skillId:'seraphina_blood_drain',targetId:'victim'});
 const pending=make(0,'PLAYER_TACTICAL_PHASE',42,[{...vampire,acted:false}]);
 pending.view.bloodMemoryChoice={unitId:'vampire',options:[{id:'slash',name:'斬擊'}]};
 v.ui.receiveMatch(pending);
 assert.equal(v.controls.END_TACTICAL.disabled,true);
 assert.equal(v.controls.BLOOD_SHADOW.disabled,true);
 assert.equal(v.controls.BLOOD_MEMORY.disabled,false);
 v.bloodMemory.value='slash';v.controls.BLOOD_MEMORY.click();
 assert.deepEqual(v.actions[1],{type:'CHOOSE_BLOOD_MEMORY',unitId:'vampire',skillId:'slash'});
 v.bloodMemory.value='';v.controls.BLOOD_MEMORY.click();
 assert.deepEqual(v.actions[2],{type:'CHOOSE_BLOOD_MEMORY',unitId:'vampire',skillId:null});
});


test('blood burst UI sends only authorized unit and server-published skill ID',()=>{
  const v=build();
  const vampire={...soldier,id:'vampire',bloodBurstSkills:[{id:'seraphina_blood_burst',name:'血爆'}]};
  v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',10,[vampire]));
  v.ui.tilePicked({seat:0,x:vampire.x,y:vampire.y});
  assert.equal(v.bloodBurst.options.length,1);
  assert.equal(v.controls.BLOOD_BURST.disabled,false);
  v.controls.BLOOD_BURST.click();
  assert.deepEqual(v.actions,[{type:'CAST_BLOOD_BURST',unitId:'vampire',skillId:'seraphina_blood_burst'}]);
  v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',11,[{...vampire,bloodBurstSkills:[]} ]));
  assert.equal(v.controls.BLOOD_BURST.disabled,true,'server is the sole action authority');
});


test('map-target AoE UI submits only server-granted skill identifier and selected tile',()=>{
 const v=build(0),caster={...soldier,id:'nereia',x:1,y:3,
   mapSkills:[{id:'nereia_tsunami',name:'海嘯'}]};
 v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',21,[caster]));
 v.ui.tilePicked({seat:0,x:1,y:3});
 assert.equal(v.mapSkills.value,'nereia_tsunami');
 assert.equal(v.controls.MAP_SKILL.disabled,false);
 v.controls.MAP_SKILL.click();
 v.ui.tilePicked({seat:0,x:3,y:4});
 assert.deepEqual(v.actions,[{type:'CAST_MAP_SKILL',unitId:'nereia',skillId:'nereia_tsunami',x:3,y:4}]);
 v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',22,[{...caster,acted:true,mapSkills:[]}]));
 assert.equal(v.controls.MAP_SKILL.disabled,true);
});


test('transport sends one complete pickup and drop command; no provisional passenger state leaves UI',()=>{
 const v=build(0),angel={...soldier,id:'angel',x:2,y:2,transportOptions:[{
   skillId:'angel_carry_ally',skillName:'空運友軍',targetId:'ally',targetName:'友軍'
 }]};
 v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',50,[angel]));
 v.ui.tilePicked({seat:0,x:2,y:2});
 assert.equal(v.controls.TRANSPORT.disabled,false);
 v.controls.TRANSPORT.click();
 assert.deepEqual(v.actions,[],'selecting passenger is only a local preview');
 v.ui.tilePicked({seat:0,x:4,y:3});
 assert.deepEqual(v.actions,[{type:'CAST_TRANSPORT',unitId:'angel',
   skillId:'angel_carry_ally',targetId:'ally',x:4,y:3}]);
 v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',51,[{...angel,acted:true,transportOptions:[]}]));
 assert.equal(v.controls.TRANSPORT.disabled,true);
});


test('perception skill uses server-published skill ID and enemy target only; no forged duration or mirror state',()=>{
 const v=build(0),caster={...soldier,id:'caster',perceptionSkills:[{id:'velsa_cognitive_corruption',name:'認知污染'}]};
 const enemy={...soldier,id:'enemy',team:'E',x:3,y:3};
 v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',60,[caster,enemy]));
 v.ui.tilePicked({seat:0,x:2,y:3});
 assert.equal(v.controls.PERCEPTION.disabled,false);
 v.controls.PERCEPTION.click();
 v.ui.tilePicked({seat:0,x:3,y:3});
 assert.deepEqual(v.actions,[{type:'CAST_PERCEPTION',unitId:'caster',
   targetId:'enemy',skillId:'velsa_cognitive_corruption'}]);
 v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',61,[{...caster,perceptionSkills:[]},enemy]));
 assert.equal(v.controls.PERCEPTION.disabled,true);
});

test('selected official skill and card survive a tactical UI refresh instead of reverting to the first choice',()=>{
 const v=build(0);
 const actor={...soldier,attackSkills:[
   {id:'standard_slash',name:'普通斬擊'},
   {id:'special_slash',name:'特殊斬擊'}
 ]};
 const other={...soldier,id:'victim',team:'E',x:3,y:3};
 v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',10,[actor,other]));
 v.ui.tilePicked({seat:0,x:2,y:3});
 v.skills.value='special_slash';
 v.controls.ATTACK.click();
 v.ui.tilePicked({seat:0,x:3,y:3});
 assert.deepEqual(v.actions.at(-1),{type:'DECLARE_ATTACK',attackerId:'unit1',targetId:'victim',skillId:'special_slash'});
 // The next authoritative revision must keep the player's legal selection.
 v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',11,[actor,other]));
 assert.equal(v.skills.value,'special_slash');
});

test('room and battle screens own tactical panel visibility independently of incoming socket state',()=>{
 const v=build(0);
 v.ui.setPresented(false);
 v.ui.receiveMatch(make(0,'PLAYER_CARD_PHASE',1));
 assert.equal(v.root.hidden,true,'an active remote match must not overlay the local game or room screen');
 v.ui.setPresented(true);
 assert.equal(v.root.hidden,false);
 v.ui.setPresented(false);
 v.ui.receiveMatch(make(0,'PLAYER_TACTICAL_PHASE',2,[soldier]));
 assert.equal(v.root.hidden,true,'even later match revisions remain hidden offscreen');
});

test('selected hand index survives entering deployment mode and sends the intended official card ID',()=>{
 const v=build(0);
 const data=make(0,'PLAYER_CARD_PHASE',14);
 data.view.own.hand.push({id:'imperial_spearman_card',name:'帝國槍兵',cost:3});
 v.ui.receiveMatch(data);
 assert.equal(v.cards.options.length,2);
 v.cards.value='1';
 v.controls.DEPLOY.click();
 v.ui.tilePicked({seat:0,x:2,y:2});
 assert.deepEqual(v.actions,[{type:'DEPLOY_CARD',cardId:'imperial_spearman_card',x:2,y:2}]);
});
