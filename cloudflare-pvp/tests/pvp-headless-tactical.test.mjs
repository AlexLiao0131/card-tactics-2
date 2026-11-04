import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection} from '../src/pvp-headless-tactical.mjs';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {VerticalMobilityEngine} from '../../js/vertical-mobility-engine.js';
import {CharacterDatabase} from '../../js/character-database.js';

const playerDeck=Array(20).fill('imperial_archer_card');
const enemyDeck=Array(20).fill('imperial_swordsman_card');
function make(){
  let game=createOpeningGame({decks:[playerDeck,enemyDeck],serverSeed:1234});
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
  beginCanonicalPlayerCardPhase(game);
  return game;
}
const pt=g=>g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area;
const deployment=(g,point=pt(g)[0])=>resolveCanonicalPlayerCommand(g,{type:'DEPLOY_CARD',cardId:'imperial_archer_card',x:point.x,y:point.y},0);

test('headless canonical battle START uses original official CardPhaseEngine',()=>{
  const game=make();
  assert.equal(game.activeSeat,0);
  assert.equal(game.phase,'PLAYER_CARD_PHASE');
  assert.equal(game.cards[0].crystals,4);
  assert.equal(game.cards[0].zones.hand.length,5);
  assert.equal(game.round,1);
  assert.doesNotThrow(()=>structuredClone(game));
});
test('player-only authoritative deploy persists unit and card/crystals using original engines',()=>{
  const game=make();deployment(game);
  assert.equal(game.cards[0].crystals,1);
  assert.equal(game.units.length,1);
  assert.equal(game.units[0].team,'P');
  assert.equal(game.units[0].character.id,'imperial_archer');
  assert.equal(game.units[0].acted,true);
  assert.doesNotThrow(()=>structuredClone(game));
});
test('deployment in opponent base and forged tactical commands fail',()=>{
  const game=make();
  const opp=game.battlefield.deploymentPoints.find(p=>p.owner==='ENEMY').area[0];
  assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'DEPLOY_CARD',cardId:'imperial_archer_card',x:opp.x,y:opp.y},0),{code:'ILLEGAL_DEPLOY_TILE'});
  assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'DEPLOY_CARD',cardId:'imperial_archer_card',...pt(game)[0]},1),{code:'NOT_YOUR_TURN'});
  assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'SET_DAMAGE',damage:600},0),{code:'FULL_TACTICAL_ACTION_NOT_CONNECTED'});
  assert.equal(game.units.length,0);
});
test('newly deployed units may not move in same turn, and illegal paths do not change unit location',()=>{
  const game=make();deployment(game);
  const unit=game.units[0],before={x:unit.x,y:unit.y};
  resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
  assert.equal(game.phase,'PLAYER_TACTICAL_PHASE');
  assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'MOVE_UNIT',unitId:unit.id,x:unit.x+1,y:unit.y},0),{code:'UNIT_CANNOT_MOVE'});
  assert.deepEqual({x:unit.x,y:unit.y},before);
  assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'MOVE_UNIT',unitId:unit.id,x:999,y:999},1),{code:'NOT_YOUR_TURN'});
});
test('original TacticalEngine legal movement is processed through actual BattleEnvironmentController',()=>{
  const game=make();deployment(game);
  resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
  const unit=game.units[0];
  // In the next own round, only the official UnitRuntimeEngine resets these flags.
  // This isolated test explicitly exercises legal movement after such reset.
  unit.moved=false;unit.acted=false;unit.waited=false;
  const path=Array.from(TacticalEngine.reachable(game.battlefield.map,game.units,unit).keys());
  const result=path.map(k=>k.split(',').map(Number)).find(([x,y])=>!game.units.some(u=>u.alive&&u.x===x&&u.y===y));
  assert.ok(result,'some legal movement target exists');
  const before={x:unit.x,y:unit.y};
  const outcome=resolveCanonicalPlayerCommand(game,{type:'MOVE_UNIT',unitId:unit.id,x:result[0],y:result[1]},0);
  assert.equal(outcome.accepted,true);
  assert.equal(game.units[0].moved,true);
  assert.notDeepEqual([unit.x,unit.y],[before.x,before.y]);
  assert.doesNotThrow(()=>structuredClone(game));
  assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'MOVE_UNIT',unitId:unit.id,x:result[0],y:result[1]},0),{code:'UNIT_CANNOT_MOVE'});
});
test('seat-filtered headless projection never exposes opponent hand contents',()=>{
  const game=make();const view=tacticalDebugProjection(game,1);
  assert.deepEqual(view.opponent,{handCount:5});
  assert.equal(view.own.hand.length,5);
  assert.equal('hand' in view.opponent,false);
});
test('player tactical end starts opponent original card draw/crystal phase and switches command seat',()=>{
  const game=make();deployment(game);
  resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
  resolveCanonicalPlayerCommand(game,{type:'END_TACTICAL_PHASE'},0);
  assert.equal(game.phase,'ENEMY_CARD_PHASE');assert.equal(game.activeSeat,1);
  assert.equal(game.cards[1].crystals,4);assert.equal(game.cards[1].active,true);
  assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0),{code:'NOT_YOUR_TURN'});
  assert.doesNotThrow(()=>structuredClone(game));
});
test('opponent deployment, reset timing, and new-unit move prohibition follow official unit rules',()=>{
  const game=make();resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
  resolveCanonicalPlayerCommand(game,{type:'END_TACTICAL_PHASE'},0);
  const point=game.battlefield.deploymentPoints.find(p=>p.owner==='ENEMY').area[0];
  const deployment=resolveCanonicalPlayerCommand(game,{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',x:point.x,y:point.y},1);
  assert.equal(deployment.accepted,true);
  resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},1);
  assert.equal(game.phase,'ENEMY_TACTICAL_PHASE');
  assert.equal(game.units[0].moved,true);assert.equal(game.units[0].acted,true);
  assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'MOVE_UNIT',unitId:game.units[0].id,x:point.x+1,y:point.y},1),{code:'UNIT_CANNOT_MOVE'});
  const before=game.round;
  resolveCanonicalPlayerCommand(game,{type:'END_TACTICAL_PHASE'},1);
  assert.equal(game.round,before+1);
  assert.equal(game.phase,'PLAYER_CARD_PHASE');
  assert.equal(game.activeSeat,0);
  assert.equal(game.cards[0].crystalCapacity,5);
  assert.doesNotThrow(()=>structuredClone(game));
});
test('official Core capture engine transfers neutral point and damages enemy Core with stage-defined damage',()=>{
 const game=make();deployment(game);resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
 const soldier=game.units[0];soldier.moved=false;soldier.acted=false;soldier.waited=false;
 const neutral=game.battlefield.deploymentPoints.find(p=>p.owner==='NEUTRAL');
 soldier.x=neutral.captureTiles[0].x;soldier.y=neutral.captureTiles[0].y;
 const core=game.battlefield.cores.find(c=>c.owner==='ENEMY');
 const hp=core.hp;
 const result=resolveCanonicalPlayerCommand(game,{type:'CAPTURE_POINT',unitId:soldier.id},0);
 assert.equal(result.accepted,true);
 assert.equal(neutral.owner,'PLAYER');
 assert.equal(core.hp,hp-120);
 assert.equal(soldier.acted,true);
 assert.doesNotThrow(()=>structuredClone(game));
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'CAPTURE_POINT',unitId:soldier.id},0),{code:'UNIT_CANNOT_CAPTURE'});
});
test('official ObjectiveEngine announces victory only when captured Core HP reaches zero',()=>{
 const game=make();deployment(game);resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
 const soldier=game.units[0];soldier.moved=false;soldier.acted=false;soldier.waited=false;
 const neutral=game.battlefield.deploymentPoints.find(p=>p.owner==='NEUTRAL');
 soldier.x=neutral.captureTiles[0].x;soldier.y=neutral.captureTiles[0].y;
 const core=game.battlefield.cores.find(c=>c.owner==='ENEMY');
 core.hp=120; // Test-only fixture for the final legal capture. No game rule changed.
 resolveCanonicalPlayerCommand(game,{type:'CAPTURE_POINT',unitId:soldier.id},0);
 assert.equal(core.hp,0);
 assert.equal(game.matchResult,'VICTORY');
 assert.equal(game.phase,'MATCH_ENDED');
 assert.equal(game.activeSeat,null);
});


test('two-player full-round transition restores previous soldiers and persists original weather/hydrology',()=>{
 const game=make();deployment(game);
 const first=game.units[0];assert.equal(first.acted,true);
 resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
 resolveCanonicalPlayerCommand(game,{type:'END_TACTICAL_PHASE'},0);
 resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},1);
 const weatherBefore=structuredClone(game.environmentState);
 resolveCanonicalPlayerCommand(game,{type:'END_TACTICAL_PHASE'},1);
 assert.equal(game.round,2);assert.equal(game.phase,'PLAYER_CARD_PHASE');
 assert.equal(game.cards[0].crystalCapacity,5);assert.equal(first.acted,false);
 assert.equal(first.waited,false);assert.equal(first.moved,false);
 assert.notDeepEqual(game.environmentState,weatherBefore,'weather/hydrology actually advanced');
 resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
 const open=Array.from(TacticalEngine.reachable(game.battlefield.map,game.units,first).keys());
 assert.ok(open.length,'surviving soldier has reachable cells next round');
 const [x,y]=open[0].split(',').map(Number);
 const move=resolveCanonicalPlayerCommand(game,{type:'MOVE_UNIT',unitId:first.id,x,y},0);
 assert.equal(move.accepted,true);
 assert.equal(first.moved,true);
});

test('official Core damage route uses TacticalActionController and ObjectiveEngine, not fabricated PvP damage',()=>{
 const game=make();deployment(game);resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
 const attacker=game.units[0],core=game.battlefield.cores.find(c=>c.owner==='ENEMY');
 const target={kind:'CORE',id:`CORE:${core.owner}`,x:core.x,y:core.y,team:'E',alive:true,core};
 const skill=globalThis.SkillDatabase.get('imperial_bow_shot');
 let legal=null;
 for(const t of game.battlefield.map.tiles){
   if(!globalThis.TERRAINS[t.terrain]?.passable || (t.x===core.x&&t.y===core.y))continue;
   attacker.x=t.x;attacker.y=t.y;
   if(TacticalEngine.canTarget(game.battlefield.map,attacker,target,skill,game.environmentState)){
     legal=t;break;
   }
 }
 assert.ok(legal,'official target selection finds legal Core LOS');
 attacker.x=legal.x;attacker.y=legal.y;attacker.z=legal.elevation;
 attacker.moved=false;attacker.acted=false;attacker.waited=false;
 const before=core.hp;
 const result=resolveCanonicalPlayerCommand(game,{type:'ATTACK_CORE',unitId:attacker.id,
   skillId:skill.id,coreOwner:'ENEMY'},0);
 assert.equal(result.accepted,true);
 assert.ok(core.hp<before,'real Core HP changed');
 assert.equal(attacker.acted,true);
 assert.ok(game.events.some(e=>e.type==='BATTLE'&&e.text.includes('CORE HP')));
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'ATTACK_CORE',unitId:attacker.id,
   skillId:skill.id,coreOwner:'ENEMY'},0),{code:'UNIT_CANNOT_ATTACK_CORE'});
});


test('native item menu uses original ItemRuntimeEngine and only owns private seat inventory',()=>{
 const game=make();deployment(game);resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
 const soldier=game.units[0];soldier.acted=false;soldier.waited=false;
 soldier.hp-=50;
 const startingHp=soldier.hp;
 soldier.inventory=[{id:'server_item_1',itemId:'hp_potion_small',owned:false,source:'TEST'}];
 const own=tacticalDebugProjection(game,0).units.find(x=>x.id===soldier.id);
 assert.equal(own.itemChoices.length,1);
 assert.equal(own.itemChoices[0].name,'小型生命藥水');
 assert.equal(own.itemChoices[0].usable,true);
 const opponent=tacticalDebugProjection(game,1).units.find(x=>x.id===soldier.id);
 if(opponent)assert.equal('itemChoices' in opponent,false);
 const used=resolveCanonicalPlayerCommand(game,{type:'USE_BATTLE_ITEM',unitId:soldier.id,payloadId:'server_item_1'},0);
 assert.equal(used.accepted,true);assert.equal(used.itemId,'hp_potion_small');
 assert.ok(soldier.hp>startingHp,'official heal resolves on real HP');
 assert.equal(soldier.inventory.length,0,'consumable removed from authoritative roster');
 assert.equal(soldier.acted,true);
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'USE_BATTLE_ITEM',unitId:soldier.id,payloadId:'server_item_1'},0),{code:'UNIT_CANNOT_USE_ITEM'});
});

test('item authority rejects forged IDs, out-of-turn and unaudited owned local stash',()=>{
 const game=make();deployment(game);resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
 const soldier=game.units[0];soldier.acted=false;soldier.waited=false;
 soldier.inventory=[{id:'owned_item',itemId:'hp_potion_small',owned:true,source:'PREPARATION'}];
 soldier.hp-=35;
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'USE_BATTLE_ITEM',unitId:soldier.id,payloadId:'owned_item'},1),{code:'NOT_YOUR_TURN'});
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'USE_BATTLE_ITEM',unitId:soldier.id,payloadId:'owned_item'},0),{code:'PVP_OWNED_INVENTORY_NOT_CONNECTED'});
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'USE_BATTLE_ITEM',unitId:soldier.id,payloadId:'ghost'},0),{code:'ITEM_NOT_AVAILABLE'});
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'USE_BATTLE_ITEM',unitId:soldier.id,payloadId:'owned_item',quantity:1},0),{code:'INVALID_ITEM_COMMAND'});
});

test('native capture command appears only when the official DeploymentEngine certifies the point',()=>{
 const game=make();deployment(game);resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
 const soldier=game.units[0];
 const before=tacticalDebugProjection(game,0).units.find(unit=>unit.id===soldier.id);
 assert.equal(before.capturePoint,null);
 const point=game.battlefield.deploymentPoints.find(p=>p.owner==='NEUTRAL');
 soldier.x=point.captureTiles[0].x;soldier.y=point.captureTiles[0].y;
 const valid=tacticalDebugProjection(game,0).units.find(unit=>unit.id===soldier.id);
 assert.deepEqual(valid.capturePoint,{id:point.id,name:point.name});
 point.capturable=false;
 assert.equal(tacticalDebugProjection(game,0).units.find(unit=>unit.id===soldier.id).capturePoint,null);
});

test('native-facing turns are settled by official TacticalEngine with seat and input validation',()=>{
 const game=make();deployment(game);resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
 const soldier=game.units[0],original=soldier.facing;
 const expected={facing:original};TacticalEngine.rotateFacing(expected,1);
 soldier.acted=false;soldier.waited=false;
 const result=resolveCanonicalPlayerCommand(game,{type:'ROTATE_UNIT',unitId:soldier.id,steps:1},0);
 assert.equal(result.accepted,true);assert.equal(soldier.facing,expected.facing);
 assert.equal(game.units[0].acted,false,'facing should not invent action consumption');
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'ROTATE_UNIT',unitId:soldier.id,steps:1},1),{code:'NOT_YOUR_TURN'});
 for(const steps of [0,2,-2,1.25])
   assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'ROTATE_UNIT',unitId:soldier.id,steps},0),{code:'INVALID_UNIT_CONTROL_COMMAND'});
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'ROTATE_UNIT',unitId:soldier.id,steps:1,team:'E'},0),{code:'INVALID_UNIT_CONTROL_COMMAND'});
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'ROTATE_UNIT',unitId:'NOT_AN_ACTOR',steps:1},0),{code:'UNIT_CONTROL_UNAVAILABLE'});
 soldier.acted=true;
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'ROTATE_UNIT',unitId:soldier.id,steps:-1},0),{code:'UNIT_CONTROL_UNAVAILABLE'});
});

test('flying altitude uses official VerticalMobilityEngine range, and stays private to owning seat',()=>{
 const game=make();deployment(game);resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
 const angel=game.units[0];angel.character=CharacterDatabase.get('angel_archer_hero');
 angel.acted=false;angel.waited=false;
 const tile=TacticalEngine.tile(game.battlefield.map,angel.x,angel.y);
 const before=VerticalMobilityEngine.syncUnit(angel,tile);
 const range=VerticalMobilityEngine.flightAltitudeRange(angel);
 assert.ok(range&&range.max>range.min,'actual official flying hero');
 const current=VerticalMobilityEngine.describe(angel,tile).flightAltitude;
 const own=tacticalDebugProjection(game,0).units.find(x=>x.id===angel.id);
 assert.ok(own.flightControl);assert.equal(own.flightControl.altitude,current);
 const other=tacticalDebugProjection(game,1).units.find(x=>x.id===angel.id);
 if(other)assert.equal('flightControl' in other,false,'no opponent private control projection');
 const expected=Math.min(range.max,current+range.step);
 const up=resolveCanonicalPlayerCommand(game,{type:'ADJUST_FLIGHT_ALTITUDE',unitId:angel.id,steps:1},0);
 assert.equal(up.accepted,true);assert.equal(up.flightAltitude,expected);
 const down=resolveCanonicalPlayerCommand(game,{type:'ADJUST_FLIGHT_ALTITUDE',unitId:angel.id,steps:-1},0);
 assert.equal(down.flightAltitude,current);
 const standard=game.units[0];standard.character=CharacterDatabase.get('imperial_archer');
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'ADJUST_FLIGHT_ALTITUDE',unitId:standard.id,steps:1},0),{code:'FLIGHT_ALTITUDE_UNAVAILABLE'});
 assert.doesNotThrow(()=>structuredClone(game));
});
