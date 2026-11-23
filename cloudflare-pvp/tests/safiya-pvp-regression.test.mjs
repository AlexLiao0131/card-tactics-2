import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import {SKILLS,SkillDatabase} from '../../js/skill-database.js';
import {CHARACTERS} from '../../js/character-database.js';
import {LOADOUTS} from '../../js/loadout-database.js';
import {RESOURCE_PROFILES} from '../../js/resource-profile-database.js';
import {EffectEngine} from '../../js/effect-engine.js';

// Tests target the original production modules. They don't introduce a mock
// production engine or copy an independent PvP damage/status implementation.
const here=path.dirname(fileURLToPath(import.meta.url));
const source=relative=>readFileSync(path.resolve(here,relative),'utf8');
const pvpEffects=source('../src/pvp-headless-effect-skills.mjs');
const pvpEngagement=source('../src/pvp-headless-engagement.mjs');
const actionController=source('../../js/tactical-action-controller.js');
const battleResolution=source('../../js/battle-resolution.js');
const tacticalEngine=source('../../js/tactical-engine.js');
const effectEngine=source('../../js/effect-engine.js');
const resourceEngine=source('../../js/resource-engine.js');
const vfxManager=source('../../js/vfx-manager.js');

// Evaluate only the unmodified exported capability predicates. Importing the
// complete adapter would require Cloudflare's entire Worker bootstrap to test
// a pure schema predicate; this keeps a deterministic, executable contract.
function extractFunction(code,name,endName,globals={}){
  const open=`export function ${name}(`,start=code.indexOf(open);
  assert.notEqual(start,-1,`${name} must exist in the official PVP module`);
  const stop=code.indexOf(`\nexport function ${endName}(`,start);
  assert.notEqual(stop,-1,`${endName} must follow ${name}`);
  return vm.runInNewContext(code.slice(start,stop).replace(/^export /,'')+`\n${name}`,globals);
}
const isSelfDance=extractFunction(pvpEffects,'isCanonicalSelfDanceSkill','isCanonicalSubmergeSkill');
const isDirectAttack=extractFunction(pvpEngagement,'isCanonicalDirectAttackSkill','canonicalDirectAttackSkillOptions',
  {isCanonicalEnvironmentContactSkill:()=>false});
const appliedStance=pvpEffects.slice(pvpEffects.indexOf('function isCanonicalAppliedStance('),pvpEffects.indexOf('\nexport function isCanonicalDirectEffectSkill('));
const directEffectBody=pvpEffects.slice(pvpEffects.indexOf('export function isCanonicalDirectEffectSkill('),pvpEffects.indexOf('\nexport function isCanonicalSelfChannelSkill(')).replace(/^export /,'');
const isDirectEffect=vm.runInNewContext(`${appliedStance}\n${directEffectBody}\nisCanonicalDirectEffectSkill`,{EffectEngine});

const kit=['safiya_sword_dance','safiya_enchantment_dance','safiya_inspiring_dance',
  'safiya_purifying_dance','safiya_dance_of_death'];
const singerIds=['ophi_healing_song','nereia_ocean_song','angel_hymn'];

test('3V 舞者劍舞為零消耗 ATTACK，其餘四舞維持 MAGIC，共用正式技能資料庫',()=>{
 const hero=CHARACTERS.safiya;
 assert.ok(hero);
 assert.equal(hero.genetics.grade,'3V');
 assert.deepEqual([...hero.genetics.values],['AGI','WIL','LUK']);
 for(const id of kit){
  assert.ok(SKILLS[id],id);
  assert.equal(SKILLS[id].category,id==='safiya_sword_dance'?'ATTACK':'MAGIC',id);
  assert.ok(SkillDatabase.get(id),id);
 }
 assert.ok(LOADOUTS.safiya_default,'official loadout missing');
 for(const id of kit)assert.ok(LOADOUTS.safiya_default.skillIds.includes(id),id);
 assert.equal(SKILLS.safiya_sword_dance.manaCost,0,'劍舞應無MP消耗');
 assert.equal(SKILLS.safiya_sword_dance.resourceCosts,undefined,'劍舞不能額外扣其他資源');
});

test('聲望桃紅色且只增不減：上限與範圍門檻由正式 ResourceProfile 持有',()=>{
 const profile=RESOURCE_PROFILES.reputation;
 assert.equal(profile.color.toUpperCase(),'#EC4899');
 assert.equal(profile.initial,0);
 assert.equal(profile.naturalRecovery,0);
 assert.equal(profile.max,100);
 assert.equal(profile.rangeThresholds.length,profile.rangeRadii.length);
 assert.ok(profile.rangeThresholds.every((x,i,a)=>i===0||x>a[i-1]));
 assert.ok(profile.rangeRadii.every((x,i,a)=>i===0||x>=a[i-1]));
 assert.match(resourceEngine,/RESOURCE_PROFILES/);
});

test('PVP 接受劍舞為正式直攻，不把它誤分類成純魔法效果',()=>{
 assert.equal(isDirectAttack(SKILLS.safiya_sword_dance),true);
 assert.equal(isDirectEffect(SKILLS.safiya_sword_dance),false);
 assert.equal(isSelfDance(SKILLS.safiya_sword_dance),false);
 assert.equal(SKILLS.safiya_sword_dance.danceSequence,true);
 assert.equal(SKILLS.safiya_sword_dance.target,'ENEMY');
});

test('PVP 接受惑心之舞為正常單體異常，並非加入我方陣營',()=>{
 const skill=SKILLS.safiya_enchantment_dance;
 assert.equal(isDirectEffect(skill),true);
 assert.equal(isDirectAttack(skill),false);
 assert.equal(skill.target,'ENEMY');
 assert.equal(skill.effects[0].classification,'NEGATIVE');
 assert.equal(skill.effects[0].duration,3);
 assert.equal(skill.effects[0].control.type,'PURSUIT_SOURCE');
});

test('PVP 接受振奮、淨心、死亡之舞為共用 SELF 舞技',()=>{
 for(const id of ['safiya_inspiring_dance','safiya_purifying_dance','safiya_dance_of_death']){
  assert.equal(isSelfDance(SKILLS[id]),true,id);
  assert.equal(isDirectEffect(SKILLS[id]),false,id);
 }
});

test('PVP 拒絕偽造影響全員、繞過半徑或隨意改斬殺策略的技能契約',()=>{
 const inspire=SKILLS.safiya_inspiring_dance;
 const death=SKILLS.safiya_dance_of_death;
 assert.equal(isSelfDance({...inspire,target:'ENEMY'}),false);
 assert.equal(isSelfDance({...inspire,range:{min:0,max:9}}),false);
 assert.equal(isSelfDance({...inspire,danceAura:{...inspire.danceAura,radiusResource:'mana'}}),false);
 assert.equal(isSelfDance({...inspire,danceAura:{...inspire.danceAura,kind:'KILL_ALL'}}),false);
 assert.equal(isSelfDance({...death,deathDance:{...death.deathDance,targetOrder:'CLIENT_SELECTED'}}),false);
 assert.equal(isSelfDance({...death,deathDance:{...death.deathDance,continueOn:'MISS'}}),false);
 assert.equal(isSelfDance({...death,deathDance:{...death.deathDance,strike:{...death.deathDance.strike,attackType:'MAGIC'}}}),false);
});

test('聲望只擴大舞技有效半徑，不改寫近戰武器射程',()=>{
 const sword=SKILLS.safiya_sword_dance;
 const profile=RESOURCE_PROFILES.reputation;
 assert.equal(sword.range.min,1);
 assert.equal(sword.range.max,1);
 for(const id of ['safiya_inspiring_dance','safiya_purifying_dance','safiya_dance_of_death']){
  assert.equal(SKILLS[id].danceAura?.radiusResource??SKILLS[id].deathDance?.radiusResource,'reputation');
 }
 assert.ok(profile.rangeRadii.at(-1)>profile.rangeRadii[0]);
 assert.match(actionController,/function danceRadius\(/);
});

test('振奮之舞同時對直接傷害與 MOVE 提供正式 BUFF，限時不無限堆疊',()=>{
 const e=SKILLS.safiya_inspiring_dance.danceAura.effect;
 assert.equal(e.type,'BUFF');
 assert.equal(e.classification,'POSITIVE');
 assert.ok(e.modifiers.damageDealtMultiplier>1);
 assert.ok(e.modifiers.move>0);
 assert.equal(e.durationClock,'FULL_FUTURE_ROUNDS');
 assert.match(effectEngine,/damageDealtMultiplier/);
});

test('淨心之舞沿用正式 DISPEL，不把地形或異常狀態直接從資料庫刪除',()=>{
 assert.equal(SKILLS.safiya_purifying_dance.danceAura.effect.type,'DISPEL');
 assert.match(actionController,/EffectEngine\.apply\(\{source:attacker,target:friend,effect:skill\.danceAura\.effect\}\)/);
});

test('惑心狀態可以正式施加並被淨化，不需要第二份敵方狀態表',()=>{
 const sourceUnit={id:'safiya-control',team:'P',alive:true,effects:[],character:CHARACTERS.safiya};
 const enemy={id:'target',team:'E',alive:true,effects:[],character:CHARACTERS.imperial_swordsman};
 const applied=EffectEngine.apply({source:sourceUnit,target:enemy,effect:SKILLS.safiya_enchantment_dance.effects[0]});
 assert.equal(applied.applied,true);
 assert.equal(enemy.team,'E');
 assert.equal(enemy.effects.find(e=>e.id==='DANCE_BEGUILED').sourceUnitId,sourceUnit.id);
 const dispelled=EffectEngine.apply({source:sourceUnit,target:enemy,effect:{type:'DISPEL'}});
 assert.equal(dispelled.applied,true);
 assert.ok(dispelled.removed>0);
 assert.equal(enemy.effects.some(e=>e.id==='DANCE_BEGUILED'),false);
});

test('正式 AI 的追逐目標規則與地形／視線判定在共用 tactical-engine 內，不在 VFX',()=>{
 assert.match(tacticalEngine,/PURSUIT_SOURCE|DANCE_BEGUILED/);
 assert.doesNotMatch(vfxManager,/_dancePartnerId\s*=/);
 assert.match(actionController,/ctx\.traverseUnitPath\(attacker,step\.path/);
});

test('劍舞只有首次反擊窗口，後兩劍同一次行動且不重複 MP 扣款',()=>{
 assert.match(battleResolution,/danceCounterPresent/);
 assert.match(battleResolution,/DANCE_FOLLOWUP/);
 assert.match(battleResolution,/enqueueDance/);
 assert.match(battleResolution,/danceStep:2/);
 assert.match(battleResolution,/danceStep:3/);
 assert.match(battleResolution,/manaCost:0/);
});

test('劍舞背後返舞依當下正確面向和同一舞伴判斷，PVP 不接受自行宣告必中',()=>{
 assert.match(pvpEngagement,/danceReturn:TacticalEngine\.relativeArc\(defender,attacker\)==='BACK'/);
 assert.match(pvpEngagement,/attacker\._dancePartnerId===defender\.id/);
 assert.match(battleResolution,/danceReturn/);
 assert.doesNotMatch(pvpEngagement,/action\.forceHit/);
});

test('死亡之舞按目前最低 HP 自動索敵，擊殺才重新挑選，傷害仍走 BattleResolution',()=>{
 assert.equal(SKILLS.safiya_dance_of_death.deathDance.targetOrder,'LOWEST_CURRENT_HP');
 assert.equal(SKILLS.safiya_dance_of_death.deathDance.continueOn,'KILL');
 assert.match(actionController,/possible\.sort\(\(a,b\)=>Number\(a\.target\.hp\)-Number\(b\.target\.hp\)/);
 assert.match(actionController,/BattleResolution\.resolve\(/);
 assert.match(actionController,/if\(step\.target\.alive\)break/);
 assert.match(actionController,/ctx\.consumeSkill\(attacker,skill\)/);
});

test('PVP SELF 舞技在自動移動前拒絕外部 targetId，並交給原 TacticalActionController',()=>{
 assert.match(pvpEffects,/if\(selfDance&&caster\.id!==target\.id\)fail\('SELF_DANCE_TARGET_REQUIRED'\)/);
 assert.match(pvpEffects,/TacticalActionController\.create\(/);
 assert.match(pvpEffects,/actionController\.prepareAttack\(/);
 assert.match(pvpEffects,/canonicalTargetPlan\(/);
 assert.match(pvpEffects,/commitCanonicalTargetApproach\(/);
});

test('PVP 需要雙席位反擊選擇，不能在客戶端偷做命中傷害或延後再加一場交戰',()=>{
 assert.match(pvpEngagement,/game\.pendingAttack=/);
 assert.match(pvpEngagement,/game\.phase=REACTION_PHASE/);
 assert.match(pvpEngagement,/function settleCanonicalAttack\(/);
 assert.match(pvpEngagement,/engine\.battleResolution\.resolve\(/);
 assert.match(pvpEngagement,/game\.pendingAttack=null/);
});

test('歌聲協同與聲望資源分離，歌唱來源正式標記音樂類型',()=>{
 assert.ok(CHARACTERS.safiya.passives.includes('RHYTHM'));
 for(const id of singerIds)assert.equal(SKILLS[id].soundMagic,true,id);
 assert.equal(SKILLS.ophi_healing_song.channel.rhythm.manaRestore>0,true);
 assert.equal(SKILLS.nereia_ocean_song.channel.type,'SONG_CHANNEL');
 assert.equal(SKILLS.angel_hymn.channel.type,'SONG_CHANNEL');
 assert.match(effectEngine,/songResonance|rhythm/);
});

test('愛心與逐段劍光只在共用 Babylon VFX Manager，不參與戰鬥結算',()=>{
 assert.match(vfxManager,/role==='CHARM'/);
 assert.match(vfxManager,/dance-actual-heart/);
 assert.match(vfxManager,/deathDanceStep/);
 assert.match(vfxManager,/danceStep/);
 assert.match(vfxManager,/BABYLON\.MeshBuilder\.CreateTube/);
 assert.doesNotMatch(vfxManager,/\.hp\s*-=|\.mana\s*-=/);
});
