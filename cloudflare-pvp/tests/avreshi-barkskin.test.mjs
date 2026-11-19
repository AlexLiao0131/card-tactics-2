import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {SKILLS,PASSIVES} from '../../js/skill-database.js';
import {CHARACTERS} from '../../js/character-database.js';
const d=CHARACTERS.avreshi;
const passive=PASSIVES.AVRESHI_BARKSKIN;
test('樹皮術為被動、DEF+20%，不增加MDEF或減傷率',()=>{
  assert.equal(passive.category,'PASSIVE');
  assert.equal(passive.physicalDefenseBonusRatio,.2);
  assert.equal(passive.modifiers?.mdef,undefined);
  assert.equal(passive.damageTakenMultiplier,undefined);
  assert.equal(Math.round(d.combat.def*(1+passive.physicalDefenseBonusRatio)),68);
});
test('四形態全都持有被動，並且沒有重複註冊',()=>{
  for(const form of ['HUMAN','CHEETAH','SEAL','RAVEN']){
    const ids=d.forms[form].passives;
    assert.ok(ids.includes(passive.id),form);
    assert.equal(ids.filter(id=>id===passive.id).length,1,form);
    assert.ok(!d.forms[form].skillIds.includes(passive.id));
  }
  assert.ok(d.passives.includes(passive.id));
});
test('每次建立角色，DEF乘算僅一次；後續Buff同步保留初始DEF',()=>{
  const source=readFileSync(new URL('../../js/unit-runtime-engine.js',import.meta.url),'utf8');
  assert.match(source,/defenseRatio=SkillDatabase\.passiveList/);
  assert.match(source,/defenseRatio!==1\)runtimeCharacter\.combat\.def=Math\.round/);
  // A permanent passive applies to the unit's new runtime copy; not a mutable
  // shared character template, and not within EffectEngine.syncModifiers.
  assert.match(source,/const runtimeCharacter=clone\(character\)/);
  // Execute the exact initialization snippet with actual character and passive data.
  const start=source.indexOf('    const defenseRatio=SkillDatabase.passiveList(');
  const end=source.indexOf('    const unit={id,team,character:runtimeCharacter',start);
  assert.ok(start>0&&end>start);
  const apply=source.slice(start,end);
  for(let n=0;n<5;n++){
    const runtimeCharacter=structuredClone(d);
    const baselineMdef=runtimeCharacter.combat.mdef;
    runInNewContext(apply,{runtimeCharacter,SkillDatabase:{passiveList:ids=>ids.map(id=>PASSIVES[id]).filter(Boolean)}});
    assert.equal(runtimeCharacter.combat.def,68);
    assert.equal(runtimeCharacter.combat.mdef,baselineMdef);
  }
  assert.equal(d.combat.def,57);
});
