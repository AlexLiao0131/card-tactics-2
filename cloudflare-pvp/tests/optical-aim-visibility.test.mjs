import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeCanonicalWorld} from '../src/pvp-canonical-setup.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {EnvironmentEngine} from '../../js/environment-engine.js';
import {SkillDatabase} from '../../js/skill-database.js';
import {projectCanonicalAimOptions} from '../src/pvp-headless-aim-projection.mjs';
import {PvpTacticalUI} from '../../js/pvp-tactical-ui.js';
import {BabylonRenderer} from '../../js/babylon-renderer.js';
import '../../js/battle-presentation-controller.js';
import '../../js/tactical-action-controller.js';

const deck=Array(20).fill('imperial_swordsman_card');
function fixture(run,seat=0){
 const game=initializeCanonicalWorld({seed:1234,mapSize:'SMALL',decks:[deck,deck]});
 game.randomState=5;game.round=20;game.activeSeat=seat;
 game.phase=seat===0?'PLAYER_TACTICAL_PHASE':'ENEMY_TACTICAL_PHASE';
 game.stageId=game.battlefield.stageId;
 const map=game.battlefield.map;map.objects=[];game.battlefield.cores=[];game.battlefield.deploymentPoints=[];
 for(const tile of map.tiles)Object.assign(tile,{terrain:'PLAIN',elevation:0,waterDepth:0,waterSurfaceZ:null});
 const env=EnvironmentEngine.create({weather:'CLEAR',timeOfDay:'DAY'});game.environmentState=env;
 game.stage={mode:'VERSUS',intelMode:'DYNAMIC_INTEL',deploymentPoints:[]};
 return withCanonicalEngines(game,engine=>{
  const team=seat===0?'P':'E',enemyTeam=seat===0?'E':'P';
  const spawn=(id,characterId,t,x,y)=>engine.unitRuntime.create({id,characterId,team:t,x,y,map});
  const actor=spawn('queen','nereia',team,5,5),enemy=spawn('enemy','imperial_swordsman',enemyTeam,6,6),scout=spawn('scout','imperial_swordsman',team,6,7);
  actor.moved=true;actor.acted=false;actor.waited=false;game.units=[actor,enemy,scout];
  const world={map,units:game.units,cores:[],stage:game.stage,environmentState:env,round:20,phase:game.phase,mode:'attack',selected:actor,selectedSkill:SkillDatabase.get('nereia_water_bullet'),renderRevision:1};
  const at=(x,y)=>TacticalEngine.occupantAt(world.units,x,y);
  const controller=globalThis.TacticalActionController.create({TEAM:{PLAYER:team,ENEMY:enemyTeam},actionState:()=>world,combatTargets:()=>world.units,targetType:s=>engine.unitRuntime.targetType(s),canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),unitAt:at,coreAt:()=>null});
  const presentation=globalThis.BattlePresentationController.create({TEAM:{PLAYER:'P',ENEMY:'E'},viewerTeam:team,PHASE:{PLAYER:game.phase,CARD:'CARD'},state:()=>world,unitAt:at,coreAt:()=>null,targetType:s=>engine.unitRuntime.targetType(s),targetableEntities:controller.targetableEntities,targetRangeTiles:controller.targetRangeTiles,environmentTargetTiles:controller.environmentTargetTiles,mapTargetTiles:controller.mapTargetTiles});
  const smoke=(x,y)=>{TacticalEngine.tile(map,x,y).terrain='FOREST';EnvironmentEngine.apply({map,state:env,x,y,forces:['HEAVY_FIRE']});assert.equal(EnvironmentEngine.visionModifier(env,x,y).blocked,true);};
  return run({game,map,env,actor,enemy,scout,world,engine,controller,presentation,smoke,team});
 });
}

test('source endpoint smoke: team sees enemy, selected actor cannot lock, same snapshot removes mesh and inspection until smoke clears',()=>fixture(({map,env,actor,enemy,world,controller,presentation,smoke,team})=>{
 smoke(actor.x,actor.y);
 assert.equal(TacticalEngine.teamCanIdentifyUnit(world,team,enemy),true);
 const reasons=[];assert.equal(TacticalEngine.canTarget(map,actor,enemy,world.selectedSkill,env,(reason,details)=>reasons.push({reason,details})),false);
 assert.equal(reasons[0].reason,'OPTICAL_ENDPOINT_BLOCKED');
 assert.equal(reasons[0].details.sourceOptical.reason,'SMOKE');
 assert.equal(reasons[0].details.targetOptical.blocked,false);
 assert.equal(controller.targetableEntities(actor,world.selectedSkill).includes(enemy),false);
 const snapshot=presentation.battleSnapshot();assert.equal(snapshot.units.some(u=>u.id===enemy.id),false);
 assert.equal(snapshot.map.tiles.find(t=>t.x===enemy.x&&t.y===enemy.y).attackable,false);
 assert.equal(presentation.unitPresentation(enemy),null);
 world.mode='inspect';assert.ok(presentation.battleSnapshot().units.some(u=>u.id===enemy.id),'outside single aim retain shared tactical intel');
 world.mode='attack';env.effects.clear();
 assert.ok(presentation.battleSnapshot().units.some(u=>u.id===enemy.id));
 assert.equal(presentation.battleSnapshot().map.tiles.find(t=>t.x===enemy.x&&t.y===enemy.y).attackable,true);
}));

test('legal indirect/approach plans and adjacency are not hidden; unrelated out-of-range and terrain restrictions stay independent',()=>fixture(({map,env,actor,enemy,world,controller,smoke})=>{
 smoke(actor.x,actor.y);
 assert.deepEqual(TacticalEngine.aimOpticallyHiddenIds(map,actor,[enemy],[],env),['enemy']);
 assert.deepEqual(TacticalEngine.aimOpticallyHiddenIds(map,actor,[enemy],[enemy],env),[]);
 // Existing approach planner may choose another, unblocked, reachable origin.
 actor.moved=false;const targets=controller.targetableEntities(actor,world.selectedSkill);
 assert.ok(targets.includes(enemy));assert.deepEqual(TacticalEngine.aimOpticallyHiddenIds(map,actor,[enemy],targets,env),[]);
 actor.moved=true;enemy.x=actor.x+1;enemy.y=actor.y;
 assert.deepEqual(TacticalEngine.aimOpticallyHiddenIds(map,actor,[enemy],[],env),[]);
 enemy.x=actor.x+5;env.effects.clear();
 assert.equal(TacticalEngine.canTarget(map,actor,enemy,world.selectedSkill,env),false);
 assert.deepEqual(TacticalEngine.aimOpticallyHiddenIds(map,actor,[enemy],[],env),[]);
}));

test('steam and an intervening smoke cell use the same existing optical rule; sensed contacts remain visible',()=>fixture(({map,env,actor,enemy,smoke})=>{
 enemy.x=actor.x+3;enemy.y=actor.y;
 smoke(actor.x+1,actor.y);
 assert.deepEqual(TacticalEngine.aimOpticallyHiddenIds(map,actor,[enemy],[],env),['enemy']);
 env.effects.clear();env.effects.set(`${actor.x},${actor.y}`,[{type:'STEAM',duration:2,visionBlock:true}]);
 assert.deepEqual(TacticalEngine.aimOpticallyHiddenIds(map,actor,[enemy],[],env),['enemy']);
 actor.effects.push({id:'test-sense',type:'BUFF',remaining:1,visionRules:{ignoreEnvironmentBlockers:true,maxRange:4}});
 assert.equal(TacticalEngine.canSee(map,actor,enemy,env),true);
 assert.deepEqual(TacticalEngine.aimOpticallyHiddenIds(map,actor,[enemy],[],env),[]);
}));

for(const seat of [0,1])test(`Worker exports only already observed optical aim IDs and retains legal environment contacts, seat ${seat}`,()=>fixture(({game,map,env,actor,enemy,scout,engine,smoke})=>{
 smoke(actor.x,actor.y);const aim=()=>projectCanonicalAimOptions(game,seat,actor,engine).find(x=>x.type==='DECLARE_ATTACK'&&x.skillId==='nereia_water_bullet');
 const a=aim();assert.ok(a);assert.deepEqual(a.opticallyHiddenUnitIds,['enemy']);
 assert.equal(a.actionableTiles.some(t=>t.x===enemy.x&&t.y===enemy.y),false);
 scout.alive=false;assert.ok(!aim().opticallyHiddenUnitIds?.includes(enemy.id),'never export a globally concealed ID');
 scout.alive=true;env.effects.clear();const b=aim();assert.ok(!b.opticallyHiddenUnitIds?.length);
 assert.ok(b.actionableTiles.some(t=>t.x===enemy.x&&t.y===enemy.y));
},seat));

test('native interaction roster change uses the same full snapshot publication; unchanged roster uses overlays',()=>{
 const a={revision:1,map:{tiles:[]},units:[{id:'queen'},{id:'enemy'}]},b={...a,units:[a.units[0]]};let calls=[];
 const renderer={lastState:a,presentationCommitHistory:[],sync(s,e){calls.push(['sync',e]);this.lastState=s;this.presentationCommitHistory.push({complete:true});},highlights:{sync:()=>calls.push(['highlights'])},unitHud:{sync:()=>calls.push(['hud'])},syncActionAnchor:()=>calls.push(['anchor']),syncSubsystem:(n,f)=>{f();return true;}};
 const update=s=>BabylonRenderer.prototype.syncInteractionPresentation.call(renderer,s);
 assert.equal(update(b),true);assert.deepEqual(calls,[['sync',[]]]);calls=[];
 assert.equal(update(b),true);assert.deepEqual(calls,[['highlights'],['hud'],['anchor']]);calls=[];
 assert.equal(update(a),true);assert.deepEqual(calls,[['sync',[]]]);
});

test('PvP native UI consumes certified mask for both snapshot and click, preserving environmental targeting',()=>{
 const ui=Object.create(PvpTacticalUI.prototype),sent=[];
 const actor={id:'queen',team:'P',alive:true,moved:true,aimOptions:[
 {type:'DECLARE_ATTACK',skillId:'nereia_water_bullet',tiles:[],actionableTiles:[],opticallyHiddenUnitIds:['enemy']},
 {type:'CAST_ENVIRONMENT_CONTACT',skillId:'nereia_water_bullet',tiles:[{x:6,y:6}],actionableTiles:[{x:6,y:6}]}],environmentContactSkillIds:['nereia_water_bullet']};
 const enemy={id:'enemy',team:'E',alive:true,x:6,y:6};
 const scene={revision:2,map:{id:'test',tiles:[{x:6,y:6}]},units:[actor,enemy],presentation:{environment:{lightSources:[{source:'UNIT_TILE_LIGHT',sourceId:'enemy'},{source:'BURNING',x:6,y:6}]}}};
 let published;Object.assign(ui,{seat:0,presented:true,selectedUnitId:actor.id,mode:'DECLARE_ATTACK',target:{unitId:actor.id,skillId:'nereia_water_bullet'},match:{revision:2,view:{phase:'PLAYER_TACTICAL_PHASE',activeSeat:0,units:[actor,enemy],battlefield:{cores:[]}}},serverSnapshot:scene,bridge:{renderer:{syncInteractionPresentation:s=>(published=s,true)}},enchantCandidates:[],samePublicBattlefield:()=>true,onRendered:()=>{},isConnected:()=>true,request:a=>{sent.push(a);return true;},cancelTarget(){this.mode='SELECT';this.target=null;},update:()=>{}});
 assert.equal(ui.refreshNativePresentation(),true);assert.deepEqual(published.units.map(u=>u.id),['queen']);
 assert.deepEqual(published.presentation.environment.lightSources.map(l=>l.source),['BURNING']);
 assert.equal(published.map.tiles[0].attackable,true,'extinguish target still exists');
 assert.equal(ui.tilePicked({seat:0,x:6,y:6}),true);assert.equal(sent[0].type,'CAST_ENVIRONMENT_CONTACT');
 assert.deepEqual(published.units.map(u=>u.id),['queen','enemy'],'canceling aim restores team view');
 assert.equal(scene.units.length,2,'server snapshot remains immutable');
});
