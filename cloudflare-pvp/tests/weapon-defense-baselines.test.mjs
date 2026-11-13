import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../js/equipment-database.js",import.meta.url),"utf8");
const {EQUIPMENT,EquipmentDatabase,WEAPON_DEFENSE_BASELINES}=await import("data:text/javascript,"+encodeURIComponent(source));
const expected={
  "imperial_sword": {
    "id": "sword_parry",
    "method": "PARRY",
    "name": "長劍招架",
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
    },
    "sourceId": "imperial_sword"
  },
  "church_training_sword": {
    "id": "church_sword_parry",
    "method": "PARRY",
    "name": "長劍招架",
    "vs": {
      "SLASH": {
        "chance": 65
      },
      "PIERCE": {
        "chance": 60
      },
      "SHOT": {
        "chance": 10
      },
      "STRIKE": {
        "chance": 0
      },
      "MAGIC": {
        "chance": 0
      }
    },
    "sourceId": "church_training_sword"
  },
  "standard_sword": {
    "id": "standard_sword_parry",
    "method": "PARRY",
    "name": "長劍招架",
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
    },
    "sourceId": "standard_sword"
  },
  "star_iron_sword": {
    "id": "star_iron_parry",
    "method": "PARRY",
    "name": "星鐵劍招架",
    "vs": {
      "SLASH": {
        "chance": 80
      },
      "PIERCE": {
        "chance": 75
      },
      "SHOT": {
        "chance": 20
      },
      "STRIKE": {
        "chance": 5
      },
      "MAGIC": {
        "chance": 0
      }
    },
    "sourceId": "star_iron_sword"
  },
  "blessed_sword": {
    "id": "blessed_sword_parry",
    "method": "PARRY",
    "name": "祝福長劍招架",
    "vs": {
      "SLASH": {
        "chance": 80
      },
      "PIERCE": {
        "chance": 75
      },
      "SHOT": {
        "chance": 30
      },
      "STRIKE": {
        "chance": 10
      },
      "MAGIC": {
        "chance": 0
      }
    },
    "sourceId": "blessed_sword"
  },
  "imperial_spear": {
    "id": "spear_deflect",
    "method": "DEFLECT",
    "name": "長槍偏斜",
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
    },
    "sourceId": "imperial_spear"
  },
  "imperial_hammer": {
    "id": "hammer_brace",
    "method": "BRACE",
    "name": "戰錘承受",
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
    },
    "sourceId": "imperial_hammer"
  },
  "imperial_staff": {
    "id": "staff_barrier",
    "method": "BARRIER",
    "name": "法杖屏障",
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
    },
    "sourceId": "imperial_staff"
  },
  "church_royal_saint_staff": {
    "id": "royal_saint_staff_barrier",
    "method": "BARRIER",
    "name": "聖杖屏障",
    "vs": {
      "SLASH": {
        "damageMultiplier": 0.85
      },
      "PIERCE": {
        "damageMultiplier": 0.85
      },
      "SHOT": {
        "damageMultiplier": 0.75
      },
      "STRIKE": {
        "damageMultiplier": 0.9
      },
      "MAGIC": {
        "damageMultiplier": 0.55
      }
    },
    "sourceId": "church_royal_saint_staff"
  },
  "velsa_dimension_staff": {
    "id": "velsa_staff_barrier",
    "method": "BARRIER",
    "name": "高維屏障",
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
        "damageMultiplier": 0.6
      }
    },
    "sourceId": "velsa_dimension_staff"
  },
  "church_greatsword": {
    "id": "church_greatsword_parry",
    "method": "PARRY",
    "name": "雙手劍招架",
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
    },
    "sourceId": "church_greatsword"
  },
  "church_saint_greatsword": {
    "id": "saint_greatsword_parry",
    "method": "PARRY",
    "name": "聖劍招架",
    "vs": {
      "SLASH": {
        "chance": 85
      },
      "PIERCE": {
        "chance": 80
      },
      "SHOT": {
        "chance": 25
      },
      "STRIKE": {
        "chance": 15
      },
      "MAGIC": {
        "chance": 0
      }
    },
    "sourceId": "church_saint_greatsword"
  },
  "seraphina_rapier": {
    "id": "seraphina_rapier_parry",
    "method": "PARRY",
    "name": "細劍招架",
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
    },
    "sourceId": "seraphina_rapier"
  }
};
for(const [id,profile] of Object.entries(expected)){
  const result=EquipmentDatabase.defenseProfiles({weapons:{main:EQUIPMENT[id]}});
  const {sourceName,...actual}=result[0]||{};
  assert.deepEqual(actual,profile,"Unexpected defense regression: "+id);
}
assert.equal(Object.keys(WEAPON_DEFENSE_BASELINES).length,6);
assert.deepEqual(EquipmentDatabase.defenseProfiles({weapons:{sword:EQUIPMENT.black_sword}}),[]);
assert.equal(EquipmentDatabase.weaponDefenseMatchup(EQUIPMENT.black_sword,"STRIKE"),null);
assert.equal(EquipmentDatabase.weaponDefenseMatchup(EQUIPMENT.imperial_sword,"STRIKE").chance,0);
assert.equal(EquipmentDatabase.weaponDefenseMatchup(EQUIPMENT.star_iron_sword,"STRIKE").chance,5);
assert.equal(EquipmentDatabase.weaponDefenseMatchup(EQUIPMENT.church_greatsword,"STRIKE").chance,10);
assert.equal(EquipmentDatabase.weaponDefenseMatchup(EQUIPMENT.church_saint_greatsword,"STRIKE").chance,15);
assert.equal(EquipmentDatabase.weaponDefenseMatchup(EQUIPMENT.imperial_hammer,"SLASH").damageMultiplier,.75);
assert.equal(EquipmentDatabase.defenseProfiles({guard:EQUIPMENT.elf_blessed_guard})[0].artifact,true);
const profile=EquipmentDatabase.defenseProfiles({weapons:{sword:EQUIPMENT.imperial_sword}})[0];
profile.vs.SLASH.chance=0;
assert.equal(EquipmentDatabase.weaponDefenseMatchup(EQUIPMENT.imperial_sword,"SLASH").chance,70,"Caller mutation must not leak into baseline");
console.log("PASS: 13 weapon snapshots, 6 baseline categories, artifact guard, black sword, immutable values");
