export const RewardEngine=(()=>{
  // An authoritative PvP command runs inside this *synchronous* room scope.
  // Offline mode still uses the existing persistent ItemInventoryEngine.
  // The room records gold entitlements but never mints profile gold or items.
  let match=null;
  function withMatchRewards(room,callback){
    if(!room||typeof room!=="object"||typeof callback!=="function")throw Error("INVALID_MATCH_REWARD_SCOPE");
    const previous=match;
    try {
      match=room;
      const result=callback();
      return result;
    } finally {match=previous;}
  }
  function roomLedger(){
    if(!match)return null;
    return match.matchRewards??=( {goldByTeam:{P:0,E:0},receipts:[]} );
  }
  function awardGold(team,gold,kind,target,source,itemId=null){
    if(!match)return ItemInventoryEngine.addGold(gold);
    const ledger=roomLedger();
    if(!['P','E'].includes(team))throw Error('INVALID_REWARD_TEAM');
    ledger.goldByTeam[team]=Number(ledger.goldByTeam[team]||0)+gold;
    ledger.receipts.push({kind,team,targetId:target.id,sourceId:source?.id||null,gold,itemId});
    return ledger.goldByTeam[team];
  }
  // A victim owns one finite battle loot entitlement. Theft transfers existing
  // inventory and unclaimed kill-gold; defeating the same victim only pays
  // the remaining amount. No new gold source or randomly generated item.
  function lootState(unit){
    // The unit's battle state owns theft history; one reward authority handles
    // both pickpocketing and subsequent kill payouts.
    // Projection/target inspection must never mutate authoritative room state.
    return unit.lootState||{stolen:false,stolenGold:0};
  }
  function stealable(thief,target){
    if(!thief?.alive||!target?.alive||thief.team===target.team||lootState(target).stolen)return null;
    const item=globalThis.ItemRuntimeEngine?.list?.(target)?.[0]?.payload||null;
    const availableItem=item&&ItemRuntimeEngine.capacity(thief)>ItemRuntimeEngine.list(thief).length?item:null;
    const gold=(thief.team==="P"||match!=null)&&target.team!==thief.team?
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
      if(payload&&!match&&thief.team==="P"){
        ItemInventoryEngine.grant(payload.itemId,1);
        payload.owned=true;
        payload.source="STEAL_LOOT";
      }
    }
    if(available.gold){
      target.lootState??={stolen:false,stolenGold:0};
      target.lootState.stolenGold+=available.gold;
      awardGold(thief.team,available.gold,"STEAL_LOOT",target,thief,payload?.itemId||null);
    }
    target.lootState??={stolen:false,stolenGold:0};
    target.lootState.stolen=true;
    // Item-only theft still has an audit receipt, without creating assets.
    if(match&&!available.gold)awardGold(thief.team,0,"STEAL_LOOT",target,thief,payload?.itemId||null);
    return{ok:true,gold:available.gold,itemId:payload?.itemId||null};
  }
  function resolveDefeat(unit,source,cause=null){
    if(!unit||unit._goldRewardResolved)return{ok:false,reason:"ALREADY_RESOLVED"};
    if(!['P','E'].includes(source?.team)||source.team===unit.team||(!match&&source.team!=="P"))
      return{ok:false,reason:"NOT_PLAYER_KILL"};
    unit._goldRewardResolved=true;const amount=Math.max(0,RewardDatabase.killGold(unit)-lootState(unit).stolenGold);if(amount<=0)return{ok:false,reason:"NO_GOLD"};
    const total=awardGold(source.team,amount,"DEFEAT",unit,source);return{ok:true,amount,total,unitId:unit.id,cause:cause?.type||cause?.id||null};
  }
  return Object.freeze({resolveDefeat,stealable,stealLoot,withMatchRewards});
})();

globalThis.RewardEngine=RewardEngine;
