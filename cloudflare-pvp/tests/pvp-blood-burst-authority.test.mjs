import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {resolveCanonicalPlayerCommand,beginCanonicalPlayerCardPhase,tacticalDebugProjection,experimentalTacticalCore} from '../src/pvp-headless-tactical.mjs';
import {canonicalBloodBurstSkills} from '../src/pvp-headless-blood-burst.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {SkillDatabase,SKILLS} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {createAuthoritySession,commitAuthorityCommand} from '../src/battle-authority.mjs';
import {PVP_COMMAND_PROTOCOL} from '../../shared/pvp-command-contract.mjs';

const deck=Array(20).fill('imperial_swordsman_card');
const cast=(g,seat=0,id='seraphina_blood_burst')=>resolveCanonicalPlayerCommand(g,
  {type:'CAST_BLOOD_BURST',unitId:'vampire',skillId:id},seat);

function build({seed=239022,seat=0,bleeding=true,extraBleeding=true,third=true}={}){
  let game=createOpeningGame({decks:[deck,deck],serverSeed:seed});
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
  beginCanonicalPlayerCardPhase(game);
  resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
  if(seat===1){
    resolveCanonicalPlayerCommand(game,{type:'END_TACTICAL_PHASE'},0);
    resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},1);
  }
  const map=game.battlefield.map;
  const tiles=new Map(map.tiles.map(t=>[`${t.x},${t.y}`,t]));
  const free=t=>t&&globalThis.TERRAINS[t.terrain]?.passable===true&&
    !(map.objects||[]).some(o=>!o.destroyed&&o.blocksMovement&&o.x===t.x&&o.y===t.y);
  const square=map.tiles.find(t=>free(t)&&free(tiles.get(`${t.x+1},${t.y}`))&&
    free(tiles.get(`${t.x},${t.y+1}`))&&free(tiles.get(`${t.x+1},${t.y+1}`)));
  assert.ok(square,'official map yields a 2x2 traversable square');
  const [x,y]=[square.x,square.y];
  withCanonicalEngines(game,e=>{
    const entries=[
      {id:'vampire',team:['P','E'][seat],characterId:'seraphina',x,y},
      {id:'bleeder',team:['E','P'][seat],characterId:'imperial_swordsman',x:x+1,y},
      {id:'other',team:['E','P'][seat],characterId:'imperial_swordsman',x,y:y+1},
      {id:'victim',team:['E','P'][seat],characterId:'imperial_swordsman',x:x+1,y:y+1}
    ];
    for(const item of entries){
      const u=e.unitRuntime.create({...item,map,cores:game.battlefield.cores});
      assert.ok(u,'official character spawned '+item.id);
      delete u._runtimeMap;
      u.acted=false;u.waited=false;u.moved=false;
      if(item.id==='victim')u.hp=Math.max(1,u.hp);
      game.units.push(u);
    }
    const bleed=SkillDatabase.get('seraphina_rending_claw').statusEffects[0];
    if(bleeding)e.effect.apply({source:game.units[0],target:game.units[1],effect:bleed});
    if(extraBleeding)e.effect.apply({source:game.units[0],target:game.units[2],effect:bleed});
    // One own-side unit near the blasts: bursts must NEVER damage allies.
    const ally=e.unitRuntime.create({id:'friend',team:['P','E'][seat],characterId:'imperial_swordsman',x:x+2,y:y+1,map,cores:game.battlefield.cores});
    assert.ok(ally);
    delete ally._runtimeMap;ally.acted=false;ally.moved=false;ally.waited=false;
    game.units.push(ally);
    e.unitRuntime.syncLiveRoster(game.units);
  });
  return game;
}

test('blood burst is a private metadata-driven, legal-target skill, not a PVP name whitelist',()=>{
  const game=build();
  const own=tacticalDebugProjection(game,0).units.find(u=>u.id==='vampire');
  assert.ok(own?.bloodBurstSkills.some(x=>x.id==='seraphina_blood_burst'));
  const enemy=tacticalDebugProjection(game,1).units.find(u=>u.id==='vampire');
  assert.equal(enemy?.bloodBurstSkills,undefined);
  assert.equal(SkillDatabase.get('seraphina_blood_burst').bloodBurst,true);
});

test('original bloodBurst detonates only enemy bleeding centers and leaves bleeding intact',()=>{
  const game=build();const [caster,first,second,third,friend]=game.units;
  const hp=game.units.map(u=>u.hp),mana=caster.mana,blood=caster.resources.blood.value;
  const action=cast(game);
  assert.equal(action.accepted,true);
  assert.equal(action.skillId,'seraphina_blood_burst');
  assert.equal(caster.mana,mana-SkillDatabase.get('seraphina_blood_burst').manaCost);
  assert.ok(first.hp<hp[1]||second.hp<hp[2]||third.hp<hp[3]);
  assert.ok(third.hp<hp[3],'the non-bleeding enemy within the blast area also takes damage');
  assert.match(game.events.find(entry=>entry.text.includes('血爆｜'))?.text||'',/2 個流血爆點/);
  assert.equal(friend.hp,hp[4]);
  assert.equal(caster.hp,hp[0]);
  assert.equal(first.effects.some(e=>e.id==='BLEEDING'),true);
  assert.equal(second.effects.some(e=>e.id==='BLEEDING'),true);
  assert.equal(caster.acted,true);
  assert.ok(caster.resources.blood.value>=blood,'original blood gain from actual HP loss');
  assert.doesNotThrow(()=>structuredClone(game));
  assert.throws(()=>cast(game),{code:'BLOOD_BURST_ACTOR_UNAVAILABLE'});
});

test('no bleeding, wrong seat, forged damage, fake character and low MP all reject without damage',()=>{
  const g=build({bleeding:false,extraBleeding:false});
  const before=structuredClone(g);
  assert.throws(()=>cast(g),{code:'BLOOD_BURST_SKILL_UNAVAILABLE'});
  assert.throws(()=>cast(g,1),{code:'NOT_YOUR_TURN'});
  assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_BLOOD_BURST',unitId:'vampire',skillId:'seraphina_blood_burst',damage:12345},0),
    {code:'INVALID_BLOOD_BURST_COMMAND'});
  assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_BLOOD_BURST',unitId:'nonexistent',skillId:'seraphina_blood_burst'},0),
    {code:'BLOOD_BURST_ACTOR_UNAVAILABLE'});
  assert.deepEqual(g,before);
  const good=build();const snapshot=good.units.map(x=>x.hp);
  good.units[0].mana=0;
  assert.throws(()=>cast(good),{code:'BLOOD_BURST_SKILL_UNAVAILABLE'});
  assert.deepEqual(good.units.map(x=>x.hp),snapshot);
});

test('same seed and action use room RNG, never global Math.random, with identical full result',()=>{
  const a=build({seed:8763});const b=structuredClone(a);
  const original=Math.random;
  try{
    Math.random=()=>{throw new Error('RNG_MUST_BE_ROOM_LOCAL')};
    const ra=cast(a),rb=cast(b);
    assert.deepEqual(ra.affected,rb.affected);
    assert.equal(a.randomState,b.randomState);
    assert.deepEqual(a.units,b.units);
    assert.notEqual(a.randomState,b.randomState^1);
  }finally{Math.random=original;}
});

test('duplicate replay through BattleAuthority commits one burst only; room reload keeps HP',()=>{
  const game=build({seed:3133});
  const initial=createAuthoritySession({initialState:game,core:experimentalTacticalCore});
  const action={type:'CAST_BLOOD_BURST',unitId:'vampire',skillId:'seraphina_blood_burst'};
  const envelope={protocol:PVP_COMMAND_PROTOCOL,commandId:'burst_action_11111111',baseRevision:initial.revision,action};
  const first=commitAuthorityCommand({session:initial,seat:0,core:experimentalTacticalCore,envelope});
  assert.equal(first.nextSession.revision,initial.revision+1);
  const restore=structuredClone(first.nextSession);
  const replay=commitAuthorityCommand({session:restore,seat:0,core:experimentalTacticalCore,envelope});
  assert.equal(replay.duplicate,true);
  assert.deepEqual(replay.nextSession.state,first.nextSession.state);
  assert.throws(()=>commitAuthorityCommand({session:first.nextSession,seat:0,core:experimentalTacticalCore,
    envelope:{...envelope,commandId:'burst_action_22222222',baseRevision:first.nextSession.revision}}),
    {code:'BLOOD_BURST_ACTOR_UNAVAILABLE'});
});

test('future skill with bloodBurst metadata can use same center and command path',()=>{
  const g=build({seed:10034});
  const original=SkillDatabase.get('seraphina_blood_burst');
  const id='test_variant_blood_burst';
  assert.equal(SKILLS[id],undefined);
  SKILLS[id]={...original,id,name:'Test blood burst variant'};
  try{
    g.units[0].grantedSkills.push({skillId:id});
    withCanonicalEngines(g,engine=>{
      engine.unitRuntime.syncLiveRoster(g.units);
      assert.ok(canonicalBloodBurstSkills(g.units[0],engine,g.units).some(s=>s.id===id));
    });
    assert.equal(cast(g,0,id).accepted,true);
  }finally{delete SKILLS[id];}
});

test('second seat is also allowed to cast on its tactical turn and enemies only',()=>{
  const g=build({seed:5151,seat:1});
  assert.equal(cast(g,1).accepted,true);
  assert.equal(g.units[4].hp,g.units[4].character.combat.hp);
});

test('serialized world passes map and climate to official line-of-sight, never reveals concealed bleeding targets',()=>{
  const g=build({seed:18723});
  assert.equal('_runtimeMap' in g.units[0],false,'DO units intentionally exclude circular map references');
  const original=TacticalEngine.teamCanSee;
  let calls=0;
  try{
    TacticalEngine.teamCanSee=(map,units,team,target,environmentState)=>{
      calls++;
      assert.equal(map,g.battlefield.map);
      assert.equal(environmentState,g.environmentState);
      assert.equal(team,'P');
      return false; // Simulate the canonical LOS rejecting a concealed target.
    };
    const before=structuredClone(g);
    const view=tacticalDebugProjection(g,0);
    assert.equal(view.units.find(u=>u.id==='vampire').bloodBurstSkills.length,0);
    assert.throws(()=>cast(g),{code:'BLOOD_BURST_SKILL_UNAVAILABLE'});
    assert.ok(calls>0,'official LOS must be evaluated even without _runtimeMap');
    assert.deepEqual(g.units.map(u=>u.hp),before.units.map(u=>u.hp));
  }finally{TacticalEngine.teamCanSee=original;}
});

test('blood burst automatically resolves the lone bleeding center and its nearby victims even with unfavorable attack accuracy RNG',()=>{
  const game=build({extraBleeding:false});
  const [caster,bleeder,other,victim,friend]=game.units;
  // Deterministic room RNG: the first two draws are 0.9951 and 0.9987.
  // Ordinary attack rolls can MISS both, but an already-bleeding target must
  // still detonate without asking the player to pick a victim or roll to hit.
  game.randomState=7119;
  const before={bleeder:bleeder.hp,victim:victim.hp,other:other.hp,friend:friend.hp};
  const outcome=cast(game);
  assert.equal(outcome.accepted,true);
  assert.ok(bleeder.hp<before.bleeder,'auto-detected bleeding center must take damage');
  assert.ok(victim.hp<before.victim,'nearby non-bleeding enemy is hit by the same blast');
  assert.equal(other.hp,before.other,'outside blast radius stays unharmed');
  assert.equal(friend.hp,before.friend,'allies stay unharmed');
  assert.ok(bleeder.effects.some(e=>e.id==='BLEEDING'),'detonation does not remove bleed');
});

test('blood burst automatically detects bleeding applied by another friendly unit, without targeting that unit',()=>{
  const game=build({bleeding:false,extraBleeding:false});
  withCanonicalEngines(game,e=>{
    const [caster,bleeder,other,,friend]=game.units;
    const bleed=SkillDatabase.get('cat_dual_slash').statusEffects[0];
    e.effect.apply({source:friend,target:bleeder,effect:bleed});
    e.unitRuntime.syncLiveRoster(game.units);
    assert.equal(e.effect.bloodBurstCenters(caster,game.units,SkillDatabase.get('seraphina_blood_burst'),
      {map:game.battlefield.map,environmentState:game.environmentState}).map(u=>u.id).join(','),'bleeder');
  });
  assert.equal(tacticalDebugProjection(game,0).units.find(u=>u.id==='vampire').bloodBurstSkills.some(s=>s.id==='seraphina_blood_burst'),true);
  assert.equal(cast(game).accepted,true);
});

test('native offline self-cast uses the same auto-acquired bleeding centers and guaranteed detonation',()=>{
  const game=build({bleeding:false,extraBleeding:false});
  const map=game.battlefield.map,environmentState=game.environmentState;
  withCanonicalEngines(game,engine=>{
    const [actor,bleeder,,,ally]=game.units;
    const bleed=SkillDatabase.get('cat_dual_slash').statusEffects[0];
    engine.effect.apply({source:ally,target:bleeder,effect:bleed});
    engine.unitRuntime.syncLiveRoster(game.units);
    const hp=bleeder.hp,mana=actor.mana,log=[];
    const controller=globalThis.TacticalActionController.create({
      actionState:()=>({map,units:game.units,environmentState}),
      canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s,{map,environmentState}),
      consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s,{map,environmentState}),
      effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
      setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},
      pushLog:msg=>log.push(msg),render:()=>{},checkMatchEnd:()=>false,
      maybeAutoEndPlayerTurn:()=>false,handleDefeated:()=>{},random:()=>.999999
    });
    assert.equal(controller.executeEffectSkill(actor,actor,SkillDatabase.get('seraphina_blood_burst')),true);
    assert.ok(bleeder.hp<hp);
    assert.equal(actor.mana,mana-SkillDatabase.get('seraphina_blood_burst').manaCost);
    assert.equal(actor.acted,true);
    assert.ok(log.some(t=>t.includes('血爆｜1 個流血爆點')));
  });
});
