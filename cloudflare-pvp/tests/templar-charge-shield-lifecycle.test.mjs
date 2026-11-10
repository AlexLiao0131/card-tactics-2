import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {createEffectEngine} from '../../js/effect-engine.js';
import '../../js/tactical-action-controller.js';

const base=SkillDatabase.get('templar_charge');
const assault=SkillDatabase.resolveVariant(base,'CHARGE_ASSAULT');
const rescue=SkillDatabase.resolveVariant(base,'CHARGE_RESCUE');

function fixture({withSupport=true,blocked=false}={}){
  const actor={id:'templar',x:0,y:2,z:0,team:'P',alive:true,acted:false,moved:false,waited:false,mana:80,
    character:{name:'艾莉西亞',combat:{hp:200,move:5,atk:40,mdef:10},attributes:{},modifiers:{},weapons:{greatsword:{}}}};
  const defender={id:'enemy',x:3,y:2,z:0,team:'E',alive:true,acted:false,moved:false,
    character:{name:'敵人',combat:{hp:100},attributes:{},modifiers:{},weapons:{}}};
  const ally={id:'ally',x:2,y:1,z:0,team:'P',alive:true,acted:false,moved:false,
    character:{name:'友軍',combat:{hp:100},attributes:{},modifiers:{},weapons:{}}};
  const units=withSupport?[actor,defender,ally]:[actor,defender];
  const map={id:'test',tiles:Array.from({length:35},(_,i)=>({x:i%7,y:Math.floor(i/7),terrain:'PLAIN',elevation:0}))};
  const history=[];let pending=null,selection=new Map(),mode='attack',consumed=0;
  globalThis.TacticalEngine={
    tile:(_map,x,y)=>map.tiles.find(t=>t.x===x&&t.y===y)||null,
    range:s=>s?.range,
    canTarget:(_map,a,t,s)=>a?.alive&&t?.alive&&
      (s.target==='ENEMY'?a.team!==t.team:s.target==='ALLY'?a.team===t.team:true)&&
      Math.abs(t.x-a.x)+Math.abs(t.y-a.y)>=s.range.min&&
      Math.abs(t.x-a.x)+Math.abs(t.y-a.y)<=s.range.max,
    pathTo:(_map,_units,_actor,x,y)=>{
      if(blocked)return[];
      const path=[],dx=Math.sign(x-actor.x),dy=Math.sign(y-actor.y);
      if(dx!==0)for(let q=actor.x+dx;dx>0?q<=x:q>=x;q+=dx)path.push({x:q,y:actor.y});
      if(dy!==0)for(let q=actor.y+dy;dy>0?q<=y:q>=y;q+=dy)path.push({x,y:q});
      return path;
    },
    faceToward(){},ensureFacing:()=>'S'
  };
  globalThis.BattleResolution={
    supportCandidates:({initiator})=>{history.push(['support-anchor',initiator.x,initiator.y]);return withSupport?[{ally,skills:[{id:'cover-shot',name:'掩護射擊',support:true,target:'ENEMY',range:{min:1,max:4}}]}]:[];},
    createSupportAction:()=>({}),
    resolve:(options,hooks)=>{history.push(['resolve',options.initiator.x,options.initiator.y,options.skill.approach]);
      assert.equal(options.skill.approach,null,'official impact uses adjacent skill after committed move');
      assert.equal(options.skill.range.max,1);
      hooks.consumeSkill(options.initiator,options.skill);
      return{results:[{actor:options.initiator,skill:options.skill,result:{damage:10}}]};}
  };
  globalThis.UnitRuntimeEngine={humidityMdefBonus:()=>0,syncMana:()=>{},beginBloodTransaction:()=>{},endBloodTransaction:()=>{},attackEnhancement:()=>1,criticalManaRefund:()=>0};
  const ctx={TEAM:{PLAYER:'P',ENEMY:'E'},
    actionState:()=>({map,units,environmentState:null,selected:actor}),
    combatTargets:()=>units,
    unitAt:(x,y)=>units.find(u=>u.alive&&u.x===x&&u.y===y)||null,
    canUseSkill:()=>true,resourceFor:()=>({remaining:actor.mana,cost:16}),
    consumeSkill:()=>{consumed++;actor.mana-=16;return 16;},
    effectiveSkill:(_a,s)=>s,targetType:s=>s?.targetType||'SINGLE',
    traverseUnitPath:(unit,path)=>{history.push(['traverse',path.length]);const last=path.at(-1);unit.x=last.x;unit.y=last.y;return{completed:true};},
    enterTile:()=>{},checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,
    pushLog:()=>{},render:()=>{history.push(['render',mode]);},
    setPendingEngagement:v=>{pending=v;},getPendingEngagement:()=>pending,
    setSupportSelection:v=>{selection=v;},getSupportSelection:()=>selection,
    setMode:v=>{mode=v;},setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},
    clearEngagement:()=>{pending=null;},handleDefeated:()=>{},logBattleAction:()=>{},logPostEffect:()=>{},
    coreAt:()=>null
  };
  const controller=globalThis.TacticalActionController.create(ctx);
  return{actor,defender,ally,units,history,controller,get pending(){return pending;},
    get mode(){return mode;},get consumed(){return consumed;},cancel(){pending=null;mode='attack';}};
}

test('charge attack preview and support screen do not move, spend MP, or trigger damage',()=>{
  const f=fixture();
  f.controller.prepareAttack(f.actor,f.defender,assault,{confirmOrdinaryAttack:true});
  assert.equal(f.mode,'support-select');
  assert.deepEqual([f.actor.x,f.actor.y,f.actor.moved,f.actor.mana],[0,2,false,80]);
  assert.equal(f.consumed,0);
  assert.equal(f.history.some(x=>x[0]==='traverse'||x[0]==='resolve'),false);
  assert.ok(f.pending);
  assert.equal(f.pending.candidates.length,1,'support option remains available at predicted landing');
  assert.deepEqual(f.pending.approachLanding,{x:2,y:2});
  assert.deepEqual(f.history.find(x=>x[0]==='support-anchor'),['support-anchor',2,2]);
});

test('target selection only previews assault and does not relocate before the support menu',()=>{
  const f=fixture({withSupport:true});
  assert.equal(f.controller.approachTargetForAttack(f.actor,f.defender,assault),true);
  assert.deepEqual([f.actor.x,f.actor.y,f.actor.moved,f.actor.mana],[0,2,false,80]);
  assert.equal(f.history.some(x=>x[0]==='traverse'),false);
});

test('canceling attack confirmation preserves original position and resource',()=>{
  const f=fixture();
  f.controller.prepareAttack(f.actor,f.defender,assault,{confirmOrdinaryAttack:true});
  f.cancel();
  assert.deepEqual([f.actor.x,f.actor.y,f.actor.moved,f.actor.mana],[0,2,false,80]);
  assert.equal(f.history.some(x=>x[0]==='traverse'||x[0]==='resolve'),false);
});

test('only CONFIRM_ENGAGEMENT triggers assault movement then attack exactly once',()=>{
  const f=fixture();
  f.controller.prepareAttack(f.actor,f.defender,assault,{confirmOrdinaryAttack:true});
  assert.equal(f.actor.x,0);
  f.controller.confirmEngagement();
  assert.deepEqual([f.actor.x,f.actor.y,f.actor.moved,f.actor.acted,f.actor.mana],[2,2,true,true,64]);
  assert.equal(f.history.filter(x=>x[0]==='traverse').length,1);
  assert.equal(f.history.filter(x=>x[0]==='resolve').length,1);
  assert.ok(f.history.findIndex(x=>x[0]==='traverse')<f.history.findIndex(x=>x[0]==='resolve'));
});

test('no legal charge path fails at preview before any movement or cost',()=>{
  const f=fixture({blocked:true});
  f.controller.prepareAttack(f.actor,f.defender,assault,{confirmOrdinaryAttack:true});
  assert.equal(f.pending,null);
  assert.deepEqual([f.actor.x,f.actor.moved,f.actor.mana],[0,false,80]);
});

test('canonical PvP approachForSkill still commits movement when its command is accepted',()=>{
  const f=fixture();
  assert.equal(f.controller.approachForSkill(f.actor,f.defender,assault),true);
  assert.equal(f.actor.x,2);assert.equal(f.actor.moved,true);
});

test('HOLY_SHIELD retains its authored two full future rounds and real invulnerability',()=>{
  const shield=SkillDatabase.get('templar_holy_shield');
  const rule=shield.effects.find(x=>x.id==='HOLY_SHIELD');
  assert.equal(rule.duration,2,'do not inflate the skill numbers');
  assert.equal(rule.durationClock,'FULL_FUTURE_ROUNDS');
  const eng=createEffectEngine();
  const unit={id:'templar',team:'P',alive:true,hp:200,
    character:{combat:{hp:200,mdef:10},attributes:{},modifiers:{},passives:[]}};
  eng.apply({source:unit,target:unit,effect:rule});
  assert.equal(eng.isInvulnerable(unit),true);
  assert.equal(eng.state(unit).find(e=>e.id==='HOLY_SHIELD').remaining,2);
  eng.tick(unit,{units:[unit]});
  assert.equal(eng.isInvulnerable(unit),true,'first future round is fully protected');
  assert.equal(eng.state(unit).find(e=>e.id==='HOLY_SHIELD').remaining,2);
  eng.tick(unit,{units:[unit]});
  assert.equal(eng.isInvulnerable(unit),true,'second future round is fully protected');
  assert.equal(eng.state(unit).find(e=>e.id==='HOLY_SHIELD').remaining,1);
  eng.tick(unit,{units:[unit]});
  assert.equal(eng.isInvulnerable(unit),false,'shield expires after two future full rounds');
});

test('ordinary two-round buffs retain original counting; reapplication refreshes shield timer',()=>{
  const eng=createEffectEngine();
  const unit={id:'a',team:'P',alive:true,hp:100,character:{combat:{hp:100},attributes:{},modifiers:{}}};
  eng.apply({source:unit,target:unit,effect:{type:'BUFF',id:'TEST',duration:2}});
  eng.tick(unit,{units:[unit]});
  assert.equal(eng.state(unit).find(x=>x.id==='TEST').remaining,1);
  eng.tick(unit,{units:[unit]});
  assert.equal(eng.hasEffect(unit,'TEST'),false);
  const shield=SkillDatabase.get('templar_holy_shield').effects[0];
  eng.apply({source:unit,target:unit,effect:shield});
  eng.tick(unit,{units:[unit]});
  eng.apply({source:unit,target:unit,effect:shield});
  assert.equal(eng.state(unit).filter(x=>x.id==='HOLY_SHIELD').length,1);
  assert.equal(eng.state(unit).find(x=>x.id==='HOLY_SHIELD').remaining,2);
  assert.equal(eng.state(unit).find(x=>x.id==='HOLY_SHIELD').pendingFirstRoundTick,true);
});


test('rescue charge retains official target-commit movement and establishes HP link',()=>{
  const f=fixture({withSupport:true});
  f.controller.prepareAttack(f.actor,f.ally,rescue,{confirmOrdinaryAttack:true});
  assert.equal(f.history.filter(x=>x[0]==='traverse').length,1);
  assert.equal(f.consumed,1);
  assert.equal(f.actor.acted,true);
  assert.equal(f.ally.effects?.some(effect=>effect.id==='TEMPLAR_HP_LINK'),true);
  assert.equal(f.pending,null);
});

test('two full future turns do not prevent immediate dispel, and other buffs are unaffected',()=>{
  const eng=createEffectEngine();
  const unit={id:'a',team:'P',alive:true,hp:100,character:{combat:{hp:100},attributes:{},modifiers:{}}};
  eng.apply({source:unit,target:unit,effect:SkillDatabase.get('templar_holy_shield').effects[0]});
  eng.tick(unit,{units:[unit]});
  assert.equal(eng.isInvulnerable(unit),true);
  eng.removeEffectById(unit,'HOLY_SHIELD');
  assert.equal(eng.isInvulnerable(unit),false);
});
