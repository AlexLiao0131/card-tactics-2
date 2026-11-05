import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection} from '../src/pvp-headless-tactical.mjs';
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {isCanonicalLineTransitSkill} from '../src/pvp-headless-map-skills.mjs';
import {PvpTacticalUI} from '../../js/pvp-tactical-ui.js';

const skill=SkillDatabase.get('lion_flash');
function game(){
 const deck=Array(20).fill('imperial_archer_card');
 let g=createOpeningGame({decks:[deck,deck],serverSeed:144});
 for(const seat of [0,1])g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat}).state;
 beginCanonicalPlayerCardPhase(g);
 withCanonicalEngines(g,e=>{
  for(const [id,characterId,team,x,y] of [['hero','leon','P',0,5],['foe','imperial_swordsman','E',2,5]]){
   const u=e.unitRuntime.create({id,team,characterId,x,y,map:g.battlefield.map,cores:g.battlefield.cores});
   assert.ok(u);delete u._runtimeMap;g.units.push(u);
  }
 });
 resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 return g;
}
function officialTiles(g,unit){
 const ctrl=globalThis.TacticalActionController.create({
  actionState:()=>({map:g.battlefield.map,units:g.units,environmentState:g.environmentState}),
  unitAt:(x,y)=>g.units.find(u=>u.alive&&u.occupiesTile!==false&&u.x===x&&u.y===y)||null,
  lineTiles:(u,end)=>TacticalEngine.lineTiles(g.battlefield.map,u,end),
  canTraverseMoveLine:(u,end)=>TacticalEngine.canTraverseMoveLine(g.battlefield.map,u,end)
 });
 return ctrl.mapTargetTiles(unit,skill);
}
test('authoritative lion LINE+transit capability is constrained by the original skill metadata and geometry',()=>{
 assert.equal(isCanonicalLineTransitSkill(skill),true);
 for(const invalid of [{...skill,shape:'CIRCLE'},{...skill,moveToTarget:false},
  {...skill,postEffects:[{type:'KNOCKBACK',distance:9}]},
  {...skill,utilityAction:{type:'UNKNOWN'}},{...skill,areaDamage:{mode:'UNKNOWN'}},
  {...skill,verdictCross:{radius:9}},{...skill,effects:[{type:'UNSUPPORTED'}]}])
   assert.equal(isCanonicalLineTransitSkill(invalid),false);
 const g=game(),a=g.units.find(u=>u.id==='hero');
 const live=officialTiles(g,a);
 assert.ok(live.length>0);
 const projected=tacticalDebugProjection(g,0).units.find(u=>u.id===a.id);
 assert.ok(projected.mapSkills.some(s=>s.id===skill.id&&s.category==='ATTACK'));
 const opponent=tacticalDebugProjection(g,1).units.find(u=>u.id===a.id);
 assert.equal(opponent?.mapSkills,undefined);
});
test('one original LINE attack consumes authored MP, damages crossed enemy and instantly lands without occupying it',()=>{
 const g=game(),a=g.units.find(u=>u.id==='hero'),foe=g.units.find(u=>u.id==='foe');
 const legal=officialTiles(g,a),before={x:a.x,y:a.y,mana:a.mana,hp:foe.hp};
 const dest=legal.find(t=>t.x===foe.x&&t.y===foe.y);
 assert.ok(dest);
 const result=resolveCanonicalPlayerCommand(g,{type:'CAST_MAP_SKILL',unitId:a.id,skillId:skill.id,x:dest.x,y:dest.y},0);
 assert.equal(result.accepted,true);
 assert.equal(before.mana-a.mana,skill.manaCost);
 assert.equal(a.acted,true);assert.equal(a.waited,true);
 assert.ok(a.x!==before.x||a.y!==before.y,'the official line strike lands beyond its starting square');
 assert.doesNotThrow(()=>structuredClone(g));
 assert.ok(g.events.some(e=>String(e.text).includes(skill.name)));
 assert.ok(foe.hp<before.hp,'crossed enemy is struck by the official LINE damage engine');
});
test('illegal diagonal, forged costs, out-of-turn command and unsafe targets fail without a committed match',()=>{
 const g=game(),original=structuredClone(g);
 for(const cmd of [
   {type:'CAST_MAP_SKILL',unitId:'hero',skillId:'lion_flash',x:999,y:999},
   {type:'CAST_MAP_SKILL',unitId:'hero',skillId:'lion_flash',x:2,y:2,damage:999}]){
   assert.throws(()=>resolveCanonicalPlayerCommand(g,cmd,0));assert.deepEqual(g,original);
 }
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_MAP_SKILL',unitId:'hero',skillId:'lion_flash',x:1,y:5},1),{code:'NOT_YOUR_TURN'});
});
test('attack action list uses the same native menu and sends a map command, not a fake unit-only attack',()=>{
 const ui=Object.create(PvpTacticalUI.prototype),calls=[];
 ui.match={view:{seat:0,phase:'PLAYER_TACTICAL_PHASE',activeSeat:0,
   units:[{id:'hero',team:'P',alive:true,x:0,y:5,mapSkills:[{id:'lion_flash',category:'ATTACK',name:skill.name}]}],battlefield:{cores:[]}}};
 ui.seat=0;ui.mode='CAST_MAP_SKILL';ui.target={unitId:'hero',skillId:'lion_flash'};
 ui.isConnected=()=>true;ui.request=action=>{calls.push(action);return true};ui.update=()=>{};
 assert.equal(ui.tilePicked({seat:0,x:2,y:5}),true);
 assert.deepEqual(calls,[{type:'CAST_MAP_SKILL',unitId:'hero',skillId:'lion_flash',x:2,y:5}]);
});
