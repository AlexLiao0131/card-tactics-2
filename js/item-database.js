export const ITEM_RULES=Object.freeze({
  defaultBattleSlots:3,
  itemInteractionPerTurn:1,
  startingGold:0
});

export const ITEMS=Object.freeze({
  hp_potion_small:Object.freeze({
    id:"hp_potion_small",name:"小型生命藥水",category:"CONSUMABLE",description:"回復 50 HP。",
    shop:Object.freeze({buyPrice:15}),
    use:Object.freeze({target:"SELF",consume:true,actionCost:"ACTION",effects:Object.freeze([{type:"HEAL",amount:50}])})
  }),
  hp_potion_medium:Object.freeze({
    id:"hp_potion_medium",name:"中型生命藥水",category:"CONSUMABLE",description:"回復 100 HP。",
    shop:Object.freeze({buyPrice:30}),
    use:Object.freeze({target:"SELF",consume:true,actionCost:"ACTION",effects:Object.freeze([{type:"HEAL",amount:100}])})
  }),
  hp_potion_large:Object.freeze({
    id:"hp_potion_large",name:"大型生命藥水",category:"CONSUMABLE",description:"回復 180 HP。",
    shop:Object.freeze({buyPrice:55}),
    use:Object.freeze({target:"SELF",consume:true,actionCost:"ACTION",effects:Object.freeze([{type:"HEAL",amount:180}])})
  }),
  mp_potion_small:Object.freeze({
    id:"mp_potion_small",name:"小型魔力藥水",category:"CONSUMABLE",description:"回復 30 MP。",
    shop:Object.freeze({buyPrice:20}),
    use:Object.freeze({target:"SELF",consume:true,actionCost:"ACTION",effects:Object.freeze([{type:"RESTORE_MANA",amount:30}])})
  }),
  mp_potion_medium:Object.freeze({
    id:"mp_potion_medium",name:"中型魔力藥水",category:"CONSUMABLE",description:"回復 60 MP。",
    shop:Object.freeze({buyPrice:40}),
    use:Object.freeze({target:"SELF",consume:true,actionCost:"ACTION",effects:Object.freeze([{type:"RESTORE_MANA",amount:60}])})
  }),
  mp_potion_large:Object.freeze({
    id:"mp_potion_large",name:"大型魔力藥水",category:"CONSUMABLE",description:"回復 100 MP。",
    shop:Object.freeze({buyPrice:70}),
    use:Object.freeze({target:"SELF",consume:true,actionCost:"ACTION",effects:Object.freeze([{type:"RESTORE_MANA",amount:100}])})
  }),
  stealth_potion:Object.freeze({
    id:"stealth_potion",name:"隱身藥水",category:"CONSUMABLE",description:"進入潛行 2 回合；主動攻擊／技能等既有規則仍會解除潛行。",
    shop:Object.freeze({buyPrice:60}),
    use:Object.freeze({target:"SELF",consume:true,actionCost:"ACTION",effects:Object.freeze([{type:"STEALTH",id:"ITEM_STEALTH",duration:2,detectionRange:1}])})
  }),
  underwater_breathing_herb:Object.freeze({
    id:"underwater_breathing_herb",name:"水下呼吸草",category:"CONSUMABLE",description:"4 回合內可在水下呼吸；不會額外賦予游泳或潛水能力。",
    shop:Object.freeze({buyPrice:35}),
    use:Object.freeze({target:"SELF",consume:true,actionCost:"ACTION",effects:Object.freeze([{type:"BUFF",id:"ITEM_UNDERWATER_BREATHING",classification:"POSITIVE",duration:4,waterRules:{breathing:true}}])})
  }),
  angel_feather:Object.freeze({
    id:"angel_feather",name:"天使之羽",category:"PASSIVE_TRIGGER",description:"攜帶時，受到墜落傷害會自動消耗 1 個並防止該次墜落傷害。",
    shop:Object.freeze({buyPrice:50}),
    triggers:Object.freeze([{event:"FALL_DAMAGE",consume:true,effects:Object.freeze([{type:"PREVENT_DAMAGE"}])}])
  }),
  lightning_rod:Object.freeze({
    id:"lightning_rod",name:"避雷針",category:"PASSIVE_TRIGGER",description:"攜帶時，遭受落雷或水體雷電傳導會自動消耗 1 個並防止該次雷電傷害。",
    shop:Object.freeze({buyPrice:45}),
    triggers:Object.freeze([
      {event:"LIGHTNING_DAMAGE",consume:true,effects:Object.freeze([{type:"PREVENT_DAMAGE"}])},
      {event:"ELECTRIC_DAMAGE",consume:true,effects:Object.freeze([{type:"PREVENT_DAMAGE"}])}
    ])
  }),
  canoe:Object.freeze({
    id:"canoe",name:"獨木舟",category:"FIELD_GEAR",description:"啟用後以舟艇狀態在水面移動，不會因游泳疲勞下沉，水域移動成本固定為 1。",
    shop:Object.freeze({buyPrice:80}),
    use:Object.freeze({target:"SELF",consume:false,actionCost:"ACTION",effects:Object.freeze([{type:"BUFF",id:"ITEM_GEAR_CANOE",classification:"POSITIVE",sourceItemId:"canoe",waterRules:{waterWalk:true,preventSinking:true},movementRules:{waterCost:1}}])})
  }),
  torch:Object.freeze({
    id:"torch",name:"火把",category:"FIELD_GEAR",description:"啟用後視野 +3。",
    shop:Object.freeze({buyPrice:25}),
    use:Object.freeze({target:"SELF",consume:false,actionCost:"ACTION",effects:Object.freeze([{type:"BUFF",id:"ITEM_GEAR_TORCH",classification:"POSITIVE",sourceItemId:"torch",visionBonus:3}])})
  })
});

export const ItemDatabase=(()=>{
  function get(id){return ITEMS[String(id)]||null}
  function list(ids=null){return ids?(ids||[]).map(get).filter(Boolean):Object.values(ITEMS)}
  function shopList(){return list().filter(item=>Number.isFinite(Number(item?.shop?.buyPrice)))}
  function price(id){const item=get(id);return item?Math.max(0,Number(item.shop?.buyPrice||0)):null}
  function validate(){
    const allowed=new Set(["CONSUMABLE","PASSIVE_TRIGGER","FIELD_GEAR"]);
    for(const item of list()){
      if(!item.id||!item.name)throw new Error("ItemDatabase item requires id/name.");
      if(!allowed.has(item.category))throw new Error(`ItemDatabase invalid category: ${item.id}`);
      if(item.category==="PASSIVE_TRIGGER"&&!Array.isArray(item.triggers))throw new Error(`ItemDatabase passive trigger missing triggers: ${item.id}`);
      if(item.category!=="PASSIVE_TRIGGER"&&!item.use)throw new Error(`ItemDatabase usable item missing use data: ${item.id}`);
    }
    return true;
  }
  return Object.freeze({RULES:ITEM_RULES,get,list,shopList,price,validate});
})();

globalThis.ITEMS=ITEMS;
globalThis.ItemDatabase=ItemDatabase;
