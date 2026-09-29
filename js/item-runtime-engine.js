export const ItemRuntimeEngine=(()=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  function cargoAcceptsItem(unit){const profile=unit?.character?.cargo;if(!profile)return false;const allowed=(profile.payloadTypes||[]).map(v=>String(v).toUpperCase());return !allowed.length||allowed.includes("ITEM")}
  function storageKind(unit){return unit?.unitRole==="COMPANION"&&cargoAcceptsItem(unit)?"CARGO":"INVENTORY"}
  function inventoryCapacity(unit){return Math.max(0,Math.floor(Number(unit?.character?.inventorySlots??ItemDatabase.RULES.defaultBattleSlots??3)))}
  function container(unit){if(storageKind(unit)==="CARGO"){unit.cargo??=[];return unit.cargo}unit.inventory??=[];return unit.inventory}
  function capacity(unit){if(storageKind(unit)==="CARGO")return Math.max(0,Math.floor(Number(unit?.character?.cargo?.capacity||0)));return inventoryCapacity(unit)}
  function list(unit){return container(unit).filter(payload=>payload?.itemId&&ItemDatabase.get(payload.itemId)).map(payload=>({payload,item:ItemDatabase.get(payload.itemId)}))}
  function canAdd(unit,itemId){return !!unit?.alive&&!!ItemDatabase.get(itemId)&&container(unit).length<capacity(unit)}
  function addPayload(unit,payload){if(!unit?.alive||!payload?.itemId||!ItemDatabase.get(payload.itemId)||container(unit).length>=capacity(unit))return false;container(unit).push(payload);return true}
  function addItem(unit,itemId,{owned=false,source="DEBUG"}={}){if(!canAdd(unit,itemId))return null;const payload=ItemInventoryEngine.makePayload(itemId,{owned,source});if(!payload)return null;container(unit).push(payload);return payload}
  function initializeUnitInventory(unit,itemIds=[],{owned=true,source="PREPARATION"}={}){for(const itemId of itemIds||[])if(canAdd(unit,itemId))addItem(unit,itemId,{owned,source});return list(unit)}
  function findPayload(unit,payloadOrItemId){const all=container(unit);return all.find(p=>p.id===payloadOrItemId)||all.find(p=>p.itemId===payloadOrItemId)||null}
  function removePayload(unit,payloadOrItemId,{removeEffects=true}={}){const all=container(unit),index=all.findIndex(p=>p.id===payloadOrItemId||p.itemId===payloadOrItemId);if(index<0)return null;const payload=all.splice(index,1)[0]||null;if(payload&&removeEffects)removeItemEffects(unit,payload.itemId,payload.id);return payload}
  function removeItemEffects(unit,itemId,payloadId=null){if(!unit?.effects)return;const before=unit.effects.length;unit.effects=unit.effects.filter(effect=>payloadId?effect?.sourcePayloadId!==payloadId:effect?.sourceItemId!==itemId);if(before!==unit.effects.length)globalThis.EffectEngine?.syncModifiers?.(unit)}
  function effectWaterRules(unit){const out={breathing:false,waterWalk:false,preventSinking:false};for(const effect of globalThis.EffectEngine?.state?.(unit)||[]){const r=effect?.waterRules;if(!r)continue;out.breathing=out.breathing||r.breathing===true;out.waterWalk=out.waterWalk||r.waterWalk===true;out.preventSinking=out.preventSinking||r.preventSinking===true;}return out}
  function movementRules(unit){const out={};for(const effect of globalThis.EffectEngine?.state?.(unit)||[]){const r=effect?.movementRules;if(!r)continue;for(const[k,v]of Object.entries(r))if(v!=null)out[k]=v;}return out}
  function visionBonus(unit){return(globalThis.EffectEngine?.state?.(unit)||[]).reduce((sum,effect)=>sum+Number(effect?.visionBonus||0),0)}
  function applyItemEffect(unit,effect,item,payload=null){
    if(effect?.type==="STEALTH"){const stealth={...clone(effect),id:effect.id||`ITEM_${item.id}_STEALTH`,type:"STEALTH",classification:effect.classification||"POSITIVE"};if(globalThis.EffectEngine?.addEffect)return EffectEngine.addEffect(unit,stealth,unit);return globalThis.EffectEngine?.applyStealth?.(unit,{id:stealth.id,detectionRange:Number(stealth.detectionRange??1),source:unit});}
    if(!globalThis.EffectEngine?.apply)return{applied:false,reason:"EFFECT_ENGINE_UNAVAILABLE"};
    const prepared={...clone(effect)};if(prepared.type==="BUFF"){if(!prepared.sourceItemId)prepared.sourceItemId=item.id;if(payload?.id&&!prepared.sourcePayloadId)prepared.sourcePayloadId=payload.id;}return EffectEngine.apply({source:unit,target:unit,effect:prepared});
  }
  function canUse(unit,payloadOrItemId){
    const payload=findPayload(unit,payloadOrItemId),item=payload&&ItemDatabase.get(payload.itemId);if(!unit?.alive||!payload||!item?.use)return false;
    for(const effect of item.use.effects||[]){
      if(effect.type==="HEAL"&&Number(unit.hp)>=Number(unit.character?.combat?.hp||0))return false;
      if(effect.type==="RESTORE_MANA"&&(Number(unit.maxMana||0)<=0||Number(unit.mana||0)>=Number(unit.maxMana||0)))return false;
    }
    return true;
  }
  function use(unit,payloadOrItemId){
    const payload=findPayload(unit,payloadOrItemId),item=payload&&ItemDatabase.get(payload.itemId);if(!canUse(unit,payloadOrItemId))return{ok:false,reason:"CANNOT_USE"};
    const results=(item.use.effects||[]).map(effect=>applyItemEffect(unit,effect,item,payload));
    if(item.use.consume===true){const removed=removePayload(unit,payload.id,{removeEffects:false});if(removed?.owned)ItemInventoryEngine.consumeOwned(removed.itemId,1);}
    return{ok:true,item,payload,results,consumeAction:item.use.actionCost!=="FREE"};
  }
  function resolveTrigger(unit,event,context={}){
    for(const {payload,item} of list(unit))for(const trigger of item.triggers||[]){
      if(String(trigger.event)!==String(event))continue;
      const result={ok:true,item,payload,event,preventDamage:false,effects:[]};
      for(const effect of trigger.effects||[]){if(effect.type==="PREVENT_DAMAGE")result.preventDamage=true;else result.effects.push(applyItemEffect(unit,effect,item,payload));}
      if(trigger.consume===true){const removed=removePayload(unit,payload.id,{removeEffects:false});if(removed?.owned)ItemInventoryEngine.consumeOwned(removed.itemId,1);result.consumed=true;}
      return result;
    }
    return{ok:false,event};
  }
  function distance(a,b){return Math.abs(Number(a?.x)-Number(b?.x))+Math.abs(Number(a?.y)-Number(b?.y))}
  function interactionAvailable(unit){return !!unit?.alive&&Number(unit.itemInteractionUsed||0)<Math.max(0,Number(ItemDatabase.RULES.itemInteractionPerTurn||1))}
  function spendInteraction(unit){unit.itemInteractionUsed=Number(unit.itemInteractionUsed||0)+1}
  function transfer(from,to,payloadOrItemId){
    if(!interactionAvailable(from)||!to?.alive||from.team!==to.team||distance(from,to)>1)return{ok:false,reason:"INVALID_TRANSFER"};
    const payload=findPayload(from,payloadOrItemId);if(!payload||container(to).length>=capacity(to))return{ok:false,reason:"NO_CAPACITY"};
    const moved=removePayload(from,payload.id);if(!moved)return{ok:false,reason:"NOT_FOUND"};container(to).push(moved);spendInteraction(from);return{ok:true,payload:moved,to};
  }
  function drop(unit,payloadOrItemId){
    if(!interactionAvailable(unit))return{ok:false,reason:"NO_INTERACTION"};const payload=removePayload(unit,payloadOrItemId);if(!payload)return{ok:false,reason:"NOT_FOUND"};
    const ground=ItemInventoryEngine.dropPayload(payload,unit.x,unit.y);spendInteraction(unit);return{ok:true,payload,ground};
  }
  function pickup(unit,groundId){
    if(!interactionAvailable(unit))return{ok:false,reason:"NO_INTERACTION"};if(container(unit).length>=capacity(unit))return{ok:false,reason:"NO_CAPACITY"};
    const payload=ItemInventoryEngine.takeGround(groundId,unit.x,unit.y);if(!payload)return{ok:false,reason:"NOT_FOUND"};container(unit).push(payload);spendInteraction(unit);return{ok:true,payload};
  }
  return Object.freeze({storageKind,inventoryCapacity,capacity,list,canAdd,addPayload,addItem,initializeUnitInventory,findPayload,removePayload,removeItemEffects,effectWaterRules,movementRules,visionBonus,canUse,use,resolveTrigger,interactionAvailable,transfer,drop,pickup});
})();

globalThis.ItemRuntimeEngine=ItemRuntimeEngine;
