export const BattleSetupEngine=(()=>{
  function hashSeed(seed){
    let h=2166136261>>>0;
    for(const ch of String(seed??"CARD_TACTICS")){
      h^=ch.charCodeAt(0);
      h=Math.imul(h,16777619)>>>0;
    }
    return h||0x6d2b79f5;
  }

  function createRandom(seed){
    let a=hashSeed(seed)>>>0;
    return()=>{
      a=(a+0x6D2B79F5)>>>0;
      let t=a;
      t=Math.imul(t^(t>>>15),t|1);
      t^=t+Math.imul(t^(t>>>7),t|61);
      return((t^(t>>>14))>>>0)/4294967296;
    };
  }

  function weightedChoice(entries,random){
    const valid=(entries||[]).filter(entry=>Number(entry?.weight||0)>0);
    if(!valid.length)return null;
    const total=valid.reduce((sum,entry)=>sum+Number(entry.weight||0),0);
    let roll=random()*total;
    for(const entry of valid){
      roll-=Number(entry.weight||0);
      if(roll<0)return entry;
    }
    return valid[valid.length-1];
  }

  function resolveEnvironment(stage,battleSetup={}){
    const source={...(stage?.environment||{})};
    const legacyPool=Array.isArray(source.weatherPool)?source.weatherPool:[];
    const climatePool=source.climatePool&&typeof source.climatePool==="object"?source.climatePool:null;
    delete source.weatherPool;delete source.climatePool;

    const battleSeed=
      battleSetup?.seed ??
      stage?.generatedBattlefield?.seed ??
      `${stage?.id||"stage"}:default`;

    const climateSeed=hashSeed(`${battleSeed}|${stage?.id||"stage"}|CLIMATE`),climateRandom=createRandom(climateSeed);
    const fogSeed=hashSeed(`${battleSeed}|${stage?.id||"stage"}|FOG`),fogRandom=createRandom(fogSeed);
    let climate=source.climate&&typeof source.climate==="object"?JSON.parse(JSON.stringify(source.climate)):null;
    let selectedPreset=null,selectedPrecipitation=null;

    if(climatePool){
      const precipitationEntries=Array.isArray(climatePool.precipitation)?climatePool.precipitation:[];
      selectedPrecipitation=weightedChoice(precipitationEntries,climateRandom);
      climate=climate||{};
      if(selectedPrecipitation){
        climate.precipitation={
          type:selectedPrecipitation.type||"NONE",
          intensity:Number(selectedPrecipitation.intensity??(selectedPrecipitation.type==="HEAVY_RAIN"?1.5:selectedPrecipitation.type==="NONE"?0:1)),
          turnsRemaining:selectedPrecipitation.type==="NONE"?null:Math.max(1,Number(selectedPrecipitation.duration??EnvironmentEngine.WEATHER_TURNS?.[selectedPrecipitation.type]??2))
        };
        if(Number(selectedPrecipitation.thunder||0)>0){
          climate.thunder={intensity:Number(selectedPrecipitation.thunder||1),turnsRemaining:Math.max(1,Number(selectedPrecipitation.duration??2))};
        }
      }
      const fogChance=Math.max(0,Math.min(1,Number(climatePool.fogChance||0)));
      if(fogRandom()<fogChance){
        climate.fog={intensity:Number(climatePool.fogIntensity||1),turnsRemaining:Math.max(1,Number(climatePool.fogDuration||EnvironmentEngine.WEATHER_TURNS?.FOG||2))};
      }else if(!climate.fog){
        climate.fog={intensity:0,turnsRemaining:null};
      }
    }else{
      const valid=legacyPool.filter(entry=>EnvironmentEngine.WEATHER?.[entry?.weather]);
      if(valid.length){
        selectedPreset=weightedChoice(valid,climateRandom);
        if(selectedPreset)climate=EnvironmentEngine.climateFromWeather(selectedPreset.weather,selectedPreset.duration??EnvironmentEngine.WEATHER_TURNS?.[selectedPreset.weather]??null);
      }else if(!climate){
        climate=EnvironmentEngine.climateFromWeather(source.weather||"CLEAR",source.weatherTurns??null);
      }
    }

    climate=climate||EnvironmentEngine.climateFromWeather("CLEAR",null);

    const precipType=climate.precipitation?.type||"NONE",thunder=Number(climate.thunder?.intensity||0)>0,fog=Number(climate.fog?.intensity||0)>0;
    let baseStrength=precipType==="SNOW"?.85:precipType==="HEAVY_RAIN"?1.45:precipType==="RAIN"?1.0:fog?.45:.75;
    if(thunder)baseStrength=Math.max(baseStrength,1.85);
    if(Number(selectedPrecipitation?.windMin||0)>0)baseStrength=Math.max(baseStrength,Number(selectedPrecipitation.windMin));

    const windSeed=hashSeed(`${battleSeed}|${stage?.id||"stage"}|WIND`),windRandom=createRandom(windSeed),dirs=[
      {x:1,y:0},{x:1,y:1},{x:0,y:1},{x:-1,y:1},{x:-1,y:0},{x:-1,y:-1},{x:0,y:-1},{x:1,y:-1}
    ];
    const generatedDir=dirs[Math.floor(windRandom()*dirs.length)]||dirs[0],generatedStrength=Math.round((baseStrength*(.82+windRandom()*.36))*100)/100;
    const explicit=source.wind&&typeof source.wind==="object"?source.wind:null;
    const wind=EnvironmentEngine.normalizeWind?.(explicit||climate.wind||{x:source.windX??generatedDir.x,y:source.windY??generatedDir.y,strength:Math.max(Number(source.windStrength??0),generatedStrength)})||{x:generatedDir.x,y:generatedDir.y,strength:generatedStrength};
    climate.wind={...wind};

    const environment={...source,climate,wind};
    delete environment.weather;delete environment.weatherTurns;delete environment.windX;delete environment.windY;delete environment.windStrength;
    const preview=EnvironmentEngine.create(environment),snapshot=EnvironmentEngine.climateSnapshot(preview),weather=snapshot.legacyWeather,weatherTurns=preview.weatherTurnsRemaining;

    return{environment,meta:{weather,weatherTurns,weatherSeed:climateSeed,battleSeed,climateSeed,fogSeed,windSeed,wind:{...wind},climate:snapshot,selectedPreset:selectedPreset?.weather||null,selectedPrecipitation:selectedPrecipitation?{...selectedPrecipitation}:null}};
  }

  function create({stageId,battleSetup,TEAM}){
    const stage=StageDatabase.get(stageId);
    if(!stage)throw new Error(`Unknown stage: ${stageId}`);

    let map;
    if(stage.mode==="VERSUS"&&stage.battlefield?.type==="PROCEDURAL"){
      if(!window.MapGenerator?.generateVersus)throw new Error("MapGenerator.generateVersus is not loaded.");

      const generated=MapGenerator.generateVersus({
        size:battleSetup?.mapSize||stage.battlefield.defaultSize||"MEDIUM",
        seed:battleSetup?.seed,
        coreRules:stage.coreRules||{}
      });

      map=generated.map;
      stage.cores=generated.cores;
      stage.deploymentPoints=generated.deploymentPoints;
      stage.generatedBattlefield=generated.meta;

      if(battleSetup&&!battleSetup.seed)battleSetup.seed=generated.meta.seed;
      if(battleSetup&&!battleSetup.mapSize)battleSetup.mapSize=generated.meta.size;
    }else{
      map=MapDatabase.createMap(stage.mapId);
    }

    if(window.EnvironmentObjectEngine){
      EnvironmentObjectEngine.initializeMap(map,{seed:battleSetup?.seed??stage.generatedBattlefield?.seed??stage.id});
    }
    if(window.HydrologyEngine)HydrologyEngine.initializeMap(map);

    const stageState=StageEngine.create(stage.scriptId,{
      victory:stage.victory,
      defeat:stage.defeat
    });

    const cores=(stage.cores||[]).map(core=>({
      ...core,
      hp:Number(core.hp??core.maxHp??0),
      maxHp:Number(core.maxHp??core.hp??0),
      shield:Number(core.shield??core.maxShield??0),
      maxShield:Number(core.maxShield??core.shield??0)
    }));

    const resolvedEnvironment=resolveEnvironment(stage,battleSetup||{});
    const environmentState=window.EnvironmentEngine
      ?EnvironmentEngine.create(resolvedEnvironment.environment)
      :null;

    if(resolvedEnvironment.meta){
      stage.generatedEnvironment={...resolvedEnvironment.meta};
      if(stage.generatedBattlefield){
        stage.generatedBattlefield.environment={...resolvedEnvironment.meta};
      }
      if(battleSetup){
        battleSetup.openingWeather=resolvedEnvironment.meta.weather;
        battleSetup.weatherSeed=resolvedEnvironment.meta.weatherSeed;
        battleSetup.openingClimate=JSON.parse(JSON.stringify(resolvedEnvironment.meta.climate));
        battleSetup.climateSeed=resolvedEnvironment.meta.climateSeed;
        battleSetup.openingWind={...resolvedEnvironment.meta.wind};
        battleSetup.windSeed=resolvedEnvironment.meta.windSeed;
      }
    }

    const units=[];
    if(window.ClimateEngine&&environmentState){
      ClimateEngine.initializeMap(map,environmentState);
    }

    const createUnit=(id,team,characterId,x,y)=>
      UnitRuntimeEngine.create({id,team,characterId,x,y,map});

    const forcedHeroIds=new Set(
      (stage.playerSpawns||[])
        .filter(s=>s.source==="STAGE")
        .map(s=>s.characterId)
    );

    const requestedDeck=
      Array.isArray(battleSetup?.deck)&&battleSetup.deck.length
        ?battleSetup.deck
        :stage.battleDeck||[];

    const battleDeck=requestedDeck.filter(cardId=>{
      const card=CardDatabase.get(cardId);
      return !(
        CardDatabase.isCharacter(card)&&
        card.unitType==="HERO"&&
        forcedHeroIds.has(card.characterId)
      );
    });

    const cardState=CardPhaseEngine.create({
      deck:battleDeck,
      startingCrystals:Number(stage.cardRules?.startingCrystals||4),
      maxCrystals:Number(stage.cardRules?.maxCrystals||10),
      crystalGrowth:Number(stage.cardRules?.crystalGrowth||1),
      handSize:Number(stage.cardRules?.handSize||5)
    });

    const enemyCardState=CardPhaseEngine.create({
      deck:stage.enemyDeck||[],
      startingCrystals:Number(stage.enemyCardRules?.startingCrystals||stage.cardRules?.startingCrystals||4),
      maxCrystals:Number(stage.enemyCardRules?.maxCrystals||stage.cardRules?.maxCrystals||10),
      crystalGrowth:Number(stage.enemyCardRules?.crystalGrowth||stage.cardRules?.crystalGrowth||1),
      handSize:Number(stage.enemyCardRules?.handSize||stage.cardRules?.handSize||5)
    });

    DeckEngine.shuffle(cardState.zones);
    DeckEngine.shuffle(enemyCardState.zones);
    DeckEngine.draw(
      enemyCardState.zones,
      Number(stage.enemyCardRules?.handSize||stage.cardRules?.handSize||5)
    );

    (stage.playerSpawns||[]).forEach((u,i)=>
      units.push(createUnit(`p${i}`,TEAM.PLAYER,u.characterId,u.x,u.y))
    );
    (stage.enemySpawns||[]).forEach((u,i)=>
      units.push(createUnit(`e${i}`,TEAM.ENEMY,u.characterId,u.x,u.y))
    );

    const encounterState=window.EncounterEngine?.create?.(
      stage.encounters||[],
      {map,units,createUnit}
    )||null;

    if(encounterState){
      stageState.encounterState=encounterState;
      EncounterEngine.spawnInitial(encounterState);
    }

    return{
      stage,
      map,
      stageState,
      cores,
      environmentState,
      units,
      cardState,
      enemyCardState,
      encounterState,
      unitSerial:0
    };
  }

  return Object.freeze({create,resolveEnvironment});
})();
globalThis.BattleSetupEngine=BattleSetupEngine;
