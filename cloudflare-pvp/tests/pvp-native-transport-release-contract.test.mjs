import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection} from '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {canonicalTransportOptions,isCanonicalTransportSkill} from '../src/pvp-headless-transport.mjs';
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {PvpTacticalUI} from '../../js/pvp-tactical-ui.js';

const deck=Array(20).fill('imperial_archer_card');
function opening(seed=1144){
 let game=createOpeningGame({decks:[deck,deck],serverSeed:seed});
 for(const seat of [0,1])game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat}).state;
 beginCanonicalPlayerCardPhase(game);
 return game;
}
function findTransportGame(skillId,seat=0){
 const skill=SkillDatabase.get(skillId);
 assert.equal(isCanonicalTransportSkill(skill),true);
 const release=SkillDatabase.get(skill.utilityAction.releaseSkillId);
 assert.ok(release);
 const game=opening();
 const map=game.battlefield.map;
 let result=null;
 withCanonicalEngines(game,engine=>{
  const actor=engine.unitRuntime.create({id:'angel',team:'P',characterId:'angel_archer_hero',x:1,y:1,map,cores:game.battlefield.cores});
  const passenger=engine.unitRuntime.create({id:'passenger',team:skill.target==='ALLY'?'P':'E',characterId:'imperial_archer',x:1,y:2,map,cores:game.battlefield.cores});
  assert.ok(actor&&passenger);delete actor._runtimeMap;delete passenger._runtimeMap;
  game.units.push(actor,passenger);
  for(const tile of map.tiles){
   if(!globalThis.TERRAINS?.[tile.terrain]?.passable||map.objects?.some(o=>o.blocksMovement&&o.x===tile.x&&o.y===tile.y))continue;
   const adjoining=[[1,0],[-1,0],[0,1],[0,-1]]
     .map(([dx,dy])=>TacticalEngine.tile(map,tile.x+dx,tile.y+dy))
     .filter(t=>t&&globalThis.TERRAINS?.[t.terrain]?.passable&&!map.objects?.some(o=>o.blocksMovement&&o.x===t.x&&o.y===t.y));
   for(const neighbor of adjoining){
    actor.x=tile.x;actor.y=tile.y;actor.z=TacticalEngine.elevation(tile);
    passenger.x=neighbor.x;passenger.y=neighbor.y;passenger.z=TacticalEngine.elevation(neighbor);
    actor.moved=false;actor.acted=false;actor.waited=false;
    const options=canonicalTransportOptions(game,actor,engine);
    if(!options.some(s=>s.skillId===skillId&&s.targetId===passenger.id))continue;
    let selectedSkill=null;
    const controller=globalThis.TacticalActionController.create({
     TEAM:{PLAYER:actor.team,ENEMY:'E'},
     actionState:()=>({map,units:game.units,environmentState:game.environmentState}),
     combatTargets:()=>game.units.filter(u=>u.alive),
     canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
     consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
     effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
     targetType:s=>s.targetType||'SINGLE',
     unitAt:(x,y)=>game.units.find(u=>u.alive&&u.x===x&&u.y===y),
     setSelectedSkill:s=>{selectedSkill=s},setSelectedSkillVariant:()=>{},setMode:()=>{},render:()=>{},pushLog:()=>{},checkMatchEnd:()=>false
    });
    controller.prepareAttack(actor,passenger,skill);
    if(selectedSkill?.id!==release.id)continue;
    const tiles=controller.mapTargetTiles(actor,release);
    if(tiles.length){result={game,actor,passenger,skill,release,dest:tiles[0]};break;}
   }
   if(result)break;
  }
 });
 assert.ok(result,`Could not find legal official transport pickup + release for ${skillId}`);
 resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
 return result;
}

for(const [id,releaseId] of [['angel_lift_drop','angel_drop_enemy'],['angel_carry_ally','angel_release_ally']]){
 test(`original ${releaseId} release stage can be executed as one authoritative pickup+release command`,()=>{
  const {game,actor,passenger,skill,release,dest}=findTransportGame(id);
  const before={mana:actor.mana,x:passenger.x,y:passenger.y,hp:passenger.hp};
  assert.equal(skill.utilityAction.releaseSkillId,releaseId);
  assert.equal(release.utilityAction.type,'RELEASE_CARRIED');
  const projection=tacticalDebugProjection(game,0);
  assert.ok(projection.units.find(u=>u.id===actor.id).transportOptions.some(s=>s.skillId===id&&s.targetId===passenger.id));
  const response=resolveCanonicalPlayerCommand(game,{type:'CAST_TRANSPORT',unitId:actor.id,skillId:id,targetId:passenger.id,x:dest.x,y:dest.y},0);
  assert.equal(response.accepted,true);
  assert.equal(actor.acted,true);assert.equal(actor.waited,true);
  assert.equal(actor.mana,before.mana-(skill.manaCost||0));
  assert.deepEqual({x:passenger.x,y:passenger.y},{x:dest.x,y:dest.y});
  assert.equal(passenger.carriedByUnitId,undefined);
  assert.equal(actor.carryingUnitId,undefined);
  assert.equal(passenger.transportHidden,undefined);
  if(id==='angel_carry_ally')assert.equal(passenger.hp,before.hp,'ally is released safely');
  else assert.ok(passenger.hp<=before.hp,'enemy receives only original fall outcome');
  assert.doesNotThrow(()=>structuredClone(game));
 });
 test(`forged release/position/MP cannot bypass ${releaseId} original pickup command`,()=>{
  const {game,actor,passenger,release,dest}=findTransportGame(id);
  const before=structuredClone(game);
  for(const bad of [
    {type:'CAST_TRANSPORT',unitId:actor.id,skillId:releaseId,targetId:passenger.id,x:dest.x,y:dest.y},
    {type:'CAST_TRANSPORT',unitId:actor.id,skillId:id,targetId:passenger.id,x:dest.x,y:dest.y,damage:999},
    {type:'CAST_TRANSPORT',unitId:actor.id,skillId:id,targetId:passenger.id,x:999,y:999},
  ])assert.throws(()=>resolveCanonicalPlayerCommand(game,bad,0));
  assert.deepEqual(game,before);
 });
}

test('PvP original selection keeps pickup and the release tile in one server command',()=>{
 const ui=Object.create(PvpTacticalUI.prototype),actions=[];
 ui.seat=0;ui.mode='CAST_TRANSPORT';ui.target={unitId:'angel',skillId:'angel_carry_ally',targetId:'passenger'};
 ui.match={view:{seat:0,phase:'PLAYER_TACTICAL_PHASE',activeSeat:0,units:[],battlefield:{cores:[]}}};
 ui.isConnected=()=>true;ui.request=a=>{actions.push(a);return true};ui.update=()=>{};
 assert.equal(ui.tilePicked({seat:0,x:2,y:2}),true);
 assert.deepEqual(actions,[{type:'CAST_TRANSPORT',unitId:'angel',skillId:'angel_carry_ally',targetId:'passenger',x:2,y:2}]);
});
