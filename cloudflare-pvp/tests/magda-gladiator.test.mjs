import test from 'node:test';
import assert from 'node:assert/strict';
// Mirror the browser CORE_LOAD_ORDER. Only established engine/database files are imported.
const core=new URL('../../js/',import.meta.url);
for(const name of ['terrain-database.js','resource-profile-database.js','skill-database.js','equipment-database.js',
  'character-database.js','card-database.js','visual-database.js',
  'companion-database.js','loadout-database.js','tactical-engine.js',
  'vertical-mobility-engine.js','unit-runtime-engine.js','effect-engine.js',
  'environment-object-engine.js','displacement-engine.js','death-lifecycle-engine.js']) await import(new URL(name,core));
const rt=globalThis.UnitRuntimeEngine;
const skills=globalThis.SkillDatabase;
const get=id=>skills.get(id);
const create=()=>rt.create({id:'magda-test',team:'P',characterId:'magda',x:1,y:1,
  map:{id:'test',width:3,height:3,tiles:Array.from({length:9},(_,i)=>({x:i%3,y:Math.floor(i/3),terrain:'PLAIN',elevation:0})),objects:[]}});
test('官方角色資源、卡牌、裝備、技能與既有 FIGURE 視覺註冊完整',()=>{
  assert.equal(globalThis.LoadoutDatabase.validate(),true);
  const u=create();
  assert.equal(u.mana,0);assert.equal(u.maxMana,0);
  assert.deepEqual(u.resources.rage,{value:0,max:100,label:'憤怒'});
  assert.equal(globalThis.CARDS.magda_card.characterId,'magda');
  const visual=globalThis.VisualDatabase.characterBattle('magda_default');
  assert.equal(visual.kind,'FIGURE');
  assert.equal(visual.figure.arenaGreatsword,true);
  assert.equal(visual.figure.arenaGladiatorArmor,true);
  assert.equal(visual.figure.arenaSkirt,true);
  assert.equal(visual.asset,undefined);
  assert.equal(globalThis.VisualDatabase.characterHudPortrait('magda'),'assets/images/cards/heroes/magda.png');
  assert.equal(u.character.weapons.greatsword.id,'magda_gladiator_greatsword');
  assert.deepEqual(u.character.skills,['magda_rage_slash','magda_leap_quake','magda_breaking_cleave','magda_execution']);
});
test('怒氣技能依施放前值等比例提高威力且不產生 MP',()=>{
 const u=create();rt.changeRage(u,60);
 const skill=rt.applyResourceScaling(u,get('magda_breaking_cleave'));
 assert.equal(skill.power,1.25*1.6);assert.equal(skill.rageSnapshot,60);
 assert.equal(rt.canUseSkill(u,skill),true);
 const spent=rt.consumeSkill(u,skill);assert.equal(spent.resources.rage.cost,25);
 assert.equal(u.resources.rage.value,35);assert.equal(u.mana,0);
 assert.equal(rt.applyResourceScaling(u,skill).power,skill.power);
});
test('承受或造成實際 HP 傷害獲得怒氣，護盾完全吸收不加',()=>{
 const u=create();const dummy={id:'d',team:'E',alive:true,hp:100,character:{combat:{hp:100}},effects:[]};
 const a=globalThis.EffectEngine.applyDamage(dummy,17,{source:u});
 assert.equal(a.hpLoss,17);assert.equal(rt.rageValue(u),3);
 const b=globalThis.EffectEngine.applyDamage(u,9,{source:dummy});
 assert.equal(b.hpLoss,9);assert.equal(rt.rageValue(u),5);
});
test('蓄怒斬擊不消耗怒氣，其他招耗怒，斬殺清空',()=>{
 const u=create();assert.equal(rt.canUseSkill(u,get('magda_rage_slash')),true);
 assert.equal(rt.consumeSkill(u,get('magda_rage_slash')).cost,0);
 rt.changeRage(u,55);
 assert.equal(rt.canUseSkill(u,get('magda_leap_quake')),true);
 assert.equal(rt.consumeSkill(u,rt.applyResourceScaling(u,get('magda_leap_quake'))).resources.rage.cost,20);
 assert.equal(rt.rageValue(u),35);
 const execution=rt.applyResourceScaling(u,get('magda_execution'));
 assert.equal(execution.rageSnapshot,35);
 assert.equal(rt.consumeSkill(u,execution).resources.rage.cost,35);
 assert.equal(rt.rageValue(u),0);
 assert.equal(rt.canUseSkill(u,get('magda_execution')),false);
});
test('墜落另算 HP 傷害時，傷害來源只獲得一次怒氣，不重複給被害者',()=>{
 const u=create();const target={team:'E',alive:true,resources:{},character:{},hp:30};
 assert.equal(rt.onRageForcedLanding(u,target,{fallDamage:17}),3);
 assert.equal(rt.rageValue(u),3);
 assert.equal(rt.onRageForcedLanding(u,{...target,team:'P'},{fallDamage:17}),0);
 assert.equal(rt.onRageForcedLanding(u,target,{fallDamage:0}),0);
});
test('嗜戰擊殺加怒 + 同一次技能返還一次消耗',()=>{
 const u=create();rt.changeRage(u,55);
 const skill=rt.applyResourceScaling(u,get('magda_breaking_cleave'));
 rt.consumeSkill(u,skill);assert.equal(rt.rageValue(u),30);
 const target={id:'d',team:'E',alive:true,hp:0,cardId:null,character:{id:'imperial_swordsman',name:'敵人',combat:{hp:100}}};
 const death=globalThis.DeathLifecycleEngine.create({stageEvent:()=>{},cardStateFor:()=>null,pushLog:()=>{}});
 assert.equal(death.finalize(target,u,skill),true);
 assert.equal(rt.rageValue(u),70);
 assert.equal(death.finalize(target,u,skill),false);
 assert.equal(rt.rageValue(u),70);
 const newTarget={id:'d2',team:'E',alive:true,hp:0,character:{id:'imperial_swordsman',name:'敵人',combat:{hp:100}}};
 death.finalize(newTarget,u,skill);
 assert.equal(rt.rageValue(u),85); // second kill has flat 15, no second refund
});
test('巨人之力控制抗性與強制位移抗性規則列入既有判定',()=>{
 const u=create();const p=skills.passiveList(u.character.passives);
 assert(p.some(v=>v.id==='MAGDA_GIANT_STRENGTH'));
 assert(p.some(v=>v.id==='MAGDA_BATTLE_HUNGER'));
 assert.equal(u.character.displacement.weightClass,'HEAVY');
 assert.equal(u.character.displacement.resistance,2);
 assert.equal(globalThis.ResourceEngine.RESOURCE_PROFILES.rage.controlResistance,40);
});
test('跳躍震地只有一招，並且附帶正式物理範圍打擊',()=>{
 const s=get('magda_leap_quake');
 assert.equal(s.jumpShockwave,true);assert.equal(s.moveToTarget,true);
 assert.equal(s.shape,'W_STEP');assert.equal(s.areaDamage.mode,'PHYSICAL_IMPACT');
 assert.equal(s.resourceCosts.rage,20);
});
test('破陣劈斬指定實體環境樹木，正式樹木可化為樹樁與倒木',()=>{
 const s=get('magda_breaking_cleave');assert.equal(s.treeFelling,true);
 assert.equal(s.environmentTarget,'TREE');assert.equal(s.giantUppercut,true);
 const world={width:3,height:3,tiles:Array.from({length:9},(_,i)=>({x:i%3,y:Math.floor(i/3),terrain:'PLAIN',elevation:0})),objects:[]};
 const eng=globalThis.EnvironmentObjectEngine;
 const tree=eng.spawn(world,{id:'t1',type:'TREE',x:1,y:0});
 const events=[];const log=eng.fellTree(world,tree,{events,reason:'MAGDA_GREAT_SWORD'});
 assert(log);assert.equal(tree.type,'STUMP');assert.equal(log.type,'LOG');assert(events.some(e=>e.type==='TREE_FELLED'));
});

await import(new URL('battle-engine.js',core));
const {createBattleResolution}=await import(new URL('battle-resolution.js',core));
const doAttack=(actor,target,skill)=>{
  const engine=createBattleResolution({random:()=>0});
  return engine.resolve({map:actor._runtimeMap,units:[actor,target],initiator:actor,target,
    skill:rt.applyResourceScaling(actor,skill),actions:[]},{
    canUseSkill:rt.canUseSkill,consumeSkill:rt.consumeSkill,
    onDefeated:()=>{},onAction:()=>{}});
};
const createDuel=(targetId='imperial_swordsman')=>{
  const map={width:4,height:4,tiles:Array.from({length:16},(_,i)=>({x:i%4,y:Math.floor(i/4),terrain:'PLAIN',elevation:0})),objects:[]};
  const hero=rt.create({id:'m'+Math.random(),team:'P',characterId:'magda',x:1,y:1,map});
  const target=rt.create({id:'e'+Math.random(),team:'E',characterId:targetId,x:2,y:1,map});
  return {hero,target,map};
};
test('正式 BattleResolution：蓄怒斬擊命中後 Rage 增長且不減 MP',()=>{
 const {hero,target}=createDuel();const hp=target.hp;
 const engagement=doAttack(hero,target,get('magda_rage_slash'));
 assert.equal(engagement.results.length,1);
 assert.equal(engagement.results[0].result.hit,true);
 assert(target.hp<hp);assert(rt.rageValue(hero)>8);
 assert.equal(hero.mana,0);
});
test('正式 BattleResolution：對重甲施加破甲而不排入擊飛',()=>{
 const {hero,target}=createDuel('imperial_heavy_guard');rt.changeRage(hero,90);
 // Retain HEAVY armour, but disable unrelated automatic heavy-guard defense
 // so this test specifically verifies the ON-HIT armor-break branch.
 target.character={...target.character,armorId:null,armor:{type:'HEAVY',defenseProfiles:[]},
   weapons:{},equipment:[],guard:null};
 const result=doAttack(hero,target,get('magda_breaking_cleave'));
 assert.equal(result.results[0].result.hit,true);
 assert(target.effects.some(e=>e.id==='MAGDA_ARMOR_BREAK'));
 assert.equal((result.post?.queue||[]).some(e=>Number(e.effect?.lift)>0),false);
});
test('正式 BattleResolution：斬殺消耗全怒，斬殺線內直接使目標歸零',()=>{
 const {hero,target}=createDuel('imperial_heavy_guard');rt.changeRage(hero,100);
 const attack=get('magda_execution');target.hp=12;
 const result=doAttack(hero,target,attack);
 assert.equal(result.results[0].result.hit,true);
 assert.equal(target.hp,0);assert.equal(hero.resources.rage.value>=0,true);
 assert.equal(hero._rageLastSkillSpend.amount,100);
});

await import(new URL('tactical-action-controller.js',core));
const makeArena=(w=6,h=6)=>({width:w,height:h,
  tiles:Array.from({length:w*h},(_,i)=>({x:i%w,y:Math.floor(i/w),terrain:'PLAIN',elevation:0})),objects:[]});
const makeController=(map,units,logs,extras={})=>globalThis.TacticalActionController.create({
  TEAM:{PLAYER:'P',ENEMY:'E'},actionState:()=>({map,units,environmentState:null,round:1}),
  unitAt:(x,y)=>units.find(u=>u.alive&&u.x===x&&u.y===y)||null,coreAt:()=>null,
  canUseSkill:rt.canUseSkill,consumeSkill:rt.consumeSkill,effectiveSkill:rt.applyResourceScaling,
  resourceFor:rt.resourceFor,pushLog:(...args)=>logs.push(args),logEnvironmentEvent:()=>{},
  resolveEnvironmentEvents:()=>{},applyEnvironmentHazardToUnit:()=>{},enterTile:()=>{},
  checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,setSelectedSkill:()=>{},
  setSelectedSkillVariant:()=>{},setMode:()=>{},render:()=>{},
  aoeTiles:(center,radius)=>globalThis.TacticalEngine.aoeTiles(map,center,radius),
  lineTiles:()=>[],random:()=>0,handleDefeated:()=>{},logPostEffect:()=>{},sanctuaryTiles:()=>[],
  ...extras
});
test('正式 TacticalActionController：破陣劈斬能指定樹木並實際砍倒',()=>{
  const map=makeArena(),hero=rt.create({id:'magda-tree-test',team:'P',characterId:'magda',x:1,y:1,map});
  rt.changeRage(hero,80);
  const eng=globalThis.EnvironmentObjectEngine;
  const tree=eng.spawn(map,{id:'target-tree',type:'TREE',x:2,y:1});
  const controller=makeController(map,[hero],[]),skill=get('magda_breaking_cleave');
  assert(controller.environmentTargetTiles(hero,skill).some(t=>t.x===2&&t.y===1));
  assert.equal(controller.executeEnvironmentTargetSkill(hero,map.tiles.find(t=>t.x===2&&t.y===1),skill),true);
  assert.equal(tree.type,'STUMP');
  assert(map.objects.some(o=>o.type==='LOG'&&o.x===2&&o.y===1));
  assert.equal(rt.rageValue(hero),55);assert.equal(hero.acted,true);
});
test('正式 TacticalActionController：跳躍震地先落點，再物理範圍傷害，只消耗一次憤怒',async()=>{
  // Existing map controller requires the loaded core's wing/atmosphere owners;
  // these stubs only stand in for unchanged scenery outside this focused fixture.
  const oldAngel=globalThis.AngelWingBarrierEngine,oldEnv=globalThis.EnvironmentEngine;
  globalThis.AngelWingBarrierEngine={TYPE:'TEST_WING'};
  globalThis.EnvironmentEngine={effectAt:()=>[],EFFECT:{BURNING:'BURNING'}};
  try{
    const map=makeArena(),hero=rt.create({id:'magda-jump-test',team:'P',characterId:'magda',x:1,y:1,map});
    const target=rt.create({id:'test-target',team:'E',characterId:'imperial_swordsman',x:3,y:2,map});
    rt.changeRage(hero,90);
    const skill=get('magda_leap_quake'),log=[];
    const controller=makeController(map,[hero,target],log);
    const tile=map.tiles.find(t=>t.x===3&&t.y===1),hp=target.hp;
    assert(controller.mapTargetTiles(hero,skill).includes(tile));
    assert.equal(controller.executeMapSkill(hero,tile,skill),true);
    assert.equal(hero.x,3);assert.equal(hero.y,1);assert.equal(hero.acted,true);
    assert(target.hp<hp,'area physical hit must actually damage target');
    assert(rt.rageValue(hero)<=100);
    assert(log.some(line=>line[0].includes('跳躍震地')));
  }finally{
    if(oldAngel===undefined)delete globalThis.AngelWingBarrierEngine;else globalThis.AngelWingBarrierEngine=oldAngel;
    if(oldEnv===undefined)delete globalThis.EnvironmentEngine;else globalThis.EnvironmentEngine=oldEnv;
  }
});
