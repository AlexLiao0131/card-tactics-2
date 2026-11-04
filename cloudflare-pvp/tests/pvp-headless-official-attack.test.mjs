import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpeningGame,openingGameCore } from '../src/pvp-match-core.mjs';
import { beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand } from '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import '../../js/tactical-action-controller.js';

const deck=Array(20).fill('imperial_swordsman_card');
function prepare(seed){
  let game=createOpeningGame({decks:[deck,deck],serverSeed:seed});
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
  beginCanonicalPlayerCardPhase(game);
  const own=game.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
  resolveCanonicalPlayerCommand(game,{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',...own},0);
  resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
  resolveCanonicalPlayerCommand(game,{type:'END_TACTICAL_PHASE'},0);
  const enemy=game.battlefield.deploymentPoints.find(p=>p.owner==='ENEMY').area[0];
  resolveCanonicalPlayerCommand(game,{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',...enemy},1);
  resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},1);
  const [actor,target]=game.units;
  for(const unit of game.units){unit.moved=false;unit.acted=false;unit.waited=false;}
  const skill=SkillDatabase.get('slash');
  const legal=game.battlefield.map.tiles.find(tile=>{
    const right=TacticalEngine.tile(game.battlefield.map,tile.x+1,tile.y);
    if(!right||!globalThis.TERRAINS[tile.terrain]?.passable||
       !globalThis.TERRAINS[right.terrain]?.passable)return false;
    actor.x=tile.x;actor.y=tile.y;target.x=right.x;target.y=right.y;
    return TacticalEngine.canTarget(game.battlefield.map,actor,target,skill,game.environmentState);
  });
  assert.ok(legal,'a legitimate adjacent attack cell exists');
  return {game,actor,target,skill};
}
function resolve(seed,reaction=null){
  const {game,actor,target,skill}=prepare(seed),before=target.hp;
  const result=withCanonicalEngines(game,engine=>{
    const actions=[];
    const ctx={TEAM:{PLAYER:'P',ENEMY:'E'},
      actionState:()=>({map:game.battlefield.map,environmentState:game.environmentState,units:game.units}),
      canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
      consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
      handleDefeated:(u)=>{u.alive=false;},
      logBattleAction:e=>actions.push({damage:e.result.damage,hit:e.result.hit,crit:e.result.crit,
        evadeOutcome:e.result.evadeOutcome??null,evadeRoll:e.result.evadeRoll??null}),
      logPostEffect:()=>{throw Error('Unexpected slash post-effect');},
      clearEngagement:()=>{},checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,
      setSelectedSkill:()=>{},setMode:()=>{},render:()=>{},pushLog:()=>{},
      getPendingEngagement:()=>null,setPendingEngagement:()=>{}};
    const controller=globalThis.TacticalActionController.create(ctx);
    controller.executeEngagement(actor,target,skill,[],reaction);
    return actions;
  });
  return {results:result,after:target.hp,before,actorActed:actor.acted,randomState:game.randomState};
}
test('unmodified official TacticalActionController executes legal physical engagement headlessly',()=>{
 const r=resolve(1555);
 assert.equal(r.results.length,1);
 assert.equal(r.actorActed,true);
 assert.equal(r.after<=r.before,true);
 assert.ok(r.results[0].damage>=0);
});
test('per-room random stream produces the same official hit, crit, HP and state for identical matches',()=>{
 const a=resolve(1234),b=resolve(1234);
 assert.deepEqual(a,b);
});
test('independently seeded matches do not contaminate each other',()=>{
 const same1=resolve(777),other=resolve(888),same2=resolve(777);
 assert.deepEqual(same1,same2);
 assert.ok(Number.isSafeInteger(other.randomState));
});

test('official defender EVADE reaction is accepted by the same full BattleResolution queue',()=>{
 const a=resolve(1555),b=resolve(1555,{type:'EVADE'}),again=resolve(1555,{type:'EVADE'});
 assert.deepEqual(b,again);
 assert.equal(b.results.length,1);
 assert.equal(b.results[0].hit===true||b.results[0].hit===false,true);
 assert.ok(Number.isSafeInteger(b.randomState));
 // Reaction adds a separate dodge roll, not a peer-supplied hit/damage.
 assert.ok(b.results[0].damage>=0);
 assert.ok(['MISS','GRAZE','HIT'].includes(b.results[0].evadeOutcome));
 assert.equal(a.results[0].evadeOutcome,null);
});
