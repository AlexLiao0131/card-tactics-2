/**
 * Canonical game-state resource storage and mutations for every combat mode.
 * All scalar MP and extra-resource writes pass through this module. Hero engines
 * own *rules* (when/how to request changes), never resource storage/mutation.
 * No HUD, renderer, round coordinator or PvP-specific copy lives here.
 */
import {RESOURCE_PROFILES} from './resource-profile-database.js';
export {RESOURCE_PROFILES};
export const RESOURCE_MANA=Object.freeze({base:40,intFactor:2,wilFactor:2});
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const numeric=value=>Number.isFinite(Number(value))?Number(value):0;
function resourceRules(unit){
  const out={};
  for(const[key,rule]of Object.entries(unit?.character?.resourceRules||{})){
    if(key==='mana'||!rule||typeof rule!=='object')continue;
    out[key]={...(RESOURCE_PROFILES[key]||{}),...rule};
  }
  return out;
}
function resourceLabel(key,rule={}){
  return String(rule.label||rule.shortLabel||(key==='sanity'?'SAN':key.toUpperCase()));
}
function syncOne(unit,key,profile=null,{initialize=false,applyRecovery=false}={}){
  if(!unit||typeof key!=='string')return null;
  const declared=resourceRules(unit)[key];
  if(!declared&&!profile)return null; // no undeclared resource can be conjured
  const rule={...(RESOURCE_PROFILES[key]||{}),...(declared||{}),...(profile||{})};
  const max=Math.max(0,numeric(rule.max??100)),initial=clamp(numeric(rule.initial??max),0,max);
  unit.resources??={};
  const state=unit.resources[key]||{};
  let value=Number(state.value);
  if(initialize||!Number.isFinite(value))value=initial;
  if(applyRecovery)value+=numeric(rule.naturalRecovery);
  state.value=clamp(value,0,max);state.max=max;state.label=resourceLabel(key,rule);
  unit.resources[key]=state;
  return state;
}
function sync(unit,options={}){
  if(!unit)return{};
  unit.resources??={};
  for(const key of Object.keys(resourceRules(unit)))syncOne(unit,key,null,options);
  return unit.resources;
}
function set(unit,key,next,profile=null){
  if(!Number.isFinite(Number(next)))return 0;
  const state=syncOne(unit,key,profile);
  if(!state)return 0;
  const before=state.value;
  state.value=clamp(Number(next),0,state.max);
  return state.value-before;
}
function change(unit,key,delta,profile=null){
  if(!Number.isFinite(Number(delta)))return 0;
  const state=syncOne(unit,key,profile);
  return state?set(unit,key,state.value+Number(delta),profile):0;
}
function value(unit,key,profile=null){
  return syncOne(unit,key,profile)?.value??null;
}
/** Once per integer round, even if singleplayer/PvP calls a round hook twice.
 * blockedThroughRound is inclusive: committed in N with hold N+1 means the
 * entire N+1 recovery is skipped, and N+2 may recover.
 */
function recover(unit,key,round,{delta=0,blockedThroughRound=0,profile=null}={}){
  if(!unit||!Number.isSafeInteger(round)||round<1)return 0;
  const state=syncOne(unit,key,profile);
  if(!state)return 0;
  unit._resourceRecoveryRounds??={};
  if(unit._resourceRecoveryRounds[key]===round)return 0;
  unit._resourceRecoveryRounds[key]=round;
  if(round<=numeric(blockedThroughRound))return 0;
  return change(unit,key,delta,profile);
}
function manaMaxFromAttributes(attributes={}){
  return Math.max(0,Math.round(RESOURCE_MANA.base+numeric(attributes.int)*RESOURCE_MANA.intFactor+numeric(attributes.wil)*RESOURCE_MANA.wilFactor));
}
function manaMax(unit){return unit?.character?.resourceRules?.mana===false?0:manaMaxFromAttributes(unit?.character?.attributes||{});}
function syncMana(unit,{initialize=false}={}){
  if(!unit)return{mana:0,maxMana:0};
  const max=manaMax(unit);
  unit.mana=initialize||!Number.isFinite(Number(unit.mana))?max:clamp(Number(unit.mana),0,max);
  unit.maxMana=max;
  return{mana:unit.mana,maxMana:max};
}
function changeMana(unit,delta){
  if(!unit||!Number.isFinite(Number(delta)))return 0;
  syncMana(unit);
  const before=unit.mana;
  unit.mana=clamp(before+Number(delta),0,unit.maxMana);
  return unit.mana-before;
}
// Materials belong to the same authoritative unit as MP and special resources.
// They are a typed inventory, NOT scalar special-resource bars or ItemDatabase consumables.
const MATERIAL_KINDS=Object.freeze(['HERB','WOOD','MINERAL','CRYSTAL_SAND']);
const MATERIAL_AFFINITIES=Object.freeze(['NONE','NATURE','WATER','ICE','FIRE','THUNDER','HOLY','DARK','STONE']);
function materialKey(kind,quality='NORMAL',affinity='NONE'){
  const k=String(kind||'').toUpperCase(),q=String(quality||'NORMAL').toUpperCase(),a=String(affinity||'NONE').toUpperCase();
  if(!MATERIAL_KINDS.includes(k)||!['NORMAL','HIGH'].includes(q)||!MATERIAL_AFFINITIES.includes(a))return null;
  if((q==='NORMAL'&&a!=='NONE')||(q==='HIGH'&&a==='NONE'))return null;
  return `${k}:${q}:${a}`;
}
function materialInventory(unit){
  if(!unit)return null;
  if(!unit.materialInventory||typeof unit.materialInventory!=='object'||Array.isArray(unit.materialInventory))unit.materialInventory={};
  return unit.materialInventory;
}
function materialCount(unit,kind,quality='NORMAL',affinity='NONE'){
  const key=materialKey(kind,quality,affinity);
  return key?Math.max(0,Math.floor(Number(materialInventory(unit)?.[key]||0))):0;
}
function changeMaterial(unit,{kind,quality='NORMAL',affinity='NONE',amount}={}){
  const key=materialKey(kind,quality,affinity),count=Number(amount);
  if(!key||!unit||!Number.isSafeInteger(count)||count===0)return false;
  const inventory=materialInventory(unit),old=materialCount(unit,kind,quality,affinity);
  if(count<0&&old < -count)return false;
  const next=old+count;
  if(!Number.isSafeInteger(next)||next<0)return false;
  if(next===0)delete inventory[key];else inventory[key]=next;
  return true;
}
function hasMaterial(unit,{kind,quality='NORMAL',affinity='NONE',amount=1}={}){
  return Number.isSafeInteger(amount)&&amount>0&&materialCount(unit,kind,quality,affinity)>=amount;
}
function materialSnapshot(unit){return {...(materialInventory(unit)||{})};}
function snapshot(unit){
  sync(unit);
  return Object.fromEntries(Object.entries(unit?.resources||{}).map(([key,s])=>
    [key,{value:numeric(s.value),max:numeric(s.max),label:String(s.label||key)}]));
}
export const ResourceEngine=Object.freeze({RESOURCE_PROFILES,RESOURCE_MANA,resourceRules,resourceLabel,syncOne,sync,set,change,value,recover,
  manaMaxFromAttributes,manaMax,syncMana,changeMana,snapshot,
  MATERIAL_KINDS,MATERIAL_AFFINITIES,materialKey,materialInventory,materialCount,changeMaterial,hasMaterial,materialSnapshot});
globalThis.ResourceEngine=ResourceEngine;
