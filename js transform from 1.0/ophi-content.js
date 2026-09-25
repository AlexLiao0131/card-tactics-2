(()=>{
  // Ophi Supplement Pack — formal content module.
  // Runtime systems read the same global databases as the original content files.
  Object.assign(EQUIPMENT,{
    ophi_elven_bow:{id:"ophi_elven_bow",name:"奧菲的精靈長弓",kind:"WEAPON",weaponKind:"BOW",attackType:"SHOT",element:"NONE",affixes:[]},
    ophi_ranger_sword:{id:"ophi_ranger_sword",name:"精靈遊俠劍",kind:"WEAPON",weaponKind:"SWORD",attackType:"SLASH",element:"NONE",affixes:[],defenseProfiles:[{id:"ophi_sword_parry",method:"PARRY",name:"遊俠劍招架",vs:{SLASH:{chance:70},PIERCE:{chance:65},SHOT:{chance:15},STRIKE:{chance:0},MAGIC:{chance:0}}}]},
    colin_war_hammer:{id:"colin_war_hammer",name:"寇林的戰錘",kind:"WEAPON",weaponKind:"HAMMER",attackType:"STRIKE",element:"NONE",affixes:[]},
    colin_full_body_shield:{
      id:"colin_full_body_shield",name:"寇林的全身大盾",kind:"ACCESSORY",affixes:[],
      defenseProfiles:[{
        id:"colin_full_body_guard",method:"GUARD",name:"全身大盾格擋",canGuardAlly:true,
        vs:{SLASH:{damageMultiplier:.35},PIERCE:{damageMultiplier:.40},SHOT:{damageMultiplier:.25},STRIKE:{damageMultiplier:.55},MAGIC:{damageMultiplier:.80}}
      }]
    }
  });

  Object.assign(PASSIVES,{
    ELVEN_PATHFINDER:{id:"ELVEN_PATHFINDER",name:"山林之民",category:"PASSIVE",description:"精靈在森林與山地如履平地。",terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"]},
    FOREST_LANGUAGE:{id:"FOREST_LANGUAGE",name:"森語",category:"PASSIVE",description:"以聽覺感知魔力，並能聽見植物的語言。"},
    EAGLE_SHARED_VISION:{id:"EAGLE_SHARED_VISION",name:"鷹眼共享",category:"PASSIVE",description:"與老鷹夥伴共享視覺，作為超遠距離曲射的觀測來源。"},
    STRONG_PHYSIQUE:{id:"STRONG_PHYSIQUE",name:"強健體魄",category:"PASSIVE",description:"異常強韌的體格使寇林不會被敵方擊退。",immunities:["KNOCKBACK"]}
  });

  Object.assign(SKILLS,{
    ophi_elven_shot:{id:"ophi_elven_shot",name:"精靈弓射",category:"ATTACK",weapon:"elven_bow",power:1.1,range:{min:2,max:5},attackType:"SHOT",element:"INHERIT",speed:5,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
    ophi_eagle_arc_shot:{id:"ophi_eagle_arc_shot",name:"鷹眼曲射",category:"ATTACK",weapon:"elven_bow",power:1.25,range:{min:3,max:8},attackType:"SHOT",element:"INHERIT",speed:-10,target:"ENEMY",support:false,resource:{type:"USES",max:2},trajectory:"ARC",requiresCompanionVision:"ophi_eagle",affixes:["ARC_SHOT"]},
    ophi_healing_song:{id:"ophi_healing_song",name:"治癒歌聲",category:"MAGIC",power:0,range:{min:0,max:3},target:"ALLY",targetType:"AOE",radius:2,speed:-5,support:false,resource:{type:"USES",max:2},healingOverTime:{amount:20,duration:3,interval:"ROUND_START"},soundMagic:true,affixes:["HEAL_OVER_TIME"]},
    ophi_listen_to_forest:{id:"ophi_listen_to_forest",name:"聆聽森語",category:"SPECIAL",power:0,range:{min:0,max:4},target:"SELF",support:false,resource:{type:"UNLIMITED"},informationSkill:true,affixes:["FOREST_SENSE"]},

    colin_full_shield_defense:{
      id:"colin_full_shield_defense",name:"大盾防禦",category:"SPECIAL",power:0,range:{min:0,max:0},target:"SELF",
      speed:-5,support:false,resource:{type:"UNLIMITED"},requiresEquipment:"colin_full_body_shield",
      stance:{
        type:"FULL_SHIELD_DEFENSE",
        protectsBehind:true,
        blocksEnemyRoute:true,
        enhancedGuard:true
      },
      affixes:["FULL_SHIELD_DEFENSE"]
    },
    colin_armor_breaking_strike:{
      id:"colin_armor_breaking_strike",name:"破甲打擊",category:"ATTACK",weapon:"colin_hammer",power:1.15,
      range:{min:1,max:1},attackType:"STRIKE",element:"INHERIT",speed:-10,target:"ENEMY",support:false,
      resource:{type:"UNLIMITED"},affixes:["ARMOR_BREAK"],
      statusEffects:[{type:"DEF_DOWN",value:20,duration:2}],
      postEffects:[{type:"KNOCKBACK",distance:2}]
    }
  });

  window.COMPANIONS=window.COMPANIONS||{};
  COMPANIONS.ophi_eagle={
    id:"ophi_eagle",name:"奧菲的老鷹",ownerCharacterId:"ophi",kind:"SCOUT",movement:"FLYING",
    occupiesCardSlot:false,canAttack:false,sharedVision:true,providesTargetingFor:["ophi_eagle_arc_shot"]
  };

  const rawOphi={
    id:"ophi",name:"奧菲",race:"ELF",faction:"ELVEN",visualId:"ophi_default",archetype:"RANGED",
    attributes:{str:20,agi:20,int:20,wil:20,vit:18,luk:18},
    combat:{hp:225,atk:98,matk:88,def:60,mdef:88,move:5},
    armorId:"elf_light_armor",weaponIds:{elven_bow:"ophi_elven_bow",ranger_sword:"ophi_ranger_sword"},equipmentIds:[],
    companionIds:["ophi_eagle"],terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"],
    passives:["ELVEN_PATHFINDER","FOREST_LANGUAGE","EAGLE_SHARED_VISION"],
    skills:["ophi_elven_shot","ophi_eagle_arc_shot","ophi_healing_song","ophi_listen_to_forest"],
    lore:{role:"莉維亞第一位夥伴",genetics:"4V",notes:"精靈由遠古人類基因改造而來，為適應現今環境而分化。"}
  };
  CHARACTERS.ophi=EquipmentDatabase.resolveCharacter(rawOphi);

  const rawColin={
    id:"colin",name:"寇林",race:"ELF",faction:"ELVEN",visualId:"colin_default",archetype:"DEFENDER",
    attributes:{str:20,agi:20,int:13,wil:17,vit:18,luk:14},
    combat:{hp:310,atk:98,matk:60,def:92,mdef:80,move:4},
    armorId:"chainmail",weaponIds:{colin_hammer:"colin_war_hammer"},equipmentIds:["colin_full_body_shield"],
    terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"],
    passives:["ELVEN_PATHFINDER","STRONG_PHYSIQUE"],
    skills:["colin_full_shield_defense","colin_armor_breaking_strike"],
    lore:{role:"專職坦克",genetics:"2V",notes:"STR、AGI為V。以足以遮蔽全身的大盾守住戰線，戰錘負責破甲與擊退。"}
  };
  CHARACTERS.colin=EquipmentDatabase.resolveCharacter(rawColin);

  CARDS.ophi_card={id:"ophi_card",name:"奧菲",type:"CHARACTER",characterId:"ophi",faction:"ELVEN",unitType:"HERO",cost:6,pack:"OPHI_SUPPLEMENT"};
  CARDS.colin_card={id:"colin_card",name:"寇林",type:"CHARACTER",characterId:"colin",faction:"ELVEN",unitType:"HERO",cost:6,pack:"OPHI_SUPPLEMENT"};
  CARDS.moon_goddess_blessing_card={id:"moon_goddess_blessing_card",name:"月神祝福",type:"SPELL",spellType:"BUFF",faction:"ELVEN",cost:4,pack:"OPHI_SUPPLEMENT",effect:{type:"RACE_NIGHT_BUFF",race:"ELF",scope:"ALL_FRIENDLY_ON_FIELD",requiresTimeOfDay:"NIGHT",modifiers:{powerMultiplier:1.15,speed:10}}};
})();
