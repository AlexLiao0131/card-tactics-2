import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {SKILLS} from '../../js/skill-database.js';

const here=dirname(fileURLToPath(import.meta.url));
const source=readFileSync(resolve(here,'../../js/tactical-action-controller.js'),'utf8')
  .replace(/^import \{AreaSpellMechanics\} from [^\n]*\n/, '');
function runtime({caster,others,blockedIds=[],missIds=[]}){
  const units=[caster,...others], tiles=[];
  for(let x=0;x<7;x++)for(let y=0;y<7;y++)tiles.push({x,y,terrain:'PLAIN',elevation:0});
  const map={tiles,objects:[]},result={animations:[],hits:[],outcomes:[],statuses:[],damageKinds:[],logs:[],modes:[],spent:[],auto:0,rendered:0,changed:0};
  const anim={emitAction:(a,t,s)=>result.animations.push(s.id),emitResolvedHit:(t,opt)=>result.hits.push({id:t.id,...opt}),emitOutcome:(t,kind)=>result.outcomes.push({id:t.id,kind}),emitHit:()=>{},emitPresentation:()=>{}};
  const env={effectAt:()=>[],EFFECT:{BURNING:'BURNING'}};
  const effects={breakStealth:()=>{},interruptChannel:()=>{},
    applyDamage:(target,amount,{source,damageType='PHYSICAL'}={})=>{
      result.damageKinds.push({id:target.id,damageType});
      const hp=target.hp;
      if(!blockedIds.includes(target.id))target.hp=Math.max(0,hp-Math.round(amount));
      return {hpLoss:hp-target.hp,absorbed:blockedIds.includes(target.id)?amount:0};
    },
    apply:({source,target,effect})=>{
      assert.equal(effect.id,'BLEEDING');
      target.effects=target.effects.filter(e=>e.id!==effect.id);
      target.effects.push({...effect,sourceUnitId:source.id,remaining:effect.duration});
      result.statuses.push(target.id);return{applied:true};
    },
    bloodBurstCenters:(source,roster)=>roster.filter(u=>u.team!==source.team&&u.alive&&u.effects.some(e=>e.id==='BLEEDING'))};
  const sandbox={EffectEngine:effects,UnitAnimationEngine:anim,EnvironmentEngine:env,AngelWingBarrierEngine:{TYPE:"HOLY_WING_BARRIER",blocksIncoming:()=>false},
    UnitRuntimeEngine:{beginBloodTransaction:()=>{},endBloodTransaction:()=>{},
      attackEnhancement:()=>1,onRageForcedLanding:()=>{}},
    TacticalEngine:{tile:(m,x,y)=>m.tiles.find(t=>t.x===x&&t.y===y),faceToward:()=>{},hasLineOfSight:()=>true},
    BattleEngine:{calculate:(_a,b,s)=>({hit:!missIds.includes(b.name),damage:25,type:s.attackType==='MAGIC'?'MAGIC':'PHYSICAL',crit:false,el:s.element})},
    BattleResolution:{splitActualHpLoss:(roll,hp)=>({physical:roll.type==='MAGIC'?0:hp,magic:roll.type==='MAGIC'?hp:0})},
    Math,Set,Map,Array,Number,Object,String,console};
  sandbox.globalThis=sandbox;
  vm.runInNewContext(source,sandbox,{filename:'tactical-action-controller.js'});
  const context={TEAM:{PLAYER:'P',ENEMY:'E'},actionState:()=>({map,units,round:1,environmentState:{}}),
    canUseSkill:()=>true,effectiveSkill:(_u,skill)=>skill,consumeSkill:(actor,skill)=>{
      const manaCost=Number(skill.manaCost||0),bloodCost=Number(skill.resourceCosts?.blood||0);
      if(actor.mana<manaCost||Number(actor.resources?.blood?.value||0)<bloodCost)return null;
      actor.mana-=manaCost;if(bloodCost)actor.resources.blood.value-=bloodCost;
      result.spent.push({skillId:skill.id,mana:manaCost,blood:bloodCost});return{cost:manaCost};
    },
    unitAt:(x,y)=>units.find(u=>u.alive&&u.occupiesTile!==false&&u.x===x&&u.y===y)||null,
    aoeTiles:(center,radius)=>tiles.filter(t=>Math.abs(t.x-center.x)+Math.abs(t.y-center.y)<=radius),
    checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>{result.auto++;return false;},
    setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:m=>result.modes.push(m),render:()=>result.rendered++,
    handleDefeated:u=>{u.alive=false;},pushLog:msg=>result.logs.push(msg),resolveEnvironmentEvents:()=>{},logEnvironmentEvent:()=>{},
    applyEnvironmentHazardToUnit:()=>{},coreAt:()=>null};
  return{controller:sandbox.TacticalActionController.create(context),result,units,map};
}
function unit(id,team,x,y,hp=100){return{id,team,x,y,alive:true,hp,mana:100,occupiesTile:true,moved:false,acted:false,waited:false,effects:[],resources:{blood:{value:100}},character:{name:id,combat:{hp,atk:100,matk:90,def:40,mdef:35},weapons:{claw:{},rapier:{}}}};}

test('豹揮擊按一次：中心周圍八格各自扣血，友軍不受傷，流血僅在 HP 損失後，動作收尾',()=>{
  const actor=unit('豹','P',3,3),enemies=[unit('N','E',3,2),unit('NE','E',4,2),unit('W','E',2,3),unit('SE','E',4,4),unit('OUT','E',5,3)],ally=unit('ALLY','P',3,4);
  const {controller,result}=runtime({caster:actor,others:[...enemies,ally],blockedIds:['SE'],missIds:['W']});
  assert.equal(controller.prepareAttack(actor,actor,SKILLS.avreshi_swipe),true);
  assert.equal(actor.acted,true);assert.equal(actor.moved,true);assert.equal(actor.waited,true);
  assert.equal(result.auto,1);assert.equal(result.rendered,1);assert.equal(result.modes.at(-1),'inspect');
  assert.deepEqual([...result.statuses].sort(),['N','NE']);
  assert.equal(enemies[4].hp,100);assert.equal(ally.hp,100);assert.equal(actor.hp,100);
  assert.equal(enemies[0].hp,75);assert.equal(enemies[1].hp,75);
  assert.equal(enemies[2].hp,100);assert.equal(enemies[3].hp,100);
  assert.deepEqual(result.spent,[{skillId:'avreshi_swipe',mana:18,blood:0}]);
  assert.equal(result.animations[0],'avreshi_swipe');
});

test('血爆：消耗血能不消耗 MP，實際傷害走暗屬性 MAGIC，流血保留且結束行動',()=>{
  const actor=unit('瑟拉菲娜','P',3,3),bleeding=unit('BLEED','E',3,2),normal=unit('NEAR','E',4,2);
  bleeding.effects.push({id:'BLEEDING',type:'DAMAGE_OVER_TIME',remaining:3});
  const {controller,result}=runtime({caster:actor,others:[bleeding,normal]});
  assert.equal(SKILLS.seraphina_blood_burst.manaCost,0);
  assert.equal(SKILLS.seraphina_blood_burst.resourceCosts.blood,22);
  assert.equal(SKILLS.seraphina_blood_burst.attackType,'MAGIC');
  assert.doesNotThrow(()=>controller.prepareAttack(actor,actor,SKILLS.seraphina_blood_burst));
  assert.equal(actor.mana,100);assert.equal(actor.resources.blood.value,78);
  assert.equal(actor.acted,true);assert.equal(actor.waited,true);assert.equal(result.auto,1);
  assert.ok(result.damageKinds.length>0);
  assert.ok(result.damageKinds.every(x=>x.damageType==='MAGIC'));
  assert.ok(result.hits.every(x=>x.components.physical===0&&x.components.magic>0));
  assert.ok(bleeding.effects.some(e=>e.id==='BLEEDING'));
  assert.deepEqual(result.spent,[{skillId:'seraphina_blood_burst',mana:0,blood:22}]);
});

test('揮擊擊倒敵人也會正確完成動作，下一名友軍仍可行動，不殘留瞄準／取消施放',()=>{
  const actor=unit('豹','P',3,3),victim=unit('WEAK','E',3,2,15),other=unit('ALLY','P',6,6);
  const {controller,result}=runtime({caster:actor,others:[victim,other]});
  assert.equal(controller.prepareAttack(actor,actor,SKILLS.avreshi_swipe),true);
  assert.equal(victim.alive,false);
  assert.equal(actor.acted,true);
  assert.equal(other.acted,false);
  assert.equal(result.modes.at(-1),'inspect');
  assert.equal(result.auto,1);
});
