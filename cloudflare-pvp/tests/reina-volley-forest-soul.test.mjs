import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/pvp-match-core.mjs';
import '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {createOfficialBattlefield} from '../src/pvp-battlefield.mjs';
import {createCardPhaseEngine} from '../../js/card-phase-engine.js';
import {DeathLifecycleEngine} from '../../js/death-lifecycle-engine.js';
import {castCanonicalMapSkill} from '../src/pvp-headless-map-skills.mjs';

function fixture(soul,fn){
 const world=createOfficialBattlefield({serverSeed:1234,mapSize:'SMALL'});
 const map=world.map;map.objects=[];
 for(const t of map.tiles){t.terrain='PLAIN';t.elevation=0;}
 const state={units:[],randomState:1,battlefield:world,round:1,phase:"PLAYER_TACTICAL_PHASE",activeSeat:0,environmentState:EnvironmentEngine.createState?.(map)||{}};
 return withCanonicalEngines(state,e=>{
  const spawn=(id,characterId,team,x,y)=>{const u=e.unitRuntime.create({id,characterId,team,x,y,map,cores:world.cores});assert.ok(u);state.units.push(u);return u;};
  const reina=spawn('reina','reina','P',2,2),ophi=spawn('ophi','ophi','P',2,3),enemy=spawn('enemy','imperial_swordsman','E',4,2),survivor=spawn('survivor','imperial_swordsman','E',4,3);
  e.unitRuntime.changeResource(ophi,'forestSoul',soul);
  assert.equal(ophi.character.weapons.elven_bow.inherentMagic,undefined);
  enemy.hp=1;enemy.cardId='imperial_swordsman_card';survivor.hp=survivor.character.combat.hp;
  const logs=[],events=[],cardState=createCardPhaseEngine().create();let renders=0;
  const death=DeathLifecycleEngine.create({stageEvent:event=>events.push(event),cardStateFor:()=>cardState,pushLog:msg=>logs.push(msg),allowRewards:()=>false});
  const skill=SkillDatabase.get('reina_command_shot');
  const controller=globalThis.TacticalActionController.create({
   TEAM:{PLAYER:'P',ENEMY:'E'},actionState:()=>({map,units:state.units,environmentState:null}),
   canUseSkill:e.unitRuntime.canUseSkill,consumeSkill:e.unitRuntime.consumeSkill,effectiveSkill:e.unitRuntime.applyResourceScaling,
   unitAt:(x,y)=>TacticalEngine.occupantAt(state.units,x,y),aoeTiles:(c,r)=>TacticalEngine.aoeTiles(map,c,r),
   pushLog:msg=>logs.push(msg),handleDefeated:death.finalize,random:()=>0,
   setSelectedSkill(){},setSelectedSkillVariant(){},setMode(){},checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,render:()=>renders++
  });
  const visuals=globalThis.UnitAnimationEngine;visuals.clear();
  visuals.observe({units:state.units.map(u=>({...u,characterId:u.character.id}))});
  try{return fn({e,state,death,reina,ophi,enemy,survivor,skill,controller,map,logs,events,cardState,visuals,getRenders:()=>renders});}finally{visuals.clear();}
 });
}
for(const soul of [0,30])test(`actual shared engine volley with Ophi ${soul}/30: HP, log, death, graveyard, action and presentation`,()=>fixture(soul,t=>{
 const {reina,ophi,enemy,survivor,skill,controller,map,logs,events,cardState,visuals}=t;
 const before=reina.mana,prior=survivor.hp;
 const innate=t.e.battleResolution.previewInherentComponent(ophi,survivor,{...skill,weapon:'elven_bow'},{critical:false});
 if(soul===30){assert.equal(innate.element,'NATURE');assert.ok(innate.amount>0);}
 else assert.deepEqual(innate,{amount:0,element:null});
 const aim=TacticalEngine.tile(map,4,2);
 assert.ok(controller.mapTargetTiles(reina,skill).includes(aim));
 assert.equal(controller.executeMapSkill(reina,aim,skill),true);
 assert.equal(enemy.hp,0);assert.equal(enemy.alive,false);
 assert.ok(logs.some(s=>s.includes('集團齊射')&&s.includes(enemy.character.name)&&s.includes('HP 0')));
 assert.ok(logs.some(s=>s.includes('進入墓地')));
 assert.equal(events.filter(s=>s.type==='UNIT_DEFEATED'&&s.unitId===enemy.id).length,1);
 assert.equal(cardState.zones.graveyard.filter(x=>x===enemy.cardId).length,1);
 assert.equal(visuals.drain().filter(x=>x.state==='DEATH'&&x.unitId===enemy.id).length,1);
 assert.equal(TacticalEngine.occupantAt([enemy],enemy.x,enemy.y),null);
 assert.ok(survivor.hp<prior);
 assert.equal(reina.mana,before-skill.manaCost);
 for(const u of [reina,ophi])assert.deepEqual([u.moved,u.acted,u.waited],[true,true,true]);
 assert.equal(controller.executeMapSkill(reina,aim,skill),false);
 assert.equal(t.getRenders(),1);
}));

// Exercise the actual Worker map-skill adapter with the canonical engine and
// death lifecycle. Full room state cloning is a separate known baseline error.
test('Worker map command: full-soul volley completes with death and graveyard',()=>fixture(30,t=>{
 const {e,state,death,reina,ophi,enemy,logs,events,cardState,visuals}=t;
 const result=castCanonicalMapSkill(state,{type:'CAST_MAP_SKILL',unitId:reina.id,skillId:'reina_command_shot',x:4,y:2},0,e,{
  pushLog:msg=>logs.push(msg),handleDefeated:death.finalize,stageEvent:event=>events.push(event),
  damageUnitFlat(u,n){e.effect.applyDamage(u,n);if(u.hp<=0)death.finalize(u);},random:()=>0
 },()=>false);
 assert.equal(result.accepted,true);assert.equal(enemy.hp,0);assert.equal(enemy.alive,false);
 assert.ok(logs.some(s=>s.includes('集團齊射')&&s.includes('HP 0')));
 assert.equal(cardState.zones.graveyard.filter(x=>x===enemy.cardId).length,1);
 assert.equal(visuals.drain().filter(x=>x.state==='DEATH'&&x.unitId===enemy.id).length,1);
 assert.equal(TacticalEngine.occupantAt(state.units,enemy.x,enemy.y),null);
 for(const u of [reina,ophi])assert.deepEqual([u.moved,u.acted,u.waited],[true,true,true]);
}));
