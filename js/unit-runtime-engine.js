export function createUnitRuntimeEngine(){
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
  function drainMana(unit,amount){
    syncMana(unit);
    const before=Math.max(0,Number(unit?.mana||0));
    const spent=Math.min(before,Math.max(0,Math.round(Number(amount||0))));
    if(unit)unit.mana=before-spent;
    return spent;
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
  // Official generalized extra-resource change: only authored character resources can change.
  function changeResource(unit,key,delta){
    if(!unit||typeof key!=="string"||!Number.isFinite(Number(delta))||!extraResourceRules(unit)[key])return 0;
    syncResources(unit);
    const entry=unit.resources[key],before=Number(entry.value||0);
    entry.value=Math.max(0,Math.min(entry.max,before+Number(delta)));
    if(entry.value!==before)globalThis.EffectEngine?.syncModifiers?.(unit);
    return entry.value-before;
  }
  // All battle modes read these same passive balance values and the same real Sanity resource.
  function sanityMisfireChance(unit,skill){
    if(!unit?.alive||!(Number(skill?.power||0)>0)||
       !(skill.attackType==="MAGIC"||skill.areaDamage?.mode==="MAGIC_POWER"))return 0;
    const rule=globalThis.SkillDatabase?.passiveList?.(unit.character?.passives||[])
      .find(passive=>passive.sanityMisfire)?.sanityMisfire;
    if(!rule||!extraResourceRules(unit).sanity)return 0;
    syncResources(unit);
    const state=unit.resources.sanity,max=Math.max(1,Number(state.max||0));
    const depleted=1-Math.max(0,Math.min(1,Number(state.value||0)/max));
    return Math.max(0,Math.min(1,depleted*Number(rule.maxChance||0)));
  }
  function rollSanityMisfire(unit,skill,random=Math.random){
    const chance=sanityMisfireChance(unit,skill);
    return chance>0&&random()<chance;
  }
  function sanityBacklashRefund(unit,spent,friendlyHpLoss){
    const rule=globalThis.SkillDatabase?.passiveList?.(unit?.character?.passives||[])
      .find(passive=>passive.friendlyFireManaReturn)?.friendlyFireManaReturn;
    if(!rule||!(friendlyHpLoss>0)||!spent)return 0;
    const amount=Math.min(Math.max(0,Number(spent.cost||0)),
      Math.floor(Math.max(0,Number(friendlyHpLoss))*Math.max(0,Number(rule.hpLossRatio||0))));
    return amount>0?restoreMana(unit,amount):0;
  }
  function humidityValue(unit){
    if(!unit?.character?.resourceRules?.humidity)return null;
    syncResources(unit);
    return Number(unit.resources.humidity.value||0);
  }
  function changeHumidity(unit,delta){
    if(!unit?.character?.resourceRules?.humidity||!Number.isFinite(Number(delta)))return 0;
    syncResources(unit);
    const entry=unit.resources.humidity,before=Number(entry.value||0);
    entry.value=Math.max(0,Math.min(entry.max,before+Number(delta)));
    if(before!==entry.value)globalThis.EffectEngine?.syncModifiers?.(unit);
    return entry.value-before;
  }
  function humidityMdefBonus(unit){
    const humidity=humidityValue(unit),rule=unit?.character?.resourceRules?.humidity;
    if(humidity===null||!rule)return 0;
    const base=Number(unit._effectBaseCombat?.mdef??unit.character?.combat?.mdef??0);
    return Math.round(base*Math.max(0,Number(rule.magicDefenseMaxBonus||0))*humidity/Math.max(1,Number(rule.max||100)));
  }
  function advanceHumidity(unit,tile,environmentState){
    if(!unit?.alive||!unit?.character?.resourceRules?.humidity||!environmentState)return 0;
    const weather=globalThis.EnvironmentEngine?.legacyWeather?.(environmentState)||"CLEAR";
    const weatherDelta={CLEAR:0,FOG:3,RAIN:5,HEAVY_RAIN:10,THUNDERSTORM:10,TYPHOON:12,SNOW:3,BLIZZARD:5,SCORCHING_SUN:-8};
    const depth=Math.max(0,Number(globalThis.HydrologyEngine?.waterDepth?.(tile)||0));
    return changeHumidity(unit,Number(weatherDelta[weather]||0)+(depth>=2?10:depth>0?5:0));
  }
  function skillManaCost(unit,skill){
    const base=manaCost(skill),rule=unit?.character?.resourceRules?.humidity;
    if(!base||!skill?.waterMagic||!rule)return base;
    const humidity=humidityValue(unit);
    return Math.max(1,Math.ceil(base*(1-Math.max(0,Number(rule.waterManaDiscountMax||0))*humidity/Math.max(1,Number(rule.max||100)))));
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
  // Blood is an ordinary extra resource; a 5V awakening is a state transition, not a timed buff.
  const bloodUser=u=>!!u?.character?.resourceRules?.blood;
  function bloodValue(unit){syncResources(unit);return Math.max(0,Number(unit?.resources?.blood?.value||0))}
  function reconcileBlood(unit){
    if(!bloodUser(unit))return;
    const amount=bloodValue(unit),was=!!unit._bloodAwakened;
    if(amount>=Number(unit.resources.blood.max))unit._bloodAwakened=true;
    else if(amount<=0&&!(unit._bloodTransactionDepth>0))unit._bloodAwakened=false;
    if(was!==!!unit._bloodAwakened)globalThis.EffectEngine?.syncModifiers?.(unit);
  }
  function changeBlood(unit,delta){
    if(!bloodUser(unit)||!Number.isFinite(Number(delta)))return 0;
    const before=bloodValue(unit),r=unit.resources.blood;
    r.value=Math.min(r.max,Math.max(0,before+Number(delta)));
    reconcileBlood(unit);
    return r.value-before;
  }
  function beginBloodTransaction(unit){if(!bloodUser(unit))return;unit._bloodTransactionDepth=(unit._bloodTransactionDepth||0)+1}
  function endBloodTransaction(unit){if(!bloodUser(unit))return;unit._bloodTransactionDepth=Math.max(0,(unit._bloodTransactionDepth||0)-1);reconcileBlood(unit)}
  function attackEnhancement(unit,skill){
    if(!bloodUser(unit)||!unit._bloodAwakened||!skill||!(skill.attackType||skill.category==="ATTACK"))return 1;
    const spent=Math.min(15,bloodValue(unit));changeBlood(unit,-spent);
    return 1+spent/100;
  }
  function isBloodMemory(unit,skill){return bloodUser(unit)&&!!skill?.id&&(unit.grantedSkills||[]).some(g=>g.skillId===skill.id&&g.bloodMemory===true)}
  function bloodMemoryCost(skill){return manaCost(skill)+Object.values(resourceCosts(skill)).reduce((sum,v)=>sum+v,0)}
  function skillForUnit(unit,skill){
    if(!skill||skill._bloodMemory||!isBloodMemory(unit,skill))return skill;
    if(skill.weapon&&!unit.character.weapons?.[skill.weapon]){
      const reference=unit.character.weapons?.rapier||{};
      unit.character.weapons??={};
      unit.character.weapons[skill.weapon]={...reference,affixes:[],inherentMagic:null,attackType:skill.attackType||reference.attackType,weaponKind:skill.weapon.toUpperCase()};
    }
    return {...skill,manaCost:0,resourceCosts:{blood:bloodMemoryCost(skill)},_bloodMemory:true,
      description:`【血術重現】原技能消耗合計 ${bloodMemoryCost(skill)} 點，改由血能支付。\n${skill.description||"依照原技能的合法目標、範圍與效果重現。"}`};
  }
  function changeHolyPower(unit,delta){
    if(!unit?.character?.resourceRules?.holyPower||!Number.isFinite(Number(delta)))return 0;
    syncResources(unit);const r=unit.resources.holyPower,before=r.value;
    r.value=Math.max(0,Math.min(r.max,before+Number(delta)));
    return r.value-before;
  }
  const faithUser=unit=>!!unit?.character?.resourceRules?.faith;
  function faithValue(unit){syncResources(unit);return faithUser(unit)?Number(unit.resources.faith.value):null;}
  function changeFaith(unit,delta){
    if(!faithUser(unit)||!Number.isFinite(Number(delta)))return 0;
    syncResources(unit);const resource=unit.resources.faith,before=resource.value;
    resource.value=Math.max(0,Math.min(resource.max,before+Number(delta)));
    return resource.value-before;
  }
  function criticalManaRefund(unit,skill,spent,critical){
    if(!critical||!spent||!unit?.alive)return 0;
    const rule=SkillDatabase.passiveList(unit.character?.passives||[]).map(p=>p.criticalManaRefund)
      .find(r=>r?.skillIds?.includes(skill?.id));
    if(!rule)return 0;
    return restoreMana(unit,Number(spent.cost||0)*Number(rule.ratio||0));
  }
  function createSkillResources(){return{}}
  // Initial deployment uses the stage's actual opposing Core, not a fixed
  // compass direction. The tactical facing state remains the sole authority:
  // movement, attacks and player rotations can change it after spawn.
  function initialFacingTarget(team,cores){
    const opponent=team==="P"||team==="PLAYER"?"ENEMY":
      team==="E"||team==="ENEMY"?"PLAYER":null;
    if(!opponent)return null;
    return(cores||[]).find(core=>core?.owner===opponent&&
      Number.isFinite(Number(core.x))&&Number.isFinite(Number(core.y)))||null;
  }
  function createFromResolvedCharacter({id,team,character,x,y,map,cores=null}){
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
    syncMana(unit,{initialize:true});syncResources(unit,{initialize:true});if(unit.character.resourceRules?.humidity)globalThis.EffectEngine?.syncModifiers?.(unit);reconcileBlood(unit);
    const target=initialFacingTarget(team,cores??globalThis.CardTacticsRuntime?.getCores?.());
    if(target)TacticalEngine.faceToward(unit,target);
    else TacticalEngine.ensureFacing(unit);
    liveUnits.set(unit.id,unit);
    return unit;
  }
  function resolveCharacter(characterId,loadoutId=null){return LoadoutDatabase.resolveCharacter(characterId,loadoutId)}
  function create({id,team,characterId,loadoutId=null,x,y,map,cores=null}){
    const character=resolveCharacter(characterId,loadoutId);if(!character)return null;
    return createFromResolvedCharacter({id,team,character,x,y,map,cores});
  }
  function createFromCard({id,team,card,x,y,map,itemIds=[],cores=null}){
    if(!CardDatabase.isCharacter(card))return null;
    const unit=create({id,team,characterId:card.characterId,loadoutId:card.loadoutId,x,y,map,cores});
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
  function resetActions(units,team){reconcileCompanions(units);turnActors(units,team).forEach(u=>{u.moved=false;u.acted=false;u.waited=false;u.itemInteractionUsed=0;syncMana(u);syncResources(u,{applyRecovery:true});reconcileBlood(u);})}
  function allFinished(units,team){reconcileCompanions(units);const actors=turnActors(units,team);return actors.length>0&&actors.every(u=>u.acted)}
  function resourceFor(unit,skill){
    skill=skillForUnit(unit,skill);
    if(skill?.sanctuary&&faithValue(unit)===unit?.resources?.faith?.max)skill={...skill,manaCost:0};
    syncMana(unit);syncResources(unit);
    const extras=resourceCosts(skill);
    return{type:Object.keys(extras).length?"MULTI":"MANA",cost:skillManaCost(unit,skill),remaining:Math.max(0,Number(unit?.mana||0)),max:Number(unit?.maxMana||0),resources:Object.fromEntries(Object.entries(extras).map(([key,cost])=>[key,{cost,remaining:Number(unit.resources?.[key]?.value||0),max:Number(unit.resources?.[key]?.max||0)}]))};
  }
  function canUseSkill(unit,skill,world=null){
    if(skill?.sanctuary){
      const value=faithValue(unit),maximum=unit?.resources?.faith?.max;
      if(value===null||(value!==0&&value!==maximum))return false;
    }
    if(isBloodMemory(unit,skill)&&!unit._bloodAwakened)return false;
    skill=skillForUnit(unit,skill);
    if(skill?.bloodBurst&&!globalThis.EffectEngine?.bloodBurstCenters?.(unit,knownUnits(),skill,world).length)return false;
    if(skill?.approach&&unit?.moved)return false;
    if(skill?.sanctuary&&faithValue(unit)===unit?.resources?.faith?.max)skill={...skill,manaCost:0};
    const req=skill?.requirements||{};
    if(req.carrying===true&&!unit?.carryingUnitId)return false;
    if(req.notCarrying===true&&!!unit?.carryingUnitId)return false;
    if(req.notMoved===true&&!!unit?.moved)return false;
    if(req.diving===true&&String(unit?.verticalState?.mode||"")!=="DIVING")return false;
    if(req.flying===true&&String(unit?.verticalState?.mode||"")!=="FLYING")return false;
    if(req.water===true){const runtimeMap=unit?._runtimeMap||globalThis.CardTacticsRuntime?.getBattleMap?.(),tile=runtimeMap?.tiles?.find(t=>t.x===unit?.x&&t.y===unit?.y);if(!tile||Number(globalThis.HydrologyEngine?.waterDepth?.(tile)||0)<=0)return false;}
    syncMana(unit);syncResources(unit);
    if(unit.mana<skillManaCost(unit,skill))return false;
    for(const[key,cost]of Object.entries(resourceCosts(skill))){const rule=extraResourceRules(unit)[key];if(!rule)return false;if(rule.allowOverdraft!==true&&Number(unit.resources?.[key]?.value||0)<cost)return false;}
    return true;
  }
  function consumeSkill(unit,skill,world=null){
    if(!canUseSkill(unit,skill,world))return null;
    skill=skillForUnit(unit,skill);
    if(skill?.sanctuary&&faithValue(unit)===unit?.resources?.faith?.max)skill={...skill,manaCost:0};
    const mana=skillManaCost(unit,skill);unit.mana=Math.max(0,unit.mana-mana);
    const spent={};for(const[key,cost]of Object.entries(resourceCosts(skill))){const state=unit.resources[key];if(!state)continue;state.value=Math.max(0,Number(state.value||0)-cost);if(key==="blood")reconcileBlood(unit);spent[key]={cost,remaining:state.value,max:state.max};}
    return{type:Object.keys(spent).length?"MULTI":"MANA",cost:mana,remaining:unit.mana,max:unit.maxMana,resources:spent};
  }
  function resourceLabel(unit,skill){
    skill=skillForUnit(unit,skill);
    if(skill?.sanctuary&&faithValue(unit)===unit?.resources?.faith?.max)skill={...skill,manaCost:0};
    syncMana(unit);syncResources(unit);const labels=[],mana=skillManaCost(unit,skill);if(mana>0)labels.push(`MP ${mana}`);
    for(const[key,cost]of Object.entries(resourceCosts(skill))){const rule=extraResourceRules(unit)[key]||{},prefix=String(rule.costMode||"").toUpperCase()==="DRAIN"?"-":"";labels.push(`${resourceLabelFor(key,rule)} ${prefix}${cost}`);}
    return labels.length?labels.join(" / "):"無消耗";
  }
  function applyResourceScaling(unit,skill){
    skill=skillForUnit(unit,skill);
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
  function knownUnits(){return [...liveUnits.values()]}
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
  function diveControl(id){
    const unit=getLiveUnit(id),vertical=globalThis.VerticalMobilityEngine;
    if(!unit?.alive||!vertical?.capabilities?.(unit)?.canDive)return null;
    const tile=unit._runtimeMap?.tiles?.find(t=>t.x===unit.x&&t.y===unit.y)||null;
    if(!tile||vertical.waterDepth(tile)<=0)return null;
    const state=vertical.describe(unit,tile);
    return {mode:state.mode,depth:state.depth,maxDepth:state.waterDepth,
      canDive:state.mode!=="DIVING"&&state.waterDepth>=vertical.bodyHeight(unit),
      canSurface:state.mode==="DIVING"};
  }
  function adjustDiveMode(id,steps){
    if(![-1,1].includes(steps))return null;
    const unit=getLiveUnit(id),control=diveControl(id),vertical=globalThis.VerticalMobilityEngine;
    if(!unit||!control||(steps<0?!control.canDive:!control.canSurface))return null;
    const tile=unit._runtimeMap?.tiles?.find(t=>t.x===unit.x&&t.y===unit.y)||null;
    const desired=steps<0?"DIVING":"SWIMMING";
    const result=vertical.setMode(unit,tile,desired);
    return result?.ok&&result.state?.mode===desired?result.state:null;
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
  return Object.freeze({drainMana,knownUnits,changeHolyPower,faithUser,faithValue,changeFaith,criticalManaRefund,bloodUser,bloodValue,changeBlood,reconcileBlood,beginBloodTransaction,endBloodTransaction,attackEnhancement,isBloodMemory,bloodMemoryCost,skillForUnit,MANA_BASE,MANA_INT_FACTOR,MANA_WIL_FACTOR,changeResource,sanityMisfireChance,rollSanityMisfire,sanityBacklashRefund,humidityValue,changeHumidity,advanceHumidity,humidityMdefBonus,skillManaCost,maxManaFromAttributes,maxMana,syncMana,restoreMana,manaCost,extraResourceRules,syncResources,resourceSnapshot,resourceCosts,createSkillResources,resolveCharacter,create,createFromCard,syncLiveRoster,reconcileCompanions,despawnCompanionsForOwner,living,turnActors,resetActions,allFinished,resourceFor,canUseSkill,consumeSkill,resourceLabel,applyResourceScaling,targetType,getLiveUnit,rotateFacing,setFacing,flightControl,adjustFlightAltitude,diveControl,adjustDiveMode,cargoProfile,cargoList,canLoadCargo,loadCargo,unloadCargo,transferCargo});
}
export const UnitRuntimeEngine=createUnitRuntimeEngine();
globalThis.UnitRuntimeEngine=UnitRuntimeEngine;
