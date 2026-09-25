export const PackEngine=(()=>{
  const pick=(pool,rng)=>{
    const list=(pool||[]).filter(id=>CardDatabase.get(id));
    return list.length?list[Math.floor(rng()*list.length)]:null;
  };
  const many=(pool,count,rng)=>Array.from({length:count},()=>pick(pool,rng)).filter(Boolean);
  function openFaction(pack,rng){
    const result=[];
    result.push(...many(pack.pools.basic,pack.slots.basic,rng));
    result.push(...many(pack.pools.mid,pack.slots.mid,rng));
    const spellPool=(pack.pools.factionSpell||[]).filter(id=>CardDatabase.get(id));
    const spellFallback=spellPool.length?spellPool:(pack.fallback||[]);
    result.push(...many(spellFallback,pack.slots.factionSpell,rng));
    for(let i=0;i<pack.slots.advancedRolls;i++){
      const high=rng()<Number(pack.advancedChance||0);
      result.push(pick(high?pack.pools.advanced:(pack.fallback||[]),rng));
    }
    while(result.length<15)result.push(pick(pack.fallback||pack.pools.basic,rng));
    result.splice(15);
    if(rng()<Number(pack.heroBonusChance||0)){
      const hero=pick(pack.pools.hero,rng);
      if(hero){
        const basicSet=new Set(pack.pools.basic||[]);
        const replace=result.findIndex(id=>basicSet.has(id));
        result[replace>=0?replace:0]=hero;
      }
    }
    return result.filter(Boolean);
  }
  function open(id,rng=Math.random){
    const pack=PackDatabase.product(id);
    if(!pack)return {ok:false,reason:"UNKNOWN_PACK",cards:[]};
    let cards=[];
    if(pack.kind==="FACTION")cards=openFaction(pack,rng);
    else if(pack.kind==="MAGIC")cards=many(pack.pool,Number(pack.count||15),rng);
    else if(pack.kind==="SUPPLEMENT")cards=[...(pack.cards||[])].filter(id=>CardDatabase.get(id));
    else return {ok:false,reason:"UNSUPPORTED_PACK_KIND",cards:[]};
    return {ok:true,packId:pack.id,kind:pack.kind,cards};
  }
  return {open};
})();
globalThis.PackEngine=PackEngine;
