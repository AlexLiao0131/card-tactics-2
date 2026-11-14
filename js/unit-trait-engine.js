/** Generic resource-driven traits and control overrides. No hero-specific state writes.
 * Every scalar mutation flows through ResourceEngine; resource-specific data lives
 * in RESOURCE_PROFILES and character.resourceRules. Shared by LOCAL, Gemini, PvP.
 */
import {ResourceEngine} from './resource-engine.js';
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
function resourceKey(u){
  const keys=new Set([...Object.keys(ResourceEngine.resourceRules(u)),...Object.keys(u?.resources||{})]);
  for(const key of keys){
    const declared=ResourceEngine.resourceRules(u)[key]||ResourceEngine.RESOURCE_PROFILES[key];
    if(declared?.polarity)return key;
  }
  return null;
}
const profile=u=>{
  const key=resourceKey(u);
  return key?(ResourceEngine.resourceRules(u)[key]||ResourceEngine.RESOURCE_PROFILES[key]):null;
};
const owned=u=>resourceKey(u)!==null;
const rules=u=>profile(u)||{};
const config=u=>rules(u).polarity||{};
const cycle=u=>{
  u.resourceMechanicStates??={};
  const key=resourceKey(u);
  return u.resourceMechanicStates[key]??={round:1,fullRounds:0,holdUntil:0,processedRound:0};
};
function initialize(unit){
  if(!owned(unit))return null;
  const key=resourceKey(unit);
  ResourceEngine.syncOne(unit,key,rules(unit));cycle(unit);
  return unit.resources[key];
}
const polarity=u=>owned(u)?(ResourceEngine.value(u,resourceKey(u),rules(u))??null):null;
const isUncontrolled=u=>u?.controlOverride?.type==='BERSERK';
function status(u){
  const v=polarity(u),p=config(u),c=u?.resourceMechanicStates?.[resourceKey(u)];
  return {value:v,blueFull:v===p.blueFull,purpleFull:v===p.purpleFull,
    mode:v===p.blueFull?'COMPLETE':v===p.purpleFull?'CORRUPTED':'NORMAL',
    corruptionRounds:c?.fullRounds||0,berserk:isUncontrolled(u),
    recoveryRemaining:isUncontrolled(u)?Math.max(0,v-p.center):0};
}
function setPolarity(u,value){
  if(!initialize(u)||!Number.isFinite(Number(value)))return 0;
  const changed=ResourceEngine.set(u,resourceKey(u),Math.round(Number(value)),rules(u));
  if(changed!==0)globalThis.EffectEngine?.syncModifiers?.(u);
  if(polarity(u)!==config(u).purpleFull)cycle(u).fullRounds=0;
  return changed;
}
function afterCommittedSkill(unit,skill){
  if(!owned(unit)||!skill||skill.purifiedSlash||isUncontrolled(unit))return;
  initialize(unit);
  const p=config(unit),delta=p.skillDeltas?.[skill.id];
  if(!Number.isFinite(Number(delta)))return;
  const now=polarity(unit);
  if(now<p.purpleFull)setPolarity(unit,now+Number(delta));
  if(polarity(unit)===p.purpleFull)
    cycle(unit).holdUntil=cycle(unit).round+Number(p.holdFullFutureRounds??1);
}
function transformedSkill(unit,skill){
  if(!owned(unit)||!skill)return skill;
  const p=config(unit),entry=rules(unit).spellForms?.[skill.id];
  if(!entry)return skill;
  const v=polarity(unit),variant=v===p.blueFull?entry.blue:v===p.purpleFull?entry.purple:null;
  return variant?{...skill,...variant}:skill;
}
function resetBlueAfterUltimate(unit){
  if(!initialize(unit))return false;
  setPolarity(unit,config(unit).center);
  const c=cycle(unit);c.fullRounds=0;c.holdUntil=0;
  return true;
}
function statBonus(unit){const p=config(unit);return owned(unit)&&polarity(unit)===p.blueFull?Number(p.fullFormStatBonusRatio||0):0;}
function berserkDamageMultiplier(unit){
  return isUncontrolled(unit)?Number(unit.controlOverride.damageMultiplier||1):1;
}
function completeBerserk(unit){
  if(!isUncontrolled(unit)||unit.controlOverride.sourceResource!==resourceKey(unit)||
     polarity(unit)>Number(rules(unit).berserk?.releaseAt??config(unit).center))return false;
  const override=unit.controlOverride;
  unit.team=override.originalTeam;
  unit.participatesInTurn=override.originalParticipation!==false;
  delete unit.controlOverride;cycle(unit).fullRounds=0;
  return true;
}
function recoverPolarity(unit,round){
  const c=cycle(unit),p=config(unit);
  const changed=ResourceEngine.recover(unit,resourceKey(unit),round,{
    delta:-Number(p.roundRecovery||0),blockedThroughRound:c.holdUntil,profile:rules(unit)
  });
  if(changed!==0){globalThis.EffectEngine?.syncModifiers?.(unit);if(polarity(unit)<p.purpleFull)c.fullRounds=0;}
  return changed;
}
function onRoundStart({units=[],round,random=Math.random}={}){
  if(!Number.isSafeInteger(round))return{rounds:0,berserk:[]};
  const berserk=[];
  for(const unit of units){
    if(unit?.alive===false||!initialize(unit))continue;
    const c=cycle(unit);c.round=round;
    if(c.processedRound===round)continue;
    c.processedRound=round;
    if(isUncontrolled(unit)){
      recoverPolarity(unit,round);
      if(polarity(unit)<=Number(rules(unit).berserk?.releaseAt??config(unit).center))completeBerserk(unit);
      continue;
    }
    const p=config(unit);
    if(polarity(unit)===p.purpleFull){
      c.fullRounds++;
      const risk=clamp((c.fullRounds-1)*Number(p.corruptionRiskIncreasePerRound||0),0,1);
      if(risk>0&&random()<risk){
        unit.controlOverride={type:'BERSERK',sourceResource:resourceKey(unit),startedRound:round,
          damageMultiplier:Number(rules(unit).berserk?.damageMultiplier||1),
          originalTeam:unit.team,originalParticipation:unit.participatesInTurn!==false,
          actionDoneRound:null};
        unit.participatesInTurn=false;unit.team='N';c.fullRounds=0;berserk.push(unit.id);
      }
    }
    // A loss of control in the first eligible recovery round may not swallow
    // that recovery tick; the skip covers exactly the full following round.
    recoverPolarity(unit,round);
  }
  return{round,berserk};
}
function resistMagic(unit,amount,{random=Math.random,unresistable=false}={}){
  const n=Math.max(0,Math.round(Number(amount)||0)),m=rules(unit).magicResist||ResourceEngine.RESOURCE_PROFILES.duality.magicResist||{};
  if(n===0||unresistable||!unit?.character?.equipment?.some(i=>i?.affixes?.includes(m.affix)))
    return{damage:n,blocked:0,triggered:false};
  const triggered=random()<Number(m.procChance||0),after=triggered?Math.round(n*Number(m.damageMultiplier||1)):n;
  return{damage:after,blocked:n-after,triggered};
}
export const UnitTraitEngine=Object.freeze({initialize,polarity,status,setPolarity,afterCommittedSkill,
  transformedSkill,resetBlueAfterUltimate,statBonus,onRoundStart,completeBerserk,
  isUncontrolled,berserkDamageMultiplier,resistMagic,hasResource:owned,resourceKey});
globalThis.UnitTraitEngine=UnitTraitEngine;
