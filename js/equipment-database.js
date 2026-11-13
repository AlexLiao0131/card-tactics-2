export const EQUIPMENT={
  kahns_bow:{id:"kahns_bow",name:"卡恩贈送的獵弓",kind:"WEAPON",weaponKind:"BOW",attackType:"SHOT",element:"NONE",affixes:[]},
  black_sword:{id:"black_sword",name:"父親留下的黑劍",kind:"WEAPON",weaponKind:"SWORD",attackType:"SLASH",element:"NONE",affixes:["PHYSICAL_DEFENSE_IGNORE","IGNORE_ARMOR_DISADVANTAGE"]},
  imperial_sword:{id:"imperial_sword",name:"帝國制式長劍",kind:"WEAPON",weaponKind:"SWORD",materialId:"COMMON_METAL",attackType:"SLASH",element:"NONE",affixes:[],weaponDefense:{"id":"sword_parry","name":"長劍招架","baseline":"SWORD"}},
  imperial_spear:{id:"imperial_spear",name:"帝國制式長槍",kind:"WEAPON",weaponKind:"POLEARM",materialId:"COMMON_METAL",attackType:"PIERCE",element:"NONE",affixes:[],weaponDefense:{"id":"spear_deflect","name":"長槍偏斜","baseline":"POLEARM"}},
  imperial_bow:{id:"imperial_bow",name:"帝國制式弓",kind:"WEAPON",weaponKind:"BOW",attackType:"SHOT",element:"NONE",affixes:[]},
  imperial_hammer:{id:"imperial_hammer",name:"帝國制式戰錘",kind:"WEAPON",weaponKind:"HAMMER",attackType:"STRIKE",element:"NONE",affixes:[],weaponDefense:{"id":"hammer_brace","name":"戰錘承受","baseline":"HAMMER"}},
  imperial_staff:{id:"imperial_staff",name:"帝國制式法杖",kind:"WEAPON",weaponKind:"STAFF",attackType:"MAGIC",element:"NONE",affixes:[],weaponDefense:{"id":"staff_barrier","name":"法杖屏障","baseline":"STAFF"}},
  star_iron_sword:{id:"star_iron_sword",name:"星鐵劍",description:"由天外隕石鍛造，硬度與韌性超越一般金屬。近戰與一般金屬武器交鋒時壓制其招架；面對打擊可選擇以劍身韌性偏斜衝擊。",kind:"WEAPON",weaponKind:"SWORD",materialId:"STAR_IRON",attackType:"SLASH",element:"NONE",affixes:[],defenseProfiles:[{id:"star_iron_strike_deflect",method:"DEFLECT",name:"星鐵韌性・偏斜",physicalOnly:true,vs:{STRIKE:{damageMultiplier:.80}}}],weaponDefense:{"id":"star_iron_parry","name":"星鐵劍招架","baseline":"SWORD","overrides":{"SLASH":{"chance":80},"PIERCE":{"chance":75},"SHOT":{"chance":20},"STRIKE":{"chance":5}}}},
  kahn_hunter_bow:{id:"kahn_hunter_bow",name:"卡恩的獵弓",kind:"WEAPON",weaponKind:"BOW",attackType:"SHOT",element:"NONE",affixes:[]},
  hunting_knife:{id:"hunting_knife",name:"獵刀",kind:"WEAPON",weaponKind:"KNIFE",attackType:"SLASH",element:"NONE",affixes:[]},
  cassandra_staff:{id:"cassandra_staff",name:"卡珊多拉的法杖",kind:"WEAPON",weaponKind:"STAFF",attackType:"MAGIC",element:"NONE",affixes:[]},
  nereia_royal_trident:{id:"nereia_royal_trident",name:"王海三叉戟",kind:"WEAPON",weaponKind:"TRIDENT",attackType:"PIERCE",element:"NONE",affixes:[]},
  beast_dual_daggers:{id:"beast_dual_daggers",name:"雙匕首",kind:"WEAPON",weaponKind:"KNIFE",attackType:"SLASH",element:"NONE",affixes:[]},
  beast_poison_throwing_knife:{id:"beast_poison_throwing_knife",name:"淬毒投擲刀",kind:"WEAPON",weaponKind:"KNIFE",attackType:"PIERCE",element:"NONE",affixes:[]},
  angel_longbow:{id:"angel_longbow",name:"天使長弓",kind:"WEAPON",weaponKind:"BOW",attackType:"SHOT",element:"NONE",affixes:[]},

  ophi_elven_bow:{id:"ophi_elven_bow",name:"奧菲的精靈長弓",kind:"WEAPON",weaponKind:"BOW",attackType:"SHOT",element:"NONE",affixes:[],basicSkillId:"ophi_elven_shot"},
  colin_war_hammer:{id:"colin_war_hammer",name:"寇林的戰錘",kind:"WEAPON",weaponKind:"HAMMER",attackType:"STRIKE",element:"NONE",affixes:[]},
  colin_full_body_shield:{id:"colin_full_body_shield",name:"寇林的全身大盾",kind:"ACCESSORY",affixes:[],defenseProfiles:[{id:"colin_full_body_guard",method:"GUARD",name:"全身大盾格擋",canGuardAlly:true,vs:{SLASH:{damageMultiplier:.35},PIERCE:{damageMultiplier:.40},SHOT:{damageMultiplier:.25},STRIKE:{damageMultiplier:.55},MAGIC:{damageMultiplier:.80}}}]},

  church_training_sword:{id:"church_training_sword",name:"教團訓練劍",kind:"WEAPON",weaponKind:"SWORD",materialId:"COMMON_METAL",attackType:"SLASH",element:"NONE",affixes:[],weaponDefense:{"id":"church_sword_parry","name":"長劍招架","baseline":"SWORD","overrides":{"SLASH":{"chance":65},"PIERCE":{"chance":60},"SHOT":{"chance":10}}}},
  church_greatsword:{id:"church_greatsword",name:"聖殿雙手劍",kind:"WEAPON",weaponKind:"GREATSWORD",materialId:"COMMON_METAL",attackType:"SLASH",element:"HOLY",affixes:[],weaponDefense:{"id":"church_greatsword_parry","name":"雙手劍招架","baseline":"GREATSWORD"}},
  church_saint_greatsword:{id:"church_saint_greatsword",name:"常駐神聖附魔雙手劍",kind:"WEAPON",weaponKind:"GREATSWORD",attackType:"SLASH",element:"HOLY",inherentMagic:{element:"HOLY",powerFromSkill:true,unblockable:true,unresistable:true},affixes:[],lightSource:{radius:2,visionBonus:2,color:"#ffd563",intensity:1.25,kind:"HOLY"},weaponDefense:{"id":"saint_greatsword_parry","name":"聖劍招架","baseline":"GREATSWORD","overrides":{"SLASH":{"chance":85},"PIERCE":{"chance":80},"SHOT":{"chance":25},"STRIKE":{"chance":15}}}},
  church_heavy_plate:{id:"church_heavy_plate",name:"教團重甲",kind:"ARMOR",type:"HEAVY",types:["HEAVY"],element:"NONE",affixes:[],defenseProfiles:[{id:"church_guard_ally",method:"GUARD",name:"援護防禦",canGuardAlly:true,vs:{SLASH:{damageMultiplier:.55},PIERCE:{damageMultiplier:.60},SHOT:{damageMultiplier:.55},STRIKE:{damageMultiplier:.70},MAGIC:{damageMultiplier:.80}}}]},
  church_templar_plate:{id:"church_templar_plate",name:"聖殿騎士重甲",kind:"ARMOR",type:"HEAVY",types:["HEAVY"],element:"HOLY",affixes:[],defenseProfiles:[{id:"church_guard_ally",method:"GUARD",name:"援護防禦",canGuardAlly:true,vs:{SLASH:{damageMultiplier:.55},PIERCE:{damageMultiplier:.60},SHOT:{damageMultiplier:.55},STRIKE:{damageMultiplier:.70},MAGIC:{damageMultiplier:.80}}}]},
  church_bishop_robe:{id:"church_bishop_robe",name:"主教法衣",kind:"ARMOR",type:"LIGHT",types:["LIGHT"],element:"HOLY",affixes:[]},
  church_royal_saint_staff:{id:"church_royal_saint_staff",name:"王家聖杖",kind:"WEAPON",weaponKind:"STAFF",attackType:"MAGIC",element:"HOLY",affixes:[],weaponDefense:{"id":"royal_saint_staff_barrier","name":"聖杖屏障","baseline":"STAFF","overrides":{"SHOT":{"damageMultiplier":0.75},"MAGIC":{"damageMultiplier":0.55}}}},
  church_saint_vestment:{id:"church_saint_vestment",name:"聖女禮裝",kind:"ARMOR",type:"LIGHT",types:["LIGHT"],element:"HOLY",affixes:[]},

  seraphina_rapier:{id:"seraphina_rapier",name:"血族細劍",kind:"WEAPON",weaponKind:"RAPIER",attackType:"PIERCE",element:"DARK",affixes:[],weaponDefense:{"id":"seraphina_rapier_parry","name":"細劍招架","baseline":"RAPIER"}},
  velsa_dimension_staff:{id:"velsa_dimension_staff",name:"污染演算法法杖",description:"由遠古運算設備在高維污染後重構而成的法杖。",kind:"WEAPON",weaponKind:"STAFF",attackType:"MAGIC",element:"DARK",affixes:[],basicSkillId:"velsa_arcane_bolt",weaponDefense:{"id":"velsa_staff_barrier","name":"高維屏障","baseline":"STAFF","overrides":{"MAGIC":{"damageMultiplier":0.6}}}},

  forest_claw:{id:"forest_claw",name:"利爪",kind:"WEAPON",attackType:"SLASH",element:"NONE",affixes:[]},training_club:{id:"training_club",name:"訓練木棒",kind:"WEAPON",attackType:"STRIKE",element:"NONE",affixes:[]},standard_sword:{id:"standard_sword",name:"制式長劍",kind:"WEAPON",weaponKind:"SWORD",materialId:"COMMON_METAL",attackType:"SLASH",element:"NONE",affixes:[],weaponDefense:{"id":"standard_sword_parry","name":"長劍招架","baseline":"SWORD"}},blessed_sword:{id:"blessed_sword",name:"精靈祝福長劍",kind:"WEAPON",weaponKind:"SWORD",attackType:"SLASH",element:"NONE",affixes:[],weaponDefense:{"id":"blessed_sword_parry","name":"祝福長劍招架","baseline":"SWORD","overrides":{"SLASH":{"chance":80},"PIERCE":{"chance":75},"SHOT":{"chance":30},"STRIKE":{"chance":10}}}},
  reina_nature_sword:{id:"reina_nature_sword",name:"蕾娜的精靈祝福長劍",kind:"WEAPON",weaponKind:"SWORD",attackType:"SLASH",element:"NONE",affixes:[],inherentMagic:{element:"NATURE",power:.45}},
  reina_nature_bow:{id:"reina_nature_bow",name:"蕾娜的精靈祝福長弓",kind:"WEAPON",weaponKind:"BOW",attackType:"SHOT",element:"NONE",affixes:[],inherentMagic:{element:"NATURE",power:.45}},
  reina_nature_guard:{id:"reina_nature_guard",name:"精靈祝福之劍・神器招架",kind:"GUARD",affixes:["ARTIFACT_PARRY"],defenseProfiles:[{id:"reina_artifact_parry",method:"PARRY",name:"精靈祝福之劍招架",artifact:true,vs:{SLASH:{chance:90},PIERCE:{chance:85},SHOT:{chance:60},STRIKE:{chance:40},MAGIC:{chance:55}}}]},
  livia_light_armor:{id:"livia_light_armor",name:"輕型防具",kind:"ARMOR",type:"LIGHT",types:["LIGHT"],element:"NONE",affixes:[]},
  nereia_scale_battle_suit:{id:"nereia_scale_battle_suit",name:"深海鱗甲戰衣",kind:"ARMOR",type:"MEDIUM",types:["MEDIUM"],element:"NONE",affixes:[]},
  beast_thief_leather:{id:"beast_thief_leather",name:"盜賊皮甲",kind:"ARMOR",type:"LIGHT",types:["LIGHT"],element:"NONE",affixes:[]},
  angel_light_armor:{id:"angel_light_armor",name:"天使輕甲",kind:"ARMOR",type:"LIGHT",types:["LIGHT"],element:"NONE",affixes:[]},
  imperial_medium_armor:{id:"imperial_medium_armor",name:"帝國制式中型甲",kind:"ARMOR",type:"MEDIUM",types:["MEDIUM"],element:"NONE",affixes:[]},imperial_heavy_shield_armor:{id:"imperial_heavy_shield_armor",name:"帝國制式重甲＋大型盾牌",kind:"ARMOR",type:"HEAVY",types:["HEAVY","SHIELD"],element:"NONE",affixes:[]},imperial_heavy_armor:{id:"imperial_heavy_armor",name:"帝國制式重甲",kind:"ARMOR",type:"HEAVY",types:["HEAVY"],element:"NONE",affixes:[],defenseProfiles:[{id:"heavy_armor_brace",method:"BRACE",name:"重甲承受",vs:{SLASH:{damageMultiplier:.75},PIERCE:{damageMultiplier:.75},SHOT:{damageMultiplier:.70},STRIKE:{damageMultiplier:.85},MAGIC:{damageMultiplier:1}}}]},mage_cloth:{id:"mage_cloth",name:"法師布衣",kind:"ARMOR",type:"LIGHT",types:["LIGHT"],element:"NONE",affixes:[]},chainmail:{id:"chainmail",name:"鎖甲",kind:"ARMOR",type:"MEDIUM",types:["MEDIUM"],element:"NONE",affixes:[]},hunter_leather:{id:"hunter_leather",name:"獵人皮甲",kind:"ARMOR",type:"LIGHT",types:["LIGHT"],element:"NONE",affixes:[]},cassandra_robe:{id:"cassandra_robe",name:"舊帝國法師袍",kind:"ARMOR",type:"LIGHT",types:["LIGHT"],element:"NONE",affixes:[]},natural_hide:{id:"natural_hide",name:"自然外皮",kind:"ARMOR",type:"LIGHT",types:["LIGHT"],element:"NATURE",affixes:[]},no_armor:{id:"no_armor",name:"無甲",kind:"ARMOR",type:"NONE",types:["NONE"],element:"NONE",affixes:[]},water_medium_armor:{id:"water_medium_armor",name:"水紋中型甲",kind:"ARMOR",type:"MEDIUM",types:["MEDIUM"],element:"WATER",affixes:[]},elf_light_armor:{id:"elf_light_armor",name:"精靈輕甲",kind:"ARMOR",type:"LIGHT",types:["LIGHT"],element:"NONE",affixes:[]},
  blue_cloak:{id:"blue_cloak",name:"藍色斗篷",kind:"ACCESSORY",description:"遭受可抵抗的魔法傷害時，有 30% 機率使該次魔法傷害減少 50%。不影響物理或不可抵抗神聖傷害。",affixes:["MAGIC_RESIST"]},leather_bracers:{id:"leather_bracers",name:"皮護腕",kind:"ACCESSORY",affixes:[]},sapphire_pendant:{id:"sapphire_pendant",name:"藍寶石掛墜",kind:"ACCESSORY",affixes:["ANCIENT_MAGIC_MEDIUM"]},imperial_heavy_plate:{id:"imperial_heavy_plate",name:"帝國制式重甲",kind:"ACCESSORY",affixes:[]},imperial_cloak:{id:"imperial_cloak",name:"帝國披風",kind:"ACCESSORY",affixes:[]},hunter_cloak:{id:"hunter_cloak",name:"旅行斗篷",kind:"ACCESSORY",affixes:[]},hunter_bracers:{id:"hunter_bracers",name:"獵人護腕",kind:"ACCESSORY",affixes:[]},magic_gloves:{id:"magic_gloves",name:"魔導手套",kind:"ACCESSORY",affixes:[]},old_imperial_cloak:{id:"old_imperial_cloak",name:"舊帝國披風",kind:"ACCESSORY",affixes:[]},
  imperial_large_shield:{id:"imperial_large_shield",name:"帝國大型盾牌",kind:"ACCESSORY",affixes:[],defenseProfiles:[{id:"large_shield_guard",method:"GUARD",name:"大型盾牌格擋",canGuardAlly:true,vs:{SLASH:{damageMultiplier:.45},PIERCE:{damageMultiplier:.50},SHOT:{damageMultiplier:.35},STRIKE:{damageMultiplier:.60},MAGIC:{damageMultiplier:.85}}}]},
  buckler:{id:"buckler",name:"小圓盾",kind:"ACCESSORY",affixes:[],defenseProfiles:[{id:"buckler_guard",method:"GUARD",name:"小圓盾格擋",vs:{SLASH:{damageMultiplier:.65},PIERCE:{damageMultiplier:.70},SHOT:{damageMultiplier:.60},STRIKE:{damageMultiplier:.80},MAGIC:{damageMultiplier:.95}}}]},
  elf_blessed_guard:{id:"elf_blessed_guard",name:"精靈祝福武器",kind:"GUARD",affixes:["ARTIFACT_PARRY"],defenseProfiles:[{id:"artifact_parry",method:"PARRY",name:"神器招架",artifact:true,vs:{SLASH:{chance:90},PIERCE:{chance:85},SHOT:{chance:60},STRIKE:{chance:40},MAGIC:{chance:55}}}]}
};
// Official weapon-kind defense matchups: weapon type vs incoming attack type.
// Armor damage affinities remain exclusively in battle-engine.js.
// Weapons without a previously configured defense profile receive no new defense.
export const WEAPON_DEFENSE_BASELINES=Object.freeze({
  "SWORD": {
    "method": "PARRY",
    "vs": {
      "SLASH": {
        "chance": 70
      },
      "PIERCE": {
        "chance": 65
      },
      "SHOT": {
        "chance": 15
      },
      "STRIKE": {
        "chance": 0
      },
      "MAGIC": {
        "chance": 0
      }
    }
  },
  "POLEARM": {
    "method": "DEFLECT",
    "vs": {
      "SLASH": {
        "chance": 55,
        "damageMultiplier": 0.35
      },
      "PIERCE": {
        "chance": 50,
        "damageMultiplier": 0.35
      },
      "SHOT": {
        "chance": 20,
        "damageMultiplier": 0.5
      },
      "STRIKE": {
        "chance": 0
      },
      "MAGIC": {
        "chance": 0
      }
    }
  },
  "HAMMER": {
    "method": "BRACE",
    "vs": {
      "SLASH": {
        "damageMultiplier": 0.75
      },
      "PIERCE": {
        "damageMultiplier": 0.8
      },
      "SHOT": {
        "damageMultiplier": 0.85
      },
      "STRIKE": {
        "damageMultiplier": 0.8
      },
      "MAGIC": {
        "damageMultiplier": 1
      }
    }
  },
  "STAFF": {
    "method": "BARRIER",
    "vs": {
      "SLASH": {
        "damageMultiplier": 0.85
      },
      "PIERCE": {
        "damageMultiplier": 0.85
      },
      "SHOT": {
        "damageMultiplier": 0.8
      },
      "STRIKE": {
        "damageMultiplier": 0.9
      },
      "MAGIC": {
        "damageMultiplier": 0.65
      }
    }
  },
  "GREATSWORD": {
    "method": "PARRY",
    "vs": {
      "SLASH": {
        "chance": 75
      },
      "PIERCE": {
        "chance": 70
      },
      "SHOT": {
        "chance": 15
      },
      "STRIKE": {
        "chance": 10
      },
      "MAGIC": {
        "chance": 0
      }
    }
  },
  "RAPIER": {
    "method": "PARRY",
    "vs": {
      "SLASH": {
        "chance": 45
      },
      "PIERCE": {
        "chance": 55
      },
      "SHOT": {
        "chance": 0
      },
      "STRIKE": {
        "chance": 0
      },
      "MAGIC": {
        "chance": 0
      }
    }
  }
});
export const EquipmentDatabase=(()=>{
  // The equipped weapon and its physical delivery are authoritative: no hard-coded sword/bow list.
  function canEnchantWeapon(weapon,rules={}){
    if(weapon?.kind!=="WEAPON"||!weapon.weaponKind)return false;
    const allowed=new Set((rules.attackTypes||["SLASH","PIERCE","STRIKE","SHOT"]).map(type=>String(type).toUpperCase()));
    return allowed.has(String(weapon.attackType||"").toUpperCase());
  }
  function get(id){return EQUIPMENT[id]||null}
  function list(ids=[]){return ids.map(get).filter(Boolean)}
  function equippedItems(character){return[...Object.values(character?.weapons||{}),character?.armor,...(character?.equipment||[]),character?.guard].filter(Boolean)}
  // Convert canonical weapon-kind data + item-specific overrides into the original
  // defenseProfiles contract shared by battle resolution, forecast, and PVP.
  function itemDefenseProfiles(item){
    if(!item?.weaponDefense)return item?.defenseProfiles||[];
    const spec=item.weaponDefense,base=WEAPON_DEFENSE_BASELINES[spec.baseline];
    if(!base||item.weaponKind!==spec.baseline)throw new Error("INVALID_WEAPON_DEFENSE_BASELINE:"+item.id);
    const vs={};
    for(const [type,rule] of Object.entries(base.vs))vs[type]={...rule,...(spec.overrides?.[type]||{})};
    return[{id:spec.id,method:base.method,name:spec.name,vs},...(item.defenseProfiles||[]).map(profile=>({...profile,vs:Object.fromEntries(Object.entries(profile.vs||{}).map(([type,rule])=>[type,{...rule}]))}))];
  }
  function weaponDefenseMatchup(item,incomingAttackType){
    const profile=itemDefenseProfiles(item)[0]||null;
    const rule=profile?.vs?.[incomingAttackType];
    return rule?{weaponKind:item?.weaponKind||null,attackType:incomingAttackType,method:profile.method,...rule}:null;
  }
  function defenseProfiles(character){const profiles=[];for(const item of equippedItems(character))for(const profile of itemDefenseProfiles(item))profiles.push({...profile,sourceId:item.id,sourceName:item.name});return profiles}
  function resolveLoadout(loadout={}){const weapons={};Object.entries(loadout.weaponIds||{}).forEach(([slot,id])=>{const item=get(id);if(item)weapons[slot]=item});return{armor:get(loadout.armorId)||{name:"無甲",type:"NONE",types:["NONE"],element:"NONE",affixes:[]},weapons,equipment:list(loadout.equipmentIds),guard:loadout.guardId?get(loadout.guardId):undefined}}
  function grantedSkillIds(character){const out=[];for(const item of equippedItems(character)){if(item?.basicSkillId)out.push(item.basicSkillId);for(const id of item?.grantedSkillIds||[])out.push(id)}return[...new Set(out)]}
  function lightSources(character){const out=[];for(const item of equippedItems(character)){const light=item?.lightSource;if(!light||Number(light.radius)<=0)continue;out.push({...light,sourceId:item.id,sourceName:item.name});}return out}
  function visionBonus(character){return lightSources(character).reduce((sum,light)=>sum+Math.max(0,Number(light.visionBonus||0)),0)}
  return{get,list,canEnchantWeapon,equippedItems,defenseProfiles,weaponDefenseMatchup,resolveLoadout,grantedSkillIds,lightSources,visionBonus}
})();
globalThis.EQUIPMENT=EQUIPMENT;
globalThis.EquipmentDatabase=EquipmentDatabase;
