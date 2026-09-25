(()=>{
  Object.assign(EQUIPMENT,{
    seraphina_claws:{id:"seraphina_claws",name:"血族利爪",kind:"WEAPON",weaponKind:"CLAW",attackType:"SLASH",element:"DARK",affixes:[]}
  });
  Object.assign(SKILLS,{
    seraphina_rending_claw:{id:"seraphina_rending_claw",name:"裂血爪",category:"ATTACK",weapon:"claw",power:1.15,range:{min:1,max:1},attackType:"SLASH",element:"DARK",speed:10,target:"ENEMY",support:false,resource:{type:"UNLIMITED"}},
    seraphina_blood_drain:{id:"seraphina_blood_drain",name:"吸血",category:"SPECIAL",power:0,range:{min:1,max:1},target:"ALLY_OR_ENEMY",support:false,resource:{type:"USES",max:3},bloodAction:{damage:45,healRatio:1,manaRatio:.5,restoresGenome:{str:20,agi:20,int:20,wil:20,vit:20,luk:20},duration:3,copySkill:true,copyDuration:3}},
    seraphina_blood_burst:{id:"seraphina_blood_burst",name:"血爆",category:"ATTACK",weapon:"claw",power:1.4,range:{min:1,max:1},attackType:"SLASH",element:"DARK",speed:5,target:"ENEMY",support:false,resource:{type:"USES",max:2}},
    seraphina_regeneration:{id:"seraphina_regeneration",name:"血之再生",category:"SPECIAL",power:0,range:{min:0,max:0},target:"SELF",support:false,resource:{type:"USES",max:2},effects:[{type:"HEAL",amount:80}]}
  });
  const raw={id:"seraphina",name:"Seraphina",race:"ANCIENT_HUMAN",traits:["VAMPIRE"],faction:"VAMPIRE",visualId:"seraphina_default",archetype:"MELEE_BURST",genetics:{grade:"IMPERFECT_ANCIENT_HUMAN",restoredGrade:"5V",trigger:"BLOOD"},attributes:{str:18,agi:19,int:17,wil:16,vit:15,luk:14},combat:{hp:245,atk:104,matk:78,def:64,mdef:72,move:5},armorId:"livia_light_armor",weaponIds:{claw:"seraphina_claws"},skills:["seraphina_rending_claw","seraphina_blood_drain","seraphina_blood_burst","seraphina_regeneration"],lore:{genetics:"IMPERFECT_ANCIENT_HUMAN",notes:"遠古人類時代的病患。吸血鬼是不完美的遠古人類；吸血後可暫時恢復5V並複製供血者一項可複製能力。"}};
  CHARACTERS.seraphina=EquipmentDatabase.resolveCharacter(raw);
  CARDS.seraphina_card={id:"seraphina_card",name:"Seraphina",type:"CHARACTER",characterId:"seraphina",faction:"VAMPIRE",unitType:"HERO",cost:6,pack:"SERAPHINA_SUPPLEMENT"};
})();
