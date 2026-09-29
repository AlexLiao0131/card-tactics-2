export const RewardEngine=(()=>{
  function resolveDefeat(unit,source,cause=null){
    if(!unit||unit._goldRewardResolved)return{ok:false,reason:"ALREADY_RESOLVED"};
    if(source?.team!=="P"||unit.team==="P")return{ok:false,reason:"NOT_PLAYER_KILL"};
    unit._goldRewardResolved=true;const amount=RewardDatabase.killGold(unit);if(amount<=0)return{ok:false,reason:"NO_GOLD"};
    const total=ItemInventoryEngine.addGold(amount);return{ok:true,amount,total,unitId:unit.id,cause:cause?.type||cause?.id||null};
  }
  return Object.freeze({resolveDefeat});
})();

globalThis.RewardEngine=RewardEngine;
