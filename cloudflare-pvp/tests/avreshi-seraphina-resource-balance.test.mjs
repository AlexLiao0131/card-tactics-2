import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {SKILLS,PASSIVES} from '../../js/skill-database.js';
import {CHARACTERS} from '../../js/character-database.js';
import {RESOURCE_PROFILES} from '../../js/resource-profile-database.js';

function bloodRulesHarness(){
  const source=readFileSync(new URL('../../js/unit-runtime-engine.js',import.meta.url),'utf8');
  const start=source.indexOf('  const bloodUser=');
  const end=source.indexOf('  function attackEnhancement(',start);
  assert.ok(start>=0&&end>start,'blood functions present in canonical runtime');
  const run=source.slice(start,end)+'\n({bloodValue,changeBlood,reconcileBlood,beginBloodTransaction,endBloodTransaction})';
  let modifierSyncs=0;
  const env={
    ResourceEngine:{change:(unit,key,delta)=>{
      const state=unit.resources[key],prev=state.value;
      state.value=Math.min(state.max,Math.max(0,prev+delta));
      return state.value-prev;
    }},
    syncResources:()=>{},
    extraResourceRules:unit=>({blood:{...RESOURCE_PROFILES.blood,...unit.character.resourceRules.blood}}),
    globalThis:{EffectEngine:{syncModifiers:()=>{modifierSyncs++;}}},
    Math,Number,Object,
  };
  return {...runInNewContext(run,env),modifierSyncs:()=>modifierSyncs};
}
function makeBloodUnit(initial=0){
  return {character:{resourceRules:{blood:{max:100,initial:0}}},resources:{blood:{max:100,value:initial}},_bloodAwakened:initial>=100};
}

test('樹皮術全形態常駐 +20% 物防、不增加魔防',()=>{
  const passive=PASSIVES.AVRESHI_BARKSKIN;
  assert.equal(passive.physicalDefenseBonusRatio,0.2);
  assert.equal(Math.round(CHARACTERS.avreshi.combat.def*1.2),68);
  assert.equal(CHARACTERS.avreshi.combat.mdef,94);
  for(const form of ['HUMAN','CHEETAH','SEAL','RAVEN'])
    assert.equal(CHARACTERS.avreshi.forms[form].passives.filter(p=>p==='AVRESHI_BARKSKIN').length,1);
});

test('星隕改為 40 星能 / 0 MP，蓄能技能與月光增幅維持原設定',()=>{
  const starfall=SKILLS.avreshi_starfall;
  assert.equal(starfall.manaCost,0);
  assert.equal(starfall.resourceCosts.astralPower,40);
  assert.equal(starfall.power,1.6);
  assert.deepEqual(starfall.areaDamage,{mode:'MAGIC_POWER',relation:'ENEMY',hitRule:'AREA_CONTACT'});
  for(const [id,gain,mana] of [
    ['avreshi_moonfire',12,16],['avreshi_rejuvenation',12,22],['avreshi_lightning',16,22]
  ]){
    assert.equal(SKILLS[id].astralGain,gain,id);
    assert.equal(SKILLS[id].manaCost,mana,id);
  }
  assert.equal(RESOURCE_PROFILES.astralPower.moonlightResonanceMaxRatio,.5);
  assert.ok(!('avreshi_moon_cycle' in SKILLS),'不應重新加入擅加的月相術');
});

test('血能直接傷害 30%，流血 DOT 15%，含整數換算',()=>{
  const runtime=bloodRulesHarness(), unit=makeBloodUnit();
  assert.equal(RESOURCE_PROFILES.blood.damageCreditMultiplier,.3);
  assert.equal(RESOURCE_PROFILES.blood.skillGainCap,35);
  assert.equal(runtime.changeBlood(unit,50),15,'50 HP direct -> 15 blood');
  assert.equal(runtime.changeBlood(unit,12/2),2,'12 HP bleed -> 6 initial credits -> 2 blood');
  assert.equal(unit.resources.blood.value,17);
});

test('吸血單招 120 HP：充 35，不能一刀滿 100',()=>{
  const r=bloodRulesHarness(), u=makeBloodUnit();
  r.beginBloodTransaction(u);
  assert.equal(r.changeBlood(u,120),35);
  r.endBloodTransaction(u);
  assert.equal(u.resources.blood.value,35);
  assert.equal(u._bloodAwakened,false);
  assert.equal(u._bloodTransactionEarned,undefined);
});

test('範圍血爆多敵、多爆點共用一次 35 血能上限，內外交易不重置',()=>{
  const r=bloodRulesHarness(),u=makeBloodUnit();
  r.beginBloodTransaction(u);
  assert.equal(r.changeBlood(u,60),18);
  r.beginBloodTransaction(u);
  assert.equal(r.changeBlood(u,60),17);
  r.endBloodTransaction(u);
  assert.equal(r.changeBlood(u,500),0,'inner end should not reset action budget');
  r.endBloodTransaction(u);
  assert.equal(u.resources.blood.value,35);
  r.beginBloodTransaction(u);
  assert.equal(r.changeBlood(u,50),15,'next skill can gain again');
  r.endBloodTransaction(u);
  assert.equal(u.resources.blood.value,50);
});

test('覺醒仍在 100 觸發，扣血能的血爆與血盾不受到收益倍率影響',()=>{
  const r=bloodRulesHarness(),u=makeBloodUnit(80);
  r.beginBloodTransaction(u);
  assert.equal(r.changeBlood(u,120),20,'capped by resource max');
  assert.equal(u._bloodAwakened,true);
  assert.equal(r.changeBlood(u,-22),-22,'blood burst fixed cost unchanged');
  assert.equal(r.changeBlood(u,-15),-15,'awakened enhancement unchanged');
  r.endBloodTransaction(u);
  assert.equal(u.resources.blood.value,63);
  assert.equal(u._bloodAwakened,true);
  assert.equal(SKILLS.seraphina_blood_burst.resourceCosts.blood,22);
  assert.equal(SKILLS.seraphina_blood_burst.manaCost,0);
  assert.equal(SKILLS.seraphina_blood_burst.attackType,'MAGIC');
  assert.equal(SKILLS.seraphina_blood_burst.element,'DARK');
});

test('未命中或被護盾全額吸收的 0 HP 傷害不增加血能',()=>{
  const r=bloodRulesHarness(),u=makeBloodUnit(10);
  r.beginBloodTransaction(u);
  assert.equal(r.changeBlood(u,0),0);
  r.endBloodTransaction(u);
  assert.equal(u.resources.blood.value,10);
});
