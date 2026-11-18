import assert from 'node:assert/strict';
import test from 'node:test';
import {ResourceEngine} from '../../js/resource-engine.js';
import {UnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import {CHARACTERS} from '../../js/character-database.js';
import {SKILLS,SkillDatabase} from '../../js/skill-database.js';
import {LOADOUTS} from '../../js/loadout-database.js';
// EnvironmentEngine reads only these four published hydrology scalars during
// initialization; the fixtures deliberately never simulate hydrology.
globalThis.HydrologyEngine={WATERLINE:0,RAIN_FILL_PER_EVENT:.06,
  HEAVY_RAIN_FILL_PER_EVENT:.12,STORM_RAIN_FILL_PER_EVENT:.16};
const {EnvironmentEngine:E}=await import('../../js/environment-engine.js');
const phaseIds=['NEW','WAXING_CRESCENT','FIRST_QUARTER','WAXING_GIBBOUS','FULL',
  'WANING_GIBBOUS','LAST_QUARTER','WANING_CRESCENT'];
const caster=()=>{
  const character=structuredClone(CHARACTERS.avreshi);
  character.skills=[...character.forms.HUMAN.skillIds];
  const unit={id:'avreshi-test',character,alive:true,hp:180,mana:120,maxMana:120,resources:{},acted:false,moved:false};
  ResourceEngine.sync(unit);return unit;
};
test('eight seeded world phases and compatibility channel',()=>{
  assert.deepEqual(E.MOON_PHASES.map(p=>p.id),phaseIds);
  assert.equal(E.MOON_PHASE_INTERVAL,E.DAY_NIGHT_INTERVAL*2);
  for(const id of phaseIds){
    const w=E.create({moonPhase:id,timeOfDay:'NIGHT'});
    assert.equal(w.moonPhase,id);
    assert.equal(E.moonPhaseState(w).id,id);
  }
  const w=E.create({moonlight:'FULL'});
  assert.equal(w.moonPhase,'FULL');
  assert.equal(w.moonlight,'FULL');
  assert.equal(E.setMoonlight(w,'NONE'),true);
  assert.equal(w.moonPhase,'NEW');
  assert.equal(w.moonlight,'NONE');
});
test('real lunar illumination applies only at night and falls under cloud cover',()=>{
  const w=E.create({moonPhase:'FULL',timeOfDay:'NIGHT'});
  assert.equal(E.moonExposure(w),1);
  E.setTimeOfDay(w,'DAY');assert.equal(E.moonExposure(w),0);
  E.setTimeOfDay(w,'NIGHT');
  assert.equal(E.setMoonPhase(w,'NEW'),true);
  assert.equal(E.moonExposure(w),0);
  E.setMoonPhase(w,'WAXING_GIBBOUS');
  assert.equal(E.moonExposure(w),.8);
  assert.equal(E.setMoonPhase(w,'INVALID'),false);
});
test('astral power, three-phase casts, moonlight acceleration, starfall gate',()=>{
  const unit=caster(),env=E.create({timeOfDay:'NIGHT',moonPhase:'FULL'});
  assert.equal(ResourceEngine.value(unit,'astralPower'),0);
  assert.equal(UnitRuntimeEngine.canUseSkill(unit,SKILLS.avreshi_starfall),false);
  assert.equal(SKILLS.avreshi_starfall.resourceCosts.astralPower,60);
  const expected=['新月術','半月術','滿月術'];
  const gains=[15,30,60];
  for(let i=0;i<3;i++){
    const s=UnitRuntimeEngine.skillForUnit(unit,SKILLS.avreshi_moon_cycle);
    assert.equal(s.name,expected[i]);
    assert.equal(UnitRuntimeEngine.canUseSkill(unit,s),true);
    assert.ok(UnitRuntimeEngine.consumeSkill(unit,s));
    const before=ResourceEngine.value(unit,'astralPower');
    assert.equal(UnitRuntimeEngine.gainAstralPower(unit,s,env),Math.min(100-before,gains[i]));
    assert.equal(unit.lunarCycleIndex,(i+1)%3);
  }
  assert.equal(UnitRuntimeEngine.skillForUnit(unit,SKILLS.avreshi_moon_cycle).name,'新月術');
  assert.equal(ResourceEngine.value(unit,'astralPower'),100);
  assert.equal(UnitRuntimeEngine.canUseSkill(unit,SKILLS.avreshi_starfall),true);
  assert.ok(UnitRuntimeEngine.consumeSkill(unit,SKILLS.avreshi_starfall));
  assert.equal(ResourceEngine.value(unit,'astralPower'),40);
  env.timeOfDay='DAY';
  assert.equal(UnitRuntimeEngine.gainAstralPower(unit,SKILLS.avreshi_moonfire,env),12);
  env.timeOfDay='NIGHT';
  assert.equal(UnitRuntimeEngine.gainAstralPower(unit,SKILLS.avreshi_moonfire,env),18);
});
test('all approved generators and removal of obsolete wrath skill',()=>{
  assert.equal(SKILLS.avreshi_moonfire.astralGainTrigger,'HIT');
  assert.equal(SKILLS.avreshi_lightning.astralGainTrigger,'HIT');
  assert.equal(SKILLS.avreshi_rejuvenation.astralGainTrigger,'EFFECTIVE_HEAL');
  assert.equal(SKILLS.avreshi_moonfire.statusEffects[0].astralGain,undefined);
  assert.equal(Object.hasOwn(SKILLS,'avreshi_wrath'),false);
  assert.equal(CHARACTERS.avreshi.forms.HUMAN.skillIds.includes('avreshi_wrath'),false);
  assert.equal(LOADOUTS.avreshi_default.skillIds.includes('avreshi_wrath'),false);
});
