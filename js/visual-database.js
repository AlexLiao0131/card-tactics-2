export const VISUALS={
  characters:{
    livia_default:{
      portrait:"assets/characters/livia/portrait.webp",
      card:"assets/characters/livia/card.webp",
      tactical:"assets/characters/livia/tactical.webp",
      expressions:{},
      battle:{
        kind:"FIGURE",
        baseFacing:"E",
        height:1.68,
        figure:{
          style:"HUNTER_SLIM",
          braid:true,
          cape:true,
          bow:true,
          quiver:true,
          sideSword:true,
          colors:{
            skin:"#e9b99d",
            hair:"#5a342b",
            cape:"#294f99",
            leather:"#4a3025",
            shirt:"#eee5dc",
            pants:"#29282c",
            boots:"#493025",
            metal:"#9a775b",
            bow:"#74482c",
            bowString:"#d8c5a6",
            eyes:"#4b87df"
          }
        },
        animations:{
          IDLE:{duration:1200,loop:true,procedural:"BREATHE"},
          WALK:{
            duration:180,
            loop:true,
            procedural:"STEP",
            figureMotion:{
              bodyBob:.055,
              rootSway:.028,
              bodySway:.024,
              torsoBob:.015,
              legSwing:.50,
              armSwing:.34,
              bowSwing:.26,
              capeSwing:.12,
              capeTwist:.05,
              braidSwing:.17,
              braidTwist:.075,
              followLag:.68
            }
          },
          ATTACK:{duration:320,loop:false,procedural:"LUNGE"},
          CAST:{duration:480,loop:false,procedural:"CAST"},
          HURT:{duration:240,loop:false,procedural:"RECOIL"},
          DEATH:{duration:700,loop:false,procedural:"FALL"}
        }
      }
    }
  },
  cards:{},
  terrainMaterials:{},
  objects:{},
  effects:{},
  animations:{},
  skills:{},
  equipment:{},
  maps:{prototype_field:{background:null}},
  presentation:{
    terrain:{PLAIN:{fill:0x405b49},MUD:{fill:0x6b573f},FOREST:{fill:0x2d6745,marker:{primitive:"TEXT",text:"🌲",fontSize:25,lift:18}},HIGH_GROUND:{fill:0x817243},WATER:{fill:0x2f91c2,alpha:.52,frontAlpha:.20,bedAlpha:.94,marker:{primitive:"TEXT",text:"≈",fontSize:23,color:"#c8f3ff"}},WALL:{fill:0x606873,marker:{primitive:"ROCK"}}},
    objects:{ROCK:{primitive:"ROCK"},TREE:{primitive:"TEXT",text:"🌳",fontSize:28},CORE:{primitive:"CRYSTAL"}},
    effects:{
      BURNING:{primitive:"TEXT",text:"🔥",fontSize:18},BOILING:{primitive:"TEXT",text:"🫧",fontSize:19},STEAM:{primitive:"TEXT",text:"♨",fontSize:17},TORNADO:{primitive:"TEXT",text:"🌪️",fontSize:27},FIRE_TORNADO:{primitive:"TEXT",text:"🌪️🔥",fontSize:24},ELECTRIFIED:{primitive:"TEXT",text:"⚡",fontSize:20},FRAGMENTS:{primitive:"TEXT",text:"◆",fontSize:16,color:"#d6d0c5"},TRAP:{primitive:"TEXT",text:"🪤",fontSize:20},
      SNOW:{primitive:"TEXT",text:"❄",fontSize:18,color:"#f3fbff"},ICE:{primitive:"TEXT",text:"🧊",fontSize:17},CURRENT:{primitive:"TEXT",text:"↡",fontSize:18,color:"#d8f4ff"}
    }
  }
};

export const VisualDatabase=(()=>{
  function group(name){return VISUALS[name]||null;}
  function get(groupName,id){return group(groupName)?.[id]||null;}
  function asset(groupName,id,key){return get(groupName,id)?.[key]??null;}
  function presentation(groupName,id){return VISUALS.presentation?.[groupName]?.[id]||null;}

  function register(groupName,id,definition){
    if(!groupName||!id||!definition)return null;
    VISUALS[groupName]=VISUALS[groupName]||{};
    VISUALS[groupName][id]={...(VISUALS[groupName][id]||{}),...definition};
    return VISUALS[groupName][id];
  }

  function character(id){return get("characters",id);}
  function characterBattle(id){return character(id)?.battle||null;}
  function card(id){return get("cards",id);}
  function terrainMaterial(id){return get("terrainMaterials",id)||presentation("terrain",id);}
  function object(id){return get("objects",id)||presentation("objects",id);}
  function effect(id){return get("effects",id)||presentation("effects",id);}
  function animation(id){return get("animations",id);}

  return{
    group,get,asset,presentation,register,
    character,characterBattle,card,terrainMaterial,object,effect,animation
  };
})();

globalThis.VISUALS=VISUALS;
globalThis.VisualDatabase=VisualDatabase;
