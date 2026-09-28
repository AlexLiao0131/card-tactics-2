(()=>{
  const F="SEA_WORLD";

  Object.assign(EQUIPMENT,{
    nereia_royal_trident:{
      id:"nereia_royal_trident",name:"王海三叉戟",kind:"WEAPON",weaponKind:"TRIDENT",
      attackType:"PIERCE",element:"NONE",affixes:[]
    },
    nereia_scale_battle_suit:{
      id:"nereia_scale_battle_suit",name:"深海鱗甲戰衣",kind:"ARMOR",
      type:"MEDIUM",types:["MEDIUM"],element:"NONE",affixes:[]
    }
  });

  Object.assign(PASSIVES,{
    DEEP_SEA_PHYSIQUE:{
      id:"DEEP_SEA_PHYSIQUE",name:"深海體魄",category:"PASSIVE",
      description:"能承受深海水壓的異常強韌體魄。受到近戰傷害降低 30%。",
      damageTakenRules:[{attackClass:"MELEE",multiplier:.70}]
    },
    SEA_SOVEREIGN:{
      id:"SEA_SOVEREIGN",name:"王者",category:"PASSIVE",
      description:"海世界女王的支配權。可直接控制深潭巨章，並在不擊敗牠的情況下取得其洪水卡牌。",
      encounterDominion:{monsterIds:["water_lurker"],fromTeams:["N"],grantEncounterRewards:true}
    }
  });

  Object.assign(SKILLS,{
    nereia_trident_thrust:{
      id:"nereia_trident_thrust",name:"三叉戟突刺",category:"ATTACK",weapon:"trident",
      power:1.10,range:{min:1,max:2},attackType:"PIERCE",element:"INHERIT",speed:0,
      target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]
    },
    nereia_water_bullet:{
      id:"nereia_water_bullet",name:"水彈",category:"MAGIC",weapon:"trident",
      power:1.05,range:{min:2,max:4},attackType:"MAGIC",element:"WATER",speed:0,
      target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]
    },
    nereia_tsunami:{
      id:"nereia_tsunami",name:"海嘯",category:"MAGIC",weapon:"trident",power:0,
      range:{min:2,max:5},target:"TILE",targetType:"AOE",radius:2,speed:-10,
      support:false,resource:{type:"USES",max:2},requiresVision:true,
      hydrologyFlood:{surfaceRise:1.25},affixes:["WATER_TERRAIN_CONTROL"]
    }
  });

  const raw={
    id:"nereia",name:"涅瑞雅",title:"深海女王",race:"AQUATIC",faction:F,
    visualId:"nereia_default",archetype:"AQUATIC_DEFENDER",genetics:{grade:"4V"},
    attributes:{str:20,agi:14,int:20,wil:20,vit:20,luk:12},
    combat:{hp:300,atk:100,matk:100,def:82,mdef:96,move:4},
    armorId:"nereia_scale_battle_suit",weaponIds:{trident:"nereia_royal_trident"},equipmentIds:[],
    terrainTraits:["AQUATIC","AMPHIBIOUS","DIVING"],
    movementProfile:{waterCost:2/3},
    verticalMobility:{modes:["SWIMMING","DIVING"],canDive:true,surfaceImmersion:.7,diveDepth:1.5,maxDiveDepth:6},
    passives:["DEEP_SEA_PHYSIQUE","SEA_SOVEREIGN"],
    skills:["nereia_trident_thrust","nereia_water_bullet","nereia_tsunami"],
    lore:{genetics:"4V",role:"海世界女王／水域坦克",notes:"STR、INT、WIL、VIT 為 V。能承受深海水壓，在水域擁有遠高於陸地的機動力。"}
  };

  CHARACTERS.nereia=EquipmentDatabase.resolveCharacter(raw);
  CARDS.nereia_card={id:"nereia_card",name:"深海女王・涅瑞雅",type:"CHARACTER",characterId:"nereia",faction:F,unitType:"HERO",cost:6,pack:"SEA_WORLD_SUPPLEMENT"};
})();
