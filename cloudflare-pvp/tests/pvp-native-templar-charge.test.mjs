import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection} from '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {isCanonicalChargeVariant,canonicalChargeOptions} from '../src/pvp-headless-charge.mjs';
import {PvpTacticalUI} from '../../js/pvp-tactical-ui.js';

const base=SkillDatabase.get('templar_charge'),assault=SkillDatabase.resolveVariant(base,'CHARGE_ASSAULT'),rescue=SkillDatabase.resolveVariant(base,'CHARGE_RESCUE');
const deck=Array(20).fill('imperial_archer_card');
function game(){
 let g=createOpeningGame({decks:[deck,deck],serverSeed:11883});
 for(const seat of [0,1])g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat}).state;
 beginCanonicalPlayerCardPhase(g);
 withCanonicalEngines(g,engine=>{
  for(const [id,team,characterId] of [['templar','P','church_templar_hero'],['target','E','imperial_archer'],['ally','P','imperial_archer']]){
   const u=engine.unitRuntime.create({id,team,characterId,x:1,y:1,map:g.battlefield.map,cores:g.battlefield.cores});
   assert.ok(u);delete u._runtimeMap;g.units.push(u);
  }
 });
 return g;
}
function findScenario(rescueMode=false){
 const g=game(),actor=g.units[0],target=g.units[rescueMode?2:1],skill=rescueMode?rescue:assault;
 // Deterministic seeded map, original TacticalEngine and original
 // approachForSkill select actual legal paths: no invented displacement values.
 const tiles=g.battlefield.map.tiles.filter(t=>globalThis.TERRAINS?.[t.terrain]?.passable);
 const other=g.units[rescueMode?1:2];other.alive=false;
 for(const a of tiles){
  actor.x=a.x;actor.y=a.y;
  for(const b of tiles){
   if(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)<2||Math.abs(a.x-b.x)+Math.abs(a.y-b.y)>4)continue;
   target.x=b.x;target.y=b.y;
   if(!TacticalEngine.canTarget(g.battlefield.map,actor,target,skill,g.environmentState))continue;
   const attempt=structuredClone(g);
   const a2=attempt.units[0],t2=attempt.units[rescueMode?2:1];
   // Set up the same tactical phase, and let the authority decide path legality.
   resolveCanonicalPlayerCommand(attempt,{type:'END_CARD_PHASE'},0);
   try{
    const result=resolveCanonicalPlayerCommand(attempt,{type:'CAST_CHARGE',unitId:a2.id,
     targetId:t2.id,skillId:base.id,variantId:skill.variantId},0);
    if(!result.accepted)continue;
    actor.z=TacticalEngine.elevation(a);target.z=TacticalEngine.elevation(b);
    resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
    return {g,actor,target,skill};
   }catch{}
  }
 }
 throw new Error('No original legal charge geometry found');
}
const cast=(actor,target,variantId)=>({type:'CAST_CHARGE',unitId:actor.id,targetId:target.id,skillId:base.id,variantId});
test('the two authored charge variants are recognized by official structural abilities, not hero ID guesses',()=>{
 assert.equal(isCanonicalChargeVariant(base,assault),true);assert.equal(isCanonicalChargeVariant(base,rescue),true);
 for(const bad of [{...rescue,effects:[{type:'HP_LINK',duration:0}]},{...assault,postEffects:[{type:'UNKNOWN'}]},
  {...assault,utilityAction:{type:'UNKNOWN'}}])assert.equal(isCanonicalChargeVariant(base,bad),false);
 const {g,actor}=findScenario();
 const own=tacticalDebugProjection(g,0).units.find(u=>u.id===actor.id);
 assert.ok(own.chargeOptions.some(s=>s.variantId===assault.variantId));
 assert.ok(own.chargeOptions.some(s=>s.variantId===rescue.variantId));
 assert.equal(tacticalDebugProjection(g,1).units.find(u=>u.id===actor.id)?.chargeOptions,undefined);
});
test('assault relocates through the canonical movement path then lets defender react before consuming MP and resolving knockback',()=>{
 const {g,actor,target}=findScenario();const before={x:actor.x,y:actor.y,mana:actor.mana};
 const pending=resolveCanonicalPlayerCommand(g,cast(actor,target,assault.variantId),0);
 assert.equal(pending.accepted,true);assert.equal(pending.reactionPending,true);
 assert.equal(g.phase,'PVP_REACTION_PENDING');assert.equal(g.activeSeat,1);
 assert.equal(g.pendingAttack.kind,'CHARGE');
 assert.equal(actor.mana,before.mana);
 assert.equal(Math.abs(actor.x-target.x)+Math.abs(actor.y-target.y),1);
 assert.ok(actor.x!==before.x||actor.y!==before.y);
 const r=resolveCanonicalPlayerCommand(g,{type:'REACT_ATTACK',reaction:'ACCEPT'},1);
 assert.equal(r.accepted,true);assert.equal(g.activeSeat,0);
 assert.equal(actor.mana,before.mana-base.manaCost);
 assert.equal(actor.acted,true);assert.equal(actor.waited,true);
 assert.equal(g.pendingAttack,null);
 assert.doesNotThrow(()=>structuredClone(g));
});
test('rescue moves to an ally then installs the same original 2-turn HP_LINK buff',()=>{
 const {g,actor,target}=findScenario(true),before={mana:actor.mana,x:actor.x,y:actor.y};
 const r=resolveCanonicalPlayerCommand(g,cast(actor,target,rescue.variantId),0);
 assert.equal(r.accepted,true);
 assert.equal(actor.mana,before.mana-base.manaCost);
 assert.equal(Math.abs(actor.x-target.x)+Math.abs(actor.y-target.y),1);
 assert.equal(actor.acted,true);assert.equal(actor.waited,true);
 assert.ok((target.effects||[]).some(e=>e.type==='HP_LINK'&&e.sourceUnitId===actor.id&&e.duration===2),
  'target gets original two-turn HP_LINK, not a separate shield');
 assert.doesNotThrow(()=>structuredClone(g));
});
test('forged variant and client-supplied displacement, damage or mana are rejected',()=>{
 const {g,actor,target}=findScenario();const initial=structuredClone(g);
 for(const action of [
  {...cast(actor,target,assault.variantId),damage:999},
  {...cast(actor,target,assault.variantId),x:target.x,y:target.y},
  {...cast(actor,target,'NOT_A_VARIANT')},
  {...cast(actor,target,rescue.variantId)}
 ])assert.throws(()=>resolveCanonicalPlayerCommand(g,action,0));
 assert.deepEqual(g,initial);
});
test('native map selection sends only the variant ID + unit target, never client-computed path or impact',()=>{
 const ui=Object.create(PvpTacticalUI.prototype),sent=[];
 ui.seat=0;ui.mode='CAST_CHARGE';ui.target={unitId:'templar',skillId:base.id,variantId:assault.variantId,chargeTarget:'ENEMY'};
 ui.match={view:{seat:0,phase:'PLAYER_TACTICAL_PHASE',activeSeat:0,units:[
  {id:'templar',team:'P',x:0,y:2,alive:true},{id:'foe',team:'E',x:3,y:2,alive:true}],battlefield:{cores:[]}}};
 ui.isConnected=()=>true;ui.request=a=>{sent.push(a);return true};ui.update=()=>{};
 assert.equal(ui.tilePicked({seat:0,x:3,y:2}),true);
 assert.deepEqual(sent,[{type:'CAST_CHARGE',unitId:'templar',skillId:base.id,
  variantId:assault.variantId,targetId:'foe'}]);
});
