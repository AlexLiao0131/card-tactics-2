import test from 'node:test';
import assert from 'node:assert/strict';
import {UnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import {CombatContactRules} from '../../js/combat-contact-rules.js';
import {SKILLS} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import '../../js/tactical-action-controller.js';

test('滿30魂森靈之怒變半徑2自然範圍攻擊＋友軍治療，消耗一次後恢復單體',()=>{
  const u={alive:true,character:{id:'ophi',attributes:{int:20,wil:20},resourceRules:{forestSoul:{max:30,initial:0,naturalRecovery:0}}},resources:{forestSoul:{value:30,max:30}},mana:120};
  const ready=UnitRuntimeEngine.skillForUnit(u,SKILLS.ophi_forest_wrath);
  assert.equal(ready.target,'TILE');assert.equal(ready.targetType,'AOE');
  assert.equal(ready.radius,2);assert.equal(ready.areaDamage?.relation,'ENEMY');
  assert.equal(ready.areaDamage.hitRule,'AREA_CONTACT');
  assert.deepEqual(ready.relationEffects,[{relation:'ALLY',type:'HEAL',amount:60}]);
  assert.equal(UnitRuntimeEngine.applyResourceScaling(u,SKILLS.ophi_forest_wrath).forestSoulSpent,30);
  const spent=UnitRuntimeEngine.consumeSkill(u,ready);
  assert.equal(spent.resources.forestSoul.cost,30);assert.equal(u.resources.forestSoul.value,0);
  assert.equal(UnitRuntimeEngine.skillForUnit(u,SKILLS.ophi_forest_wrath).target,'ENEMY');
});

test('不足30魂保留原單體，沒有提前觸發區域友軍回血',()=>{
 const u={alive:true,character:{id:'ophi',resourceRules:{forestSoul:{max:30,initial:0}}},resources:{forestSoul:{value:29,max:30}}};
 const s=UnitRuntimeEngine.skillForUnit(u,SKILLS.ophi_forest_wrath);
 assert.equal(s.target,'ENEMY');assert.equal(s.areaDamage,undefined);
 assert.equal(s.relationEffects,undefined);
});

test('純魔法不開普通迴避，但MAGIC類型的實體箭矢仍可閃避',()=>{
 const actor={character:{weapons:{bow:{attackType:'SHOT',weaponKind:'BOW'}}}};
 assert.equal(CombatContactRules.canActiveEvade(actor,SKILLS.ophi_forest_wrath),false);
 assert.equal(CombatContactRules.canActiveEvade(actor,SKILLS.angel_holy_shot),true);
 assert.equal(CombatContactRules.canActiveEvade(actor,SKILLS.ophi_triple_shot),true);
});

test('多重箭重複確認指令僅有一次技能提交、一次AOE傷害與一次行動結束',()=>{
 const names=['UnitRuntimeEngine','TacticalEngine','BattleEngine','EffectEngine','EnvironmentEngine','UnitAnimationEngine','AngelWingBarrierEngine','BattleResolution'];
 const prev=Object.fromEntries(names.map(n=>[n,globalThis[n]]));
 const target={id:'e1',team:'E',alive:true,x:2,y:1,hp:150,character:{name:'敵軍',combat:{hp:150}}};
 const attacker={id:'p1',team:'P',alive:true,x:1,y:1,hp:100,mana:100,acted:false,waited:false,moved:false,
   character:{id:'ophi',name:'奧菲',passives:[],weapons:{elven_bow:{weaponKind:'BOW',attackType:'SHOT'}},combat:{hp:100,atk:100}}};
 const tile={x:2,y:1,elevation:0,terrain:'PLAIN'};
 const map={width:4,height:4,tiles:[{x:1,y:1,elevation:0,terrain:'PLAIN'},tile],objects:[]};
 let commits=0,anim=0,hits=0;
 try{
   globalThis.UnitRuntimeEngine={rollSanityMisfire:()=>false,beginBloodTransaction:()=>{},endBloodTransaction:()=>{},attackEnhancement:()=>1,forestSoulMagicPower:()=>0};
   globalThis.TacticalEngine={faceToward:()=>{},fanTiles:()=>[tile],hasLineOfSight:()=>true};
   globalThis.BattleEngine={calculate:()=>({hit:true,damage:30,crit:false,type:'SHOT',el:'NONE',hc:95}),critChance:()=>0};
   globalThis.EffectEngine={breakStealth:()=>{},interruptChannel:()=>{},consumeWeaponEnchantment:()=>null,
     applyDamage:(u,amount)=>{if(amount>0)hits++;let hpLoss=Math.min(u.hp,amount);u.hp-=hpLoss;return{hpLoss,absorbed:0}}};
   globalThis.EnvironmentEngine={effectAt:()=>[],EFFECT:{BURNING:'BURNING'}};
   globalThis.BattleResolution={previewInherentBonus:()=>0,enchantmentMagicDamage:()=>0};
   globalThis.AngelWingBarrierEngine={TYPE:'ANGEL_HOLY_WING_BARRIER'};
   globalThis.UnitAnimationEngine={emitAction:()=>{anim++;return{}},emitResolvedHit:()=>{},emitHit:()=>{},emitOutcome:()=>{}};
   const ctx={TEAM:{PLAYER:'P',ENEMY:'E'},actionState:()=>({map,units:[attacker,target],environmentState:{}}),
     canUseSkill:()=>true,consumeSkill:()=>{commits++;return{cost:18}},effectiveSkill:(u,s)=>s,
     unitAt:(x,y)=>x===target.x&&y===target.y?target:null,random:()=>.5,
     pushLog:()=>{},logEnvironmentEvent:()=>{},checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,render:()=>{},
     setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},
     resolveEnvironmentEvents:()=>{}};
   const c=globalThis.TacticalActionController.create(ctx);
   assert.equal(c.executeMapSkill(attacker,tile,SKILLS.ophi_multishot),true);
   assert.equal(c.executeMapSkill(attacker,tile,SKILLS.ophi_multishot),false);
   assert.equal(commits,1);assert.equal(anim,1);assert.equal(hits,1);
   assert.equal(attacker.acted,true);assert.equal(attacker.waited,true);
   assert.equal(target.hp,120);
 }finally{for(const [n,v]of Object.entries(prev))if(v===undefined)delete globalThis[n];else globalThis[n]=v;}
});


test('主程式官方fanTiles扇形幾何未被更新包遺失',()=>{
 const map={tiles:Array.from({length:100},(_,i)=>({x:i%10,y:Math.floor(i/10)}))};
 const cells=TacticalEngine.fanTiles(map,{x:2,y:2},{x:6,y:2},{length:4});
 assert.ok(cells.length>4);
 assert.ok(cells.every(t=>t.x>=3&&t.x<=6));
 assert.equal(new Set(cells.map(t=>`${t.x},${t.y}`)).size,cells.length);
});

test('多重箭正式扇形範圍內兩名敵軍實際扣血，友軍不受傷，重複施放不再扣血',()=>{
  // Do not fake the wedge/visibility calculation: the original TacticalEngine
  // owns which map cells get shot. Stub ONLY out-of-scope global rendering,
  // resource, damage engines so we can assert committed HP mutation.
  const globals=['TERRAINS','UnitRuntimeEngine','BattleEngine','EffectEngine','EnvironmentEngine',
    'UnitAnimationEngine','AngelWingBarrierEngine','BattleResolution'];
  const before=Object.fromEntries(globals.map(n=>[n,globalThis[n]]));
  const mk=(id,team,x,y,hp)=>({id,team,alive:true,x,y,hp,acted:false,waited:false,
    character:{id:id==='shooter'?'ophi':id,name:id,passives:[],skills:[],
      attributes:{agi:15,luk:12},weapons:{elven_bow:{weaponKind:'BOW',attackType:'SHOT'}},
      combat:{hp,atk:100,def:40,matk:80,mdef:50},armor:{element:'NONE'}}});
  const shooter=mk('shooter','P',2,4,225);
  const front=mk('front','E',5,4,200),right=mk('right','E',6,5,200),ally=mk('ally','P',4,4,200);
  const units=[shooter,front,right,ally];
  const map={width:10,height:10,objects:[],tiles:Array.from({length:100},(_,i)=>({
    x:i%10,y:Math.floor(i/10),elevation:0,terrain:'PLAIN'}))};
  let cast=0,physicalHits=0,animation=0;const logs=[];
  try{
    globalThis.TERRAINS={PLAIN:{evasion:0,passable:true,moveCost:1}};
    globalThis.UnitRuntimeEngine={rollSanityMisfire:()=>false,beginBloodTransaction:()=>{},
      endBloodTransaction:()=>{},attackEnhancement:()=>1,forestSoulMagicPower:()=>0};
    globalThis.BattleEngine={calculate:(a,d,skill,{distance,random})=>{
      assert.equal(skill.attackType,'SHOT');
      assert.equal(skill.areaDamage?.mode,'PHYSICAL_VOLLEY');
      assert.ok(distance>0&&distance<=5);
      return {hit:true,damage:Math.round(a.combat.atk*skill.power-d.combat.def*.5),
        crit:false,type:'SHOT',el:'NONE',hc:85};
    },critChance:()=>0};
    globalThis.EffectEngine={breakStealth:()=>{},interruptChannel:()=>{},
      consumeWeaponEnchantment:()=>null,applyDamage:(u,n)=>{
        let hpLoss=Math.max(0,Math.min(u.hp,Math.round(n||0)));
        u.hp-=hpLoss;if(hpLoss)physicalHits++;
        return {hpLoss,absorbed:0};}};
    globalThis.EnvironmentEngine={effectAt:()=>[],EFFECT:{BURNING:'BURNING'}};
    globalThis.UnitAnimationEngine={emitAction:()=>{animation++;return{}},
      emitResolvedHit:()=>{},emitHit:()=>{},emitOutcome:()=>{}};
    globalThis.AngelWingBarrierEngine={TYPE:'ANGEL_HOLY_WING_BARRIER',blocksIncoming:()=>false};
    globalThis.BattleResolution={previewInherentBonus:()=>0,enchantmentMagicDamage:()=>0};
    const ctx={TEAM:{PLAYER:'P',ENEMY:'E'},actionState:()=>({map,units,environmentState:null}),
      canUseSkill:()=>true,consumeSkill:()=>{cast++;return {cost:18}},effectiveSkill:(u,s)=>s,
      unitAt:(x,y)=>units.find(u=>u.alive&&u.x===x&&u.y===y)||null,
      random:()=>0,pushLog:(line)=>logs.push(line),logEnvironmentEvent:()=>{},
      checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,render:()=>{},
      setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},resolveEnvironmentEvents:()=>{}};
    const controller=globalThis.TacticalActionController.create(ctx);
    const aim={x:5,y:4};
    const wedge=TacticalEngine.fanTiles(map,shooter,aim,{length:4});
    assert.ok(wedge.some(t=>t.x===front.x&&t.y===front.y));
    assert.ok(wedge.some(t=>t.x===right.x&&t.y===right.y));
    assert.equal(TacticalEngine.hasLineOfSight(map,shooter,front,{...SKILLS.ophi_multishot,target:'ENEMY',targetType:'SINGLE'}),true);
    assert.equal(controller.executeMapSkill(shooter,aim,SKILLS.ophi_multishot),true);
    assert.equal(front.hp,135);assert.equal(right.hp,135);assert.equal(ally.hp,200);
    assert.equal(physicalHits,2);assert.equal(animation,1);assert.equal(cast,1);
    assert.equal(shooter.acted,true);assert.equal(shooter.waited,true);
    assert.equal(controller.executeMapSkill(shooter,aim,SKILLS.ophi_multishot),false);
    assert.equal(front.hp,135);assert.equal(right.hp,135);
    assert.ok(logs.some(line=>line.includes('命中 2')));
  }finally{
    for(const [n,v] of Object.entries(before))if(v===undefined)delete globalThis[n];else globalThis[n]=v;
  }
});
