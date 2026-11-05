import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection} from '../src/pvp-headless-tactical.mjs';
import {isCanonicalEnvironmentContactSkill} from '../src/pvp-headless-environment-contact.mjs';
import {isCanonicalDirectAttackSkill} from '../src/pvp-headless-engagement.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {PvpTacticalUI} from '../../js/pvp-tactical-ui.js';

function game(){
 const deck=Array(20).fill('imperial_archer_card');
 const g=createOpeningGame({decks:[deck,deck],serverSeed:2222});
 openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:0});
 openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:1});
 beginCanonicalPlayerCardPhase(g);resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 return g;
}
function spawn(g,id,characterId,team='P',pos={x:0,y:0}){
 return withCanonicalEngines(g,e=>{
  const unit=e.unitRuntime.create({id,team,characterId,x:pos.x,y:pos.y,map:g.battlefield.map});
  assert.ok(unit);const {_runtimeMap,...stored}=unit;
  stored.acted=false;stored.moved=false;stored.waited=false;g.units.push(stored);return stored;
 });
}
test('water-contact contract covers both the official unit projectile and burning environment target',()=>{
 const water=SkillDatabase.get('nereia_water_bullet');
 assert.equal(isCanonicalDirectAttackSkill(water),true);
 assert.equal(isCanonicalEnvironmentContactSkill(water),true);
 assert.equal(isCanonicalEnvironmentContactSkill({...water,waterContact:'UNKNOWN'}),false);
 assert.equal(isCanonicalEnvironmentContactSkill({...water,afterUseEffects:[{type:'DOOM'}]}),false);
 const g=game(),nereia=spawn(g,'water','nereia');
 const menu=tacticalDebugProjection(g,0).units.find(u=>u.id===nereia.id);
 assert.ok(menu.attackSkills.some(s=>s.id===water.id));
 assert.ok(menu.environmentContactSkillIds.includes(water.id));
 assert.equal(tacticalDebugProjection(g,1).units.find(u=>u.id===nereia.id)?.environmentContactSkillIds,undefined);
});

test('burning forest target delivers original water-fire exchange, consumes actual mana and finishes action',()=>{
 const g=game(),origin={x:0,y:0},fire={x:2,y:2};
 assert.equal(TacticalEngine.tile(g.battlefield.map,fire.x,fire.y)?.terrain,'FOREST');
 const unit=spawn(g,'water','nereia','P',origin);
 const created=globalThis.EnvironmentEngine.apply({map:g.battlefield.map,state:g.environmentState,
   x:fire.x,y:fire.y,forces:['FIRE']});
 assert.ok(created.some(e=>e.type==='IGNITE'));
 const before=globalThis.EnvironmentEngine.effectAt(g.environmentState,fire.x,fire.y)
   .find(e=>e.type==='BURNING');
 assert.ok(before);
 const mp=unit.mana;
 const actual=resolveCanonicalPlayerCommand(g,
   {type:'CAST_ENVIRONMENT_CONTACT',unitId:unit.id,skillId:'nereia_water_bullet',x:fire.x,y:fire.y},0);
 assert.equal(actual.accepted,true);
 assert.equal(mp-unit.mana,SkillDatabase.get('nereia_water_bullet').manaCost);
 assert.equal(unit.acted,true);
 const after=globalThis.EnvironmentEngine.effectAt(g.environmentState,fire.x,fire.y)
   .find(e=>e.type==='BURNING');
 assert.ok(after?.thermalWaterReserve < 0.18,
   'original authored 3-turn fire requires multiple water pulses, not instant PvP-only extinguish');
 assert.ok(g.events.some(e=>String(e.text).includes('澆向燃燒格')));
 assert.doesNotThrow(()=>structuredClone(g));
});

test('empty non-burning tile, forged values and opponent commands fail closed',()=>{
 const g=game(),unit=spawn(g,'water','nereia');
 assert.throws(()=>resolveCanonicalPlayerCommand(g,
   {type:'CAST_ENVIRONMENT_CONTACT',unitId:unit.id,skillId:'nereia_water_bullet',x:2,y:2},0),
   {code:'ILLEGAL_ENVIRONMENT_CONTACT'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,
   {type:'CAST_ENVIRONMENT_CONTACT',unitId:unit.id,skillId:'nereia_water_bullet',x:2,y:2,volume:99},0),
   {code:'INVALID_ENVIRONMENT_CONTACT_COMMAND'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,
   {type:'CAST_ENVIRONMENT_CONTACT',unitId:unit.id,skillId:'nereia_water_bullet',x:2,y:2},1),
   {code:'NOT_YOUR_TURN'});
});

test('original PvP target selection sends a terrain contact command only for server-advertised skills',()=>{
 const ui=Object.create(PvpTacticalUI.prototype),sent=[];
 ui.seat=0;ui.mode='DECLARE_ATTACK';
 ui.target={unitId:'water',skillId:'nereia_water_bullet'};
 ui.match={view:{seat:0,phase:'PLAYER_TACTICAL_PHASE',activeSeat:0,
   units:[{id:'water',team:'P',alive:true,x:0,y:0,environmentContactSkillIds:['nereia_water_bullet']}],battlefield:{cores:[]}}};
 ui.isConnected=()=>true;ui.request=action=>{sent.push(action);return true};ui.update=()=>{};
 assert.equal(ui.tilePicked({seat:0,x:2,y:2}),true);
 assert.deepEqual(sent[0],{type:'CAST_ENVIRONMENT_CONTACT',unitId:'water',skillId:'nereia_water_bullet',x:2,y:2});
 ui.mode='DECLARE_ATTACK';ui.target={unitId:'water',skillId:'unknown'};
 assert.equal(ui.tilePicked({seat:0,x:2,y:2}),false);
 assert.equal(sent.length,1);
});
