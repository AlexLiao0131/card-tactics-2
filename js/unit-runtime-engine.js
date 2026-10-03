export const UnitRuntimeEngine=(()=>{
  const MANA_BASE=40,MANA_INT_FACTOR=2,MANA_WIL_FACTOR=2;
  const liveUnits=new Map();
  const clone=value=>JSON.parse(JSON.stringify(value));
  function maxManaFromAttributes(attributes={}){
    return Math.max(0,Math.round(MANA_BASE+Number(attributes.int||0)*MANA_INT_FACTOR+Number(attributes.wil||0)*MANA_WIL_FACTOR));
  }
  function maxMana(unit){return unit?.character?.resourceRules?.mana===false?0:maxManaFromAttributes(unit?.character?.attributes||{})}
  function syncMana(unit,{initialize=false}={}){
    if(!unit)return{mana:0,maxMana:0};
    const nextMax=maxMana(unit);
    if(initialize||!Number.isFinite(Number(unit.mana)))unit.mana=nextMax;
    else unit.mana=Math.min(Math.max(0,Number(unit.mana||0)),nextMax);
    unit.maxMana=nextMax;
    return{mana:unit.mana,maxMana:unit.maxMana};
  }
  function restoreMana(unit,amount){
    syncMana(unit);
    const before=unit.mana;
    unit.mana=Math.min(unit.maxMana,before+Math.max(0,Math.round(Number(amount||0))));
    return unit.mana-before;
  }
  function manaCost(skill){return Math.max(0,Math.round(Number(skill?.manaCost||0)))}
  function extraResourceRules(unit){
    const rules=unit?.character?.resourceRules||{},out={};
    for(const[key,value]of Object.entries(rules))if(key!=="mana"&&value&&typeof value==="object")out[key]=value;
    return out;
  }
  function resourceLabelFor(key,rule={}){return String(rule.label||rule.shortLabel||(key==="sanity"?"SAN":key.toUpperCase()));}
  function syncResources(unit,{initialize=false,applyRecovery=false}={}){
    if(!unit)return{};
    unit.resources??={};
    for(const[key,rule]of Object.entries(extraResourceRules(unit))){
      const max=Math.max(0,Number(rule.max??100)),initial=Math.max(0,Math.min(max,Number(rule.initial??max)));
      let current=Number(unit.resources[key]?.value);
      if(initialize||!Number.isFinite(current))current=initial;
      if(applyRecovery&&Number(rule.naturalRecovery||0)!==0)current+=Number(rule.naturalRecovery||0);
      current=Math.max(0,Math.min(max,current));
      unit.resources[key]={value:current,max,label:resourceLabelFor(key,rule)};
    }
    return unit.resources;
  }
  function resourceSnapshot(unit){
    syncResources(unit);
    return Object.fromEntries(Object.entries(unit?.resources||{}).map(([key,state])=>[key,{value:Number(state.value||0),max:Number(state.max||0),label:state.label||key.toUpperCase()}]));
  }
  function resourceCosts(skill){
    const out={};
    for(const[key,value]of Object.entries(skill?.resourceCosts||{})){const cost=Math.max(0,Number(value||0));if(cost>0)out[key]=cost;}
    return out;
  }
  function createSkillResources(){return{}}
  function createFromResolvedCharacter({id,team,character,x,y,map}){
    if(!character)return null;
    const runtimeCharacter=clone(character);
    const unit={id,team,character:runtimeCharacter,x,y,z:Number(TacticalEngine.elevation(TacticalEngine.tile(map,x,y))||0),
      hp:runtimeCharacter.combat.hp,alive:true,moved:false,acted:false,waited:false,
      unitRole:runtimeCharacter.unitRole||"UNIT",
      participatesInTurn:runtimeCharacter.participatesInTurn!==false,
      occupiesTile:runtimeCharacter.occupiesTile!==false,
      canAttack:runtimeCharacter.canAttack!==false,
      canCapture:runtimeCharacter.canCapture!==false,
      countsForObjectives:runtimeCharacter.countsForObjectives!==false,
      companionId:runtimeCharacter.companionId||null,
      ownerCharacterId:runtimeCharacter.ownerCharacterId||null,
      cargo:[],inventory:[],itemInteractionUsed:0,
      resources:{},skillResources:createSkillResources(),effects:[],grantedSkills:[],_runtimeMap:map};
    for(const passive of SkillDatabase.passiveList(runtimeCharacter?.passives||[])){
      for(const effect of passive.openingEffects||[])unit.effects.push(clone(effect));
    }
    globalThis.VerticalMobilityEngine?.initialize?.(unit,map);
    syncMana(unit,{initialize:true});syncResources(unit,{initialize:true});
    TacticalEngine.ensureFacing(unit);
    liveUnits.set(unit.id,unit);
    return unit;
  }
  function resolveCharacter(characterId,loadoutId=null){return LoadoutDatabase.resolveCharacter(characterId,loadoutId)}
  function create({id,team,characterId,loadoutId=null,x,y,map}){
    const character=resolveCharacter(characterId,loadoutId);if(!character)return null;
    return createFromResolvedCharacter({id,team,character,x,y,map});
  }
  function createFromCard({id,team,card,x,y,map,itemIds=[]}){
    if(!CardDatabase.isCharacter(card))return null;
    const unit=create({id,team,characterId:card.characterId,loadoutId:card.loadoutId,x,y,map});
    if(unit&&globalThis.ItemRuntimeEngine)ItemRuntimeEngine.initializeUnitInventory(unit,itemIds,{owned:true,source:"PREPARATION"});
    return unit;
  }
  function syncLiveRoster(units=[]){
    const roster=units||[],ids=new Set(roster.map(unit=>unit?.id).filter(Boolean));
    for(const id of [...liveUnits.keys()])if(!ids.has(id))liveUnits.delete(id);
    for(const unit of roster)if(unit?.id)liveUnits.set(unit.id,unit);
    return roster;
  }
  function reconcileCompanions(units){const roster=syncLiveRoster(units||[]);if(!globalThis.CompanionDatabase?.reconcileUnits)return[];return CompanionDatabase.reconcileUnits(roster)}
  function despawnCompanionsForOwner(owner){if(!owner?.id||!globalThis.CompanionDatabase?.despawnForOwner)return[];return CompanionDatabase.despawnForOwner(owner,[...liveUnits.values()])}
  function living(units,team){reconcileCompanions(units);return (units||[]).filter(u=>u.alive&&u.team===team)}
  function turnActors(units,team){return living(units,team).filter(u=>u.participatesInTurn!==false)}
  function resetActions(units,team){reconcileCompanions(units);turnActors(units,team).forEach(u=>{u.moved=false;u.acted=false;u.waited=false;u.itemInteractionUsed=0;syncMana(u);syncResources(u,{applyRecovery:true});})}
  function allFinished(units,team){reconcileCompanions(units);const actors=turnActors(units,team);return actors.length>0&&actors.every(u=>u.acted)}
  function resourceFor(unit,skill){
    syncMana(unit);syncResources(unit);
    const extras=resourceCosts(skill);
    return{type:Object.keys(extras).length?"MULTI":"MANA",cost:manaCost(skill),remaining:Math.max(0,Number(unit?.mana||0)),max:Number(unit?.maxMana||0),resources:Object.fromEntries(Object.entries(extras).map(([key,cost])=>[key,{cost,remaining:Number(unit.resources?.[key]?.value||0),max:Number(unit.resources?.[key]?.max||0)}]))};
  }
  function canUseSkill(unit,skill){
    if(skill?.approach&&unit?.moved)return false;
    const req=skill?.requirements||{};
    if(req.carrying===true&&!unit?.carryingUnitId)return false;
    if(req.notCarrying===true&&!!unit?.carryingUnitId)return false;
    if(req.notMoved===true&&!!unit?.moved)return false;
    if(req.water===true){const runtimeMap=unit?._runtimeMap||globalThis.CardTacticsRuntime?.getBattleMap?.(),tile=runtimeMap?.tiles?.find(t=>t.x===unit?.x&&t.y===unit?.y);if(!tile||Number(globalThis.HydrologyEngine?.waterDepth?.(tile)||0)<=0)return false;}
    syncMana(unit);syncResources(unit);
    if(unit.mana<manaCost(skill))return false;
    for(const[key,cost]of Object.entries(resourceCosts(skill))){const rule=extraResourceRules(unit)[key];if(!rule)return false;if(rule.allowOverdraft!==true&&Number(unit.resources?.[key]?.value||0)<cost)return false;}
    return true;
  }
  function consumeSkill(unit,skill){
    if(!canUseSkill(unit,skill))return null;
    const mana=manaCost(skill);unit.mana=Math.max(0,unit.mana-mana);
    const spent={};for(const[key,cost]of Object.entries(resourceCosts(skill))){const state=unit.resources[key];if(!state)continue;state.value=Math.max(0,Number(state.value||0)-cost);spent[key]={cost,remaining:state.value,max:state.max};}
    return{type:Object.keys(spent).length?"MULTI":"MANA",cost:mana,remaining:unit.mana,max:unit.maxMana,resources:spent};
  }
  function resourceLabel(unit,skill){
    syncMana(unit);syncResources(unit);const labels=[],mana=manaCost(skill);if(mana>0)labels.push(`MP ${mana}`);
    for(const[key,cost]of Object.entries(resourceCosts(skill))){const rule=extraResourceRules(unit)[key]||{},prefix=String(rule.costMode||"").toUpperCase()==="DRAIN"?"-":"";labels.push(`${resourceLabelFor(key,rule)} ${prefix}${cost}`);}
    return labels.length?labels.join(" / "):"無消耗";
  }
  function applyResourceScaling(unit,skill){
    if(!skill||skill._resourceScaled)return skill;
    let multiplier=1;
    if(skill.category==="MAGIC"||skill.attackType==="MAGIC"){
      syncResources(unit);
      for(const[key,rule]of Object.entries(extraResourceRules(unit))){
        const scaling=rule?.magicScaling;if(!scaling)continue;const state=unit.resources?.[key],max=Math.max(0,Number(state?.max||0));if(max<=0)continue;
        const depleted=1-Math.max(0,Math.min(1,Number(state.value||0)/max));multiplier*=1+depleted*Math.max(0,Number(scaling.maxBonus||0));
      }
    }
    if(multiplier===1)return{...skill,_resourceScaled:true,resourcePowerMultiplier:1};
    return{...skill,power:Number(skill.power||0)*multiplier,_resourceScaled:true,resourcePowerMultiplier:multiplier};
  }
  function targetType(skill){return skill?.targetType||"SINGLE"}
  function getLiveUnit(id){return liveUnits.get(id)||null}
  function rotateFacing(id,steps=1){const unit=getLiveUnit(id);if(!unit?.alive)return null;return TacticalEngine.rotateFacing(unit,steps)}
  function setFacing(id,facing){const unit=getLiveUnit(id);if(!unit?.alive)return null;return TacticalEngine.setFacing(unit,facing)}
  function flightControl(id){
    const unit=getLiveUnit(id);if(!unit?.alive||!globalThis.VerticalMobilityEngine?.flightAltitudeRange)return null;
    const tile=unit._runtimeMap?.tiles?.find(t=>t.x===unit.x&&t.y===unit.y)||null,range=VerticalMobilityEngine.flightAltitudeRange(unit);
    if(!tile||!range)return null;const state=VerticalMobilityEngine.describe(unit,tile);return{...range,altitude:Number(state.flightAltitude||0),mode:state.mode};
  }
  function adjustFlightAltitude(id,steps=1){
    const unit=getLiveUnit(id);if(!unit?.alive||!globalThis.VerticalMobilityEngine?.adjustFlightAltitude)return null;
    const tile=unit._runtimeMap?.tiles?.find(t=>t.x===unit.x&&t.y===unit.y)||null;if(!tile)return null;
    const result=VerticalMobilityEngine.adjustFlightAltitude(unit,tile,steps);return result?.ok?result.state:null;
  }
  function cargoProfile(unit){return unit?.character?.cargo||null}
  function cargoList(unit){return[...(unit?.cargo||[])]}
  function canLoadCargo(unit,payload){
    const profile=cargoProfile(unit);if(!profile||!payload)return false;
    const capacity=Math.max(0,Number(profile.capacity||0));if((unit.cargo||[]).length>=capacity)return false;
    const type=String(payload.type||payload.kind||"").toUpperCase(),allowed=(profile.payloadTypes||[]).map(value=>String(value).toUpperCase());
    return !allowed.length||allowed.includes(type);
  }
  function loadCargo(unit,payload){if(!canLoadCargo(unit,payload))return false;unit.cargo??=[];unit.cargo.push(payload);return true}
  function unloadCargo(unit,payloadId=null){if(!unit?.cargo?.length)return null;const index=payloadId==null?0:unit.cargo.findIndex(payload=>payload?.id===payloadId);if(index<0)return null;return unit.cargo.splice(index,1)[0]||null}
  function transferCargo(from,to,payloadId=null){
    if(!from?.alive||!to?.alive)return false;const index=payloadId==null?0:(from.cargo||[]).findIndex(payload=>payload?.id===payloadId);
    if(index<0||!from?.cargo?.[index]||!canLoadCargo(to,from.cargo[index]))return false;
    const payload=from.cargo.splice(index,1)[0];to.cargo??=[];to.cargo.push(payload);return true;
  }
  return Object.freeze({MANA_BASE,MANA_INT_FACTOR,MANA_WIL_FACTOR,maxManaFromAttributes,maxMana,syncMana,restoreMana,manaCost,extraResourceRules,syncResources,resourceSnapshot,resourceCosts,createSkillResources,resolveCharacter,create,createFromCard,syncLiveRoster,reconcileCompanions,despawnCompanionsForOwner,living,turnActors,resetActions,allFinished,resourceFor,canUseSkill,consumeSkill,resourceLabel,applyResourceScaling,targetType,getLiveUnit,rotateFacing,setFacing,flightControl,adjustFlightAltitude,cargoProfile,cargoList,canLoadCargo,loadCargo,unloadCargo,transferCargo});
})();
globalThis.UnitRuntimeEngine=UnitRuntimeEngine;
