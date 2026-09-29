export const LOADOUTS={
  livia_default:{id:"livia_default",characterId:"livia",armorId:"livia_light_armor",weaponIds:{kahns_bow:"kahns_bow",black_sword:"black_sword"},equipmentIds:["blue_cloak","leather_bracers","sapphire_pendant"],skillIds:["bow_shot","black_slash","shadow_step","nether_slash","thunder_enchant","fire_enchant"]},
  leon_default:{id:"leon_default",characterId:"leon",armorId:"chainmail",weaponIds:{star_iron_sword:"star_iron_sword"},equipmentIds:["buckler","imperial_cloak"],skillIds:["leon_slash","leon_thrust","leon_strike","lion_flash"]},
  kahn_default:{id:"kahn_default",characterId:"kahn",armorId:"hunter_leather",weaponIds:{kahn_hunter_bow:"kahn_hunter_bow",hunting_knife:"hunting_knife"},equipmentIds:["hunter_cloak","hunter_bracers"],skillIds:["kahn_precision","kahn_snipe","kahn_knife"]},
  cassandra_default:{id:"cassandra_default",characterId:"cassandra",armorId:"cassandra_robe",weaponIds:{cassandra_staff:"cassandra_staff"},equipmentIds:["magic_gloves","old_imperial_cloak"],skillIds:["cassandra_magic_bolt","cassandra_fire_burst","cassandra_frost","cassandra_dissolve"]},
  imperial_swordsman_default:{id:"imperial_swordsman_default",characterId:"imperial_swordsman",armorId:"imperial_medium_armor",weaponIds:{sword:"imperial_sword"},skillIds:["slash"]},
  imperial_spearman_default:{id:"imperial_spearman_default",characterId:"imperial_spearman",armorId:"imperial_medium_armor",weaponIds:{spear:"imperial_spear"},skillIds:["thrust"]},
  imperial_archer_default:{id:"imperial_archer_default",characterId:"imperial_archer",armorId:"hunter_leather",weaponIds:{bow:"imperial_bow"},skillIds:["imperial_bow_shot"]},
  imperial_heavy_guard_default:{id:"imperial_heavy_guard_default",characterId:"imperial_heavy_guard",armorId:"imperial_heavy_shield_armor",weaponIds:{sword:"imperial_sword"},equipmentIds:["imperial_heavy_plate","imperial_large_shield"],skillIds:["heavy_slash"]},
  imperial_hammer_default:{id:"imperial_hammer_default",characterId:"imperial_hammer",armorId:"imperial_heavy_armor",weaponIds:{hammer:"imperial_hammer"},skillIds:["smash"]},
  imperial_mage_default:{id:"imperial_mage_default",characterId:"imperial_mage",armorId:"mage_cloth",weaponIds:{staff:"imperial_staff"},skillIds:["magic_bolt"]},
  imperial_cavalry_default:{id:"imperial_cavalry_default",characterId:"imperial_cavalry",armorId:"imperial_medium_armor",weaponIds:{sword:"imperial_sword"},skillIds:["cavalry_slash"]},
  forest_beast_default:{id:"forest_beast_default",characterId:"forest_beast",armorId:"natural_hide",weaponIds:{claw:"forest_claw"},skillIds:["claw"]},
  unarmored_dummy_default:{id:"unarmored_dummy_default",characterId:"unarmored_dummy",armorId:"no_armor",weaponIds:{club:"training_club"},skillIds:["club"]},
  water_guard_test_default:{id:"water_guard_test_default",characterId:"water_guard_test",armorId:"water_medium_armor",weaponIds:{sword:"standard_sword"},skillIds:["slash"]},
  elf_guard_test_default:{id:"elf_guard_test_default",characterId:"elf_guard_test",armorId:"elf_light_armor",guardId:"elf_blessed_guard",weaponIds:{blessed_sword:"blessed_sword"},skillIds:["blessed_slash"]},

  reina_default:{id:"reina_default",characterId:"reina",armorId:"chainmail",guardId:"elf_blessed_guard",weaponIds:{blessed_sword:"blessed_sword",bow:"imperial_bow"},skillIds:["reina_blessed_slash","reina_command_shot","reina_rally"]},
  elf_shapeshifter_default:{id:"elf_shapeshifter_default",characterId:"elf_shapeshifter",armorId:"elf_light_armor",weaponIds:{claw:"forest_claw"},skillIds:["claw"]},
  elf_ranger_default:{id:"elf_ranger_default",characterId:"elf_ranger",armorId:"chainmail",weaponIds:{bow:"imperial_bow",blessed_sword:"blessed_sword"},skillIds:["imperial_bow_shot","blessed_slash"]},
  elf_guard_default:{id:"elf_guard_default",characterId:"elf_guard",armorId:"imperial_heavy_armor",weaponIds:{blessed_sword:"blessed_sword"},equipmentIds:["imperial_large_shield"],skillIds:["blessed_slash"]},
  elf_priest_default:{id:"elf_priest_default",characterId:"elf_priest",armorId:"elf_light_armor",weaponIds:{staff:"imperial_staff"},skillIds:["magic_bolt"]},

  ophi_default:{id:"ophi_default",characterId:"ophi",armorId:"elf_light_armor",weaponIds:{elven_bow:"ophi_elven_bow"},equipmentIds:[],skillIds:["ophi_eagle_arc_shot"],companionIds:["ophi_eagle"],generatedCardsOnDeploy:["ophi_eagle_card"]},
  ophi_eagle_default:{id:"ophi_eagle_default",characterId:"ophi_eagle",armorId:"natural_hide",weaponIds:{},skillIds:[]},
  colin_default:{id:"colin_default",characterId:"colin",armorId:"chainmail",weaponIds:{colin_hammer:"colin_war_hammer"},equipmentIds:["colin_full_body_shield"],skillIds:["colin_full_shield_defense","colin_armor_breaking_strike"]},

  church_apprentice_default:{id:"church_apprentice_default",characterId:"church_apprentice",armorId:"imperial_medium_armor",weaponIds:{sword:"church_training_sword"},skillIds:["church_slash"]},
  church_heavy_knight_default:{id:"church_heavy_knight_default",characterId:"church_heavy_knight",armorId:"church_heavy_plate",weaponIds:{greatsword:"church_greatsword"},skillIds:["church_heavy_slash"]},
  church_templar_default:{id:"church_templar_default",characterId:"church_templar",armorId:"church_templar_plate",weaponIds:{greatsword:"church_greatsword"},skillIds:["church_heavy_slash","church_holy_bolt"]},
  church_bishop_default:{id:"church_bishop_default",characterId:"church_bishop",armorId:"church_bishop_robe",weaponIds:{staff:"imperial_staff"},skillIds:["church_holy_bolt","saint_heal","saint_dispel"]},
  church_templar_hero_default:{id:"church_templar_hero_default",characterId:"church_templar_hero",armorId:"church_templar_plate",weaponIds:{greatsword:"church_saint_greatsword"},skillIds:["templar_holy_slash","templar_charge","templar_holy_shield","templar_healing"]},
  church_saint_default:{id:"church_saint_default",characterId:"church_saint",armorId:"church_saint_vestment",weaponIds:{staff:"church_royal_saint_staff"},skillIds:["saint_judgement","saint_hero_heal","saint_hero_dispel","saint_hero_blessing","saint_sanctuary"]},

  seraphina_default:{id:"seraphina_default",characterId:"seraphina",armorId:"livia_light_armor",weaponIds:{rapier:"seraphina_rapier"},skillIds:["seraphina_rending_claw","seraphina_blood_drain","seraphina_blood_shield","seraphina_blood_burst","seraphina_regeneration"]},
  water_lurker_default:{id:"water_lurker_default",characterId:"water_lurker",armorId:"natural_hide",weaponIds:{claw:"forest_claw"},skillIds:["water_tentacle","claw"]},
  nereia_default:{id:"nereia_default",characterId:"nereia",armorId:"nereia_scale_battle_suit",weaponIds:{trident:"nereia_royal_trident"},equipmentIds:[],skillIds:["nereia_trident_thrust","nereia_water_bullet","nereia_tsunami","aquatic_depth_control"]},
  cat_thief_hero_default:{id:"cat_thief_hero_default",characterId:"cat_thief_hero",armorId:"beast_thief_leather",weaponIds:{daggers:"beast_dual_daggers",throwing_knife:"beast_poison_throwing_knife"},equipmentIds:[],skillIds:["cat_dual_slash","cat_backstab","cat_poison_knife","cat_thief_trap","cat_steal_card","cat_hide"]},
  angel_archer_hero_default:{id:"angel_archer_hero_default",characterId:"angel_archer_hero",armorId:"angel_light_armor",weaponIds:{bow:"angel_longbow"},equipmentIds:[],skillIds:["angel_bow_shot","angel_holy_shot","angel_heal","angel_lift_drop","angel_carry_ally","angel_release_ally","angel_wing_control"]}
};

export const LoadoutDatabase=(()=>{
  function get(id){return LOADOUTS[id]||null}
  function list(ids=[]){return(ids||[]).map(get).filter(Boolean)}
  function defaultForCharacter(characterId){
    const character=CharacterDatabase.get(characterId);if(!character)return null;
    return Object.values(LOADOUTS).find(loadout=>loadout.characterId===character.id)||null;
  }
  function resolveLoadout(characterId,loadoutId=null){
    const character=CharacterDatabase.get(characterId);if(!character)throw new Error(`Unknown character: ${characterId}`);
    const loadout=loadoutId?get(loadoutId):defaultForCharacter(characterId);
    if(!loadout)throw new Error(`No loadout for character: ${characterId}`);
    if(loadout.characterId!==character.id)throw new Error(`Loadout ${loadout.id} belongs to ${loadout.characterId}, not ${character.id}`);
    return loadout;
  }
  function resolveCharacter(characterId,loadoutId=null){
    const character=CharacterDatabase.get(characterId);if(!character)return null;
    const loadout=resolveLoadout(characterId,loadoutId);
    const equipment=EquipmentDatabase.resolveLoadout(loadout);
    const skillIds=[...new Set([...(loadout.skillIds||[]),...EquipmentDatabase.grantedSkillIds(equipment)])];
    return {
      ...character,
      loadoutId:loadout.id,
      armorId:loadout.armorId||null,
      guardId:loadout.guardId||null,
      weaponIds:{...(loadout.weaponIds||{})},
      equipmentIds:[...(loadout.equipmentIds||[])],
      skillIds,
      skills:[...skillIds],
      companionIds:[...(loadout.companionIds||[])],
      generatedCardsOnDeploy:[...(loadout.generatedCardsOnDeploy||[])],
      ...equipment
    };
  }
  function generatedCardsForCard(card){
    if(!card?.characterId)return[];
    const loadout=resolveLoadout(card.characterId,card.loadoutId||null);
    return[...(loadout.generatedCardsOnDeploy||[])];
  }
  function validate(){
    const errors=[];
    const hasEquipment=id=>!id||!!EquipmentDatabase.get(id);
    const skillWeaponRefs=skill=>[skill,...(skill?.variants||[])].map(item=>item?.weapon).filter(Boolean);
    const knownWeaponRefs=new Set();
    for(const loadout of Object.values(LOADOUTS))for(const[slot,id]of Object.entries(loadout.weaponIds||{})){knownWeaponRefs.add(slot);knownWeaponRefs.add(id);}
    for(const loadout of Object.values(LOADOUTS)){
      const character=CharacterDatabase.get(loadout.characterId);
      if(!character){errors.push(`${loadout.id}: missing character ${loadout.characterId}`);continue;}
      const weaponEntries=Object.entries(loadout.weaponIds||{}),weaponIds=new Set(weaponEntries.map(([,id])=>id));
      for(const [,id] of weaponEntries)if(!hasEquipment(id))errors.push(`${loadout.id}: missing weapon ${id}`);
      if(!hasEquipment(loadout.armorId))errors.push(`${loadout.id}: missing armor ${loadout.armorId}`);
      if(!hasEquipment(loadout.guardId))errors.push(`${loadout.id}: missing guard ${loadout.guardId}`);
      for(const id of loadout.equipmentIds||[])if(!hasEquipment(id))errors.push(`${loadout.id}: missing equipment ${id}`);
      for(const id of loadout.companionIds||[])if(!CompanionDatabase.get(id))errors.push(`${loadout.id}: missing companion ${id}`);
      const resolvedEquipment=EquipmentDatabase.resolveLoadout(loadout);
      const resolvedSkillIds=[...new Set([...(loadout.skillIds||[]),...EquipmentDatabase.grantedSkillIds(resolvedEquipment)])];
      for(const id of resolvedSkillIds){
        const skill=globalThis.SKILLS?.[id];
        if(!skill){errors.push(`${loadout.id}: missing skill ${id}`);continue;}
        for(const weaponRef of skillWeaponRefs(skill))if(!knownWeaponRefs.has(weaponRef)&&!EquipmentDatabase.get(weaponRef))errors.push(`${loadout.id}: skill ${id} references unknown weapon ${weaponRef}`);
        if(skill.requiresEquipment){const equipped=new Set([...weaponIds,loadout.armorId,loadout.guardId,...(loadout.equipmentIds||[])]);if(!equipped.has(skill.requiresEquipment))errors.push(`${loadout.id}: skill ${id} requires missing equipment ${skill.requiresEquipment}`);}
      }
      for(const cardId of loadout.generatedCardsOnDeploy||[])if(!globalThis.CardDatabase?.get?.(cardId))errors.push(`${loadout.id}: missing generated card ${cardId}`);
    }
    for(const card of Object.values(globalThis.CARDS||{})){
      if(card?.type!=="CHARACTER")continue;
      if(!card.loadoutId){errors.push(`${card.id}: CHARACTER card missing loadoutId`);continue;}
      const loadout=get(card.loadoutId);
      if(!loadout)errors.push(`${card.id}: missing loadout ${card.loadoutId}`);
      else if(loadout.characterId!==CharacterDatabase.get(card.characterId)?.id)errors.push(`${card.id}: loadout ${card.loadoutId} does not match ${card.characterId}`);
    }
    if(errors.length)throw new Error(`LoadoutDatabase validation failed:\n${errors.join("\n")}`);
    return true;
  }
  return Object.freeze({get,list,defaultForCharacter,resolveLoadout,resolveCharacter,generatedCardsForCard,validate});
})();

globalThis.LOADOUTS=LOADOUTS;
globalThis.LoadoutDatabase=LoadoutDatabase;
