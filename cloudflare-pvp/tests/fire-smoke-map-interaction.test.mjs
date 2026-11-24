import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeCanonicalWorld} from '../src/pvp-canonical-setup.mjs';
import {UnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import {SkillDatabase} from '../../js/skill-database.js';
import {EnvironmentEngine} from '../../js/environment-engine.js';
import {EffectEngine} from '../../js/effect-engine.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {castCanonicalEnvironmentContact} from '../src/pvp-headless-environment-contact.mjs';
import {castCanonicalMapSkill} from '../src/pvp-headless-map-skills.mjs';
import {HighlightRenderer} from '../../js/highlight-renderer.js';
import {PvpTacticalUI} from '../../js/pvp-tactical-ui.js';
import '../../js/tactical-action-controller.js';
const deck=Array(20).fill('imperial_swordsman_card');
const water=SkillDatabase.get('nereia_water_bullet'),wave=SkillDatabase.get('nereia_tsunami');
function fixture(){
 const game=initializeCanonicalWorld({seed:1234,mapSize:'SMALL',decks:[deck,deck]});
 game.phase='PLAYER_TACTICAL_PHASE';game.activeSeat=0;game.round=1;
 const map=game.battlefield.map;map.objects=[];
 for(const t of map.tiles){Object.assign(t,{terrain:'PLAIN',elevation:0,waterDepth:0,waterSurfaceZ:null});}
 game.environmentState=EnvironmentEngine.create({timeOfDay:'DAY',weather:'CLEAR'});
 const env=game.environmentState;
 const q=UnitRuntimeEngine.create({id:'queen',team:'P',characterId:'nereia',loadoutId:'nereia_default',x:2,y:3,map});
 const enemy=UnitRuntimeEngine.create({id:'enemy',team:'E',characterId:'imperial_swordsman',x:6,y:3,map});
 q.moved=true;q.acted=false;q.waited=false;game.units=[q,enemy];
 const fire=TacticalEngine.tile(map,6,3);fire.terrain='FOREST';
 for(let x=3;x<=6;x++){
   const t=TacticalEngine.tile(map,x,3);t.terrain='FOREST';
   EnvironmentEngine.apply({map,state:env,x,y:3,forces:['HEAVY_FIRE']});
 }
 const logs=[];const hooks={pushLog:m=>logs.push(m),stageEvent:()=>{},handleDefeated:()=>{},damageUnitFlat:()=>{},random:()=>.5};
 const engine={unitRuntime:UnitRuntimeEngine,effect:EffectEngine,random:()=>.5};
 const controller=globalThis.TacticalActionController.create({actionState:()=>({map,units:game.units,environmentState:env}),
  TEAM:{PLAYER:'P',ENEMY:'E'},unitAt:(x,y)=>game.units.find(u=>u.alive&&u.x===x&&u.y===y),coreAt:()=>null});
 return {game,map,env,q,enemy,fire,controller,engine,hooks,logs};
}
test('real forest fire remains optically opaque but is independently targetable, without revealing its occupant',()=>{
 const {map,env,q,enemy,fire,controller,game}=fixture();
 assert.equal(EnvironmentEngine.visionModifier(env,4,3).blocked,true);
 assert.equal(TacticalEngine.canSee(map,q,enemy,env),false);
 assert.equal(TacticalEngine.canTarget(map,q,enemy,water,env),false);
 assert.ok(TacticalEngine.canObserveFireSource(map,q,fire,env));
 assert.ok(controller.environmentTargetTiles(q,water).includes(fire));
 const before=controller.environmentTargetTiles(q,water).map(t=>`${t.x},${t.y}`);
 game.units=[q];
 assert.deepEqual(controller.environmentTargetTiles(q,water).map(t=>`${t.x},${t.y}`),before);
 assert.ok(EnvironmentEngine.lightSources(env).some(l=>l.x===6&&l.y===3));
});
test('fire source cannot be targeted through solid wall or outside skill range',()=>{
 const {map,env,q,fire,controller}=fixture();
 const wall=TacticalEngine.tile(map,4,3);wall.terrain='WALL';
 assert.equal(TacticalEngine.canObserveFireSource(map,q,fire,env),false);
 assert.ok(!controller.environmentTargetTiles(q,water).includes(fire));
 wall.terrain='PLAIN';q.x=0;
 assert.ok(!controller.environmentTargetTiles(q,water).includes(fire));
});
test('Worker environment contact casts through smoke with real resource cost and water-fire exchange',()=>{
 const {game,map,env,q,enemy,fire,engine,hooks,logs}=fixture();
 const before=q.mana, hp=enemy.hp, cost=UnitRuntimeEngine.skillManaCost(q,water);
 const result=castCanonicalEnvironmentContact(game,{type:'CAST_ENVIRONMENT_CONTACT',unitId:q.id,skillId:water.id,x:fire.x,y:fire.y},0,engine,hooks,()=>false);
 assert.equal(result.accepted,true);assert.equal(q.mana,before-cost);assert.equal(q.acted,true);
 assert.equal(enemy.hp,hp,'ground contact does not directly damage hidden enemy');
 assert.ok(logs.some(l=>l.includes('澆向燃燒格')));
 assert.ok(EnvironmentEngine.effectAt(env,fire.x,fire.y).some(e=>e.type==='STEAM'||e.type==='BURNING'));
});
test('Worker tsunami accepts smoke-obscured direction and sweeps real water; preserves range and wall geometry',()=>{
 const {game,map,env,q,fire,controller,engine,hooks,logs}=fixture();
 assert.equal(TacticalEngine.canSee(map,q,fire,env),false);
 assert.ok(controller.mapTargetTiles(q,wave).includes(fire));
 assert.ok(!controller.mapTargetTiles(q,wave).some(t=>t.x===9&&t.y===3));
 const initial=map.tiles.reduce((s,t)=>s+Number(t.waterDepth||0),0),before=q.mana,cost=UnitRuntimeEngine.skillManaCost(q,wave);
 const result=castCanonicalMapSkill(game,{type:'CAST_MAP_SKILL',unitId:q.id,skillId:wave.id,x:fire.x,y:fire.y},0,engine,hooks,()=>false);
 assert.equal(result.accepted,true);assert.equal(q.mana,before-cost);assert.equal(q.acted,true);
 assert.ok(map.tiles.reduce((s,t)=>s+Number(t.waterDepth||0),0)>initial);
 assert.ok(logs.some(l=>l.includes('施放海嘯')));
});
test('dynamic overlays render after smoke without clearing opaque depth; deployment overlays stay in group zero',()=>{
 const r=Object.create(HighlightRenderer.prototype);r.scene={};r.terrain={};r.environment={publishedCoverGeometry:()=>[]};
 r.dynamic=new Map();r.areas=new Map();r.materials={PLAYER:{},attackable:{}};r.signature=()=>1;r.indicatorGeometry=()=>({});r.syncMesh=()=>({});
 r.sync({map:{tiles:[{x:1,y:1,attackable:true,deploymentAreaOwner:'PLAYER'}]}});
 assert.equal(r.dynamic.get('attackable').renderingGroupId,1);assert.equal(r.areas.get('PLAYER').renderingGroupId,undefined);
});
test('PvP input falls back to certified environment contact when visible unit is not a legal attack',()=>{
 const ui=Object.create(PvpTacticalUI.prototype),sent=[];
 ui.seat=0;ui.mode='DECLARE_ATTACK';ui.target={unitId:'q',skillId:water.id};
 ui.match={view:{seat:0,phase:'PLAYER_TACTICAL_PHASE',activeSeat:0,units:[
 {id:'q',team:'P',alive:true,x:2,y:3,environmentContactSkillIds:[water.id],aimOptions:[{type:'DECLARE_ATTACK',skillId:water.id,actionableTiles:[]},{type:'CAST_ENVIRONMENT_CONTACT',skillId:water.id,actionableTiles:[{x:6,y:3}]}]},
 {id:'e',team:'E',alive:true,x:6,y:3}],battlefield:{cores:[]}}};
 ui.isConnected=()=>true;ui.request=a=>{sent.push(a);return true};ui.update=()=>{};
 assert.equal(ui.tilePicked({seat:0,x:6,y:3}),true);assert.equal(sent[0].type,'CAST_ENVIRONMENT_CONTACT');
});
