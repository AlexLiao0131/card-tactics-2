export const RewardEngine=(()=>{
  // A victim owns one finite battle loot entitlement. Theft transfers existing
  // inventory and unclaimed kill-gold; defeating the same victim only pays
  // the remaining amount. No new gold source or randomly generated item.
  function lootState(unit){
    // The unit's battle state owns theft history; one reward authority handles
    // both pickpocketing and subsequent kill payouts.
    if(!unit.lootState)unit.lootState={stolen:false,stolenGold:0};
    return unit.lootState;
  }
  function stealable(thief,target){
    if(!thief?.alive||!target?.alive||thief.team===target.team||lootState(target).stolen)return null;
    const item=globalThis.ItemRuntimeEngine?.list?.(target)?.[0]?.payload||null;
    const availableItem=item&&ItemRuntimeEngine.capacity(thief)>ItemRuntimeEngine.list(thief).length?item:null;
    const gold=thief.team==="P"&&target.team!=="P"?
      Math.max(0,RewardDatabase.killGold(target)-lootState(target).stolenGold):0;
    return gold>0||availableItem?{gold,item:availableItem}:null;
  }
  function stealLoot(thief,target){
    const available=stealable(thief,target);
    if(!available)return{ok:false,reason:"NO_STEALABLE_LOOT"};
    let payload=null;
    if(available.item){
      payload=ItemRuntimeEngine.removePayload(target,available.item.id);
      if(payload&&!ItemRuntimeEngine.addPayload(thief,payload)){
        ItemRuntimeEngine.addPayload(target,payload);return{ok:false,reason:"NO_CAPACITY"};
      }
      if(payload&&thief.team==="P"){
        ItemInventoryEngine.grant(payload.itemId,1);
        payload.owned=true;
        payload.source="STEAL_LOOT";
      }
    }
    if(available.gold){
      lootState(target).stolenGold+=available.gold;
      ItemInventoryEngine.addGold(available.gold);
    }
    lootState(target).stolen=true;
    return{ok:true,gold:available.gold,itemId:payload?.itemId||null};
  }
  function resolveDefeat(unit,source,cause=null){
    if(!unit||unit._goldRewardResolved)return{ok:false,reason:"ALREADY_RESOLVED"};
    if(source?.team!=="P"||unit.team==="P")return{ok:false,reason:"NOT_PLAYER_KILL"};
    unit._goldRewardResolved=true;const amount=Math.max(0,RewardDatabase.killGold(unit)-lootState(unit).stolenGold);if(amount<=0)return{ok:false,reason:"NO_GOLD"};
    const total=ItemInventoryEngine.addGold(amount);return{ok:true,amount,total,unitId:unit.id,cause:cause?.type||cause?.id||null};
  }
  return Object.freeze({resolveDefeat,stealable,stealLoot});
})();

globalThis.RewardEngine=RewardEngine;
