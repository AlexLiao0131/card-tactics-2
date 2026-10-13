(()=>{
"use strict";
const TILE_EFFECT_INFO=Object.freeze({
  TORNADO:{name:"龍捲風",interaction:"持續風場；地面單位進入時觸發共用強制位移與墜落判定。"},WHIRLPOOL:{name:"漩渦",interaction:"只存在於相連水域；把水面／水中單位拉向核心，靠近核心時會被拖入水下。"},BURNING:{name:"燃燒",interaction:"小火可被水／豪雨／降雪熄滅；風可使燃燒區形成火龍捲。"},BOILING:{name:"沸騰",interaction:"水體受持續高熱後進入沸騰；水中單位受高熱傷害，再次受高熱會逐步蒸發水量。"},STEAM:{name:"蒸氣",interaction:"蒸發／高熱產生的視線遮蔽；可被風力吹散。"},FRAGMENTS:{name:"岩石破片",interaction:"爆炸擊中石質環境時產生的物理破片效果。"},FIRE_TORNADO:{name:"火龍捲",interaction:"燃燒區受到風力作用形成；造成高額火焰環境傷害。"},ELECTRIFIED:{name:"帶電",interaction:"雷元素會沿四向相連的實際水體傳導；雨天與泥地本身不導電。"},SNOW:{name:"積雪",interaction:"積雪會增加移動成本；高山厚雪受爆炸／衝擊可引發雪崩。"},ICE:{name:"結冰",interaction:"冰面可讓單位走在水面上，但重量超過承載能力會踩裂。"},CURRENT:{name:"急流",interaction:"豪雨／雷雨會提高河流流速；急流可用共用強制位移把單位往下游沖走。"}
});
const TILE_ENVIRONMENT_NAME=Object.freeze({NONE:"一般",GRASS:"草木",WATER:"水",STONE:"石質"});
const WEATHER_NAME=Object.freeze({CLEAR:"晴朗",FOG:"迷霧",RAIN:"雨",HEAVY_RAIN:"豪大雨",THUNDERSTORM:"雷雨",TYPHOON:"颱風",SNOW:"降雪",BLIZZARD:"暴風雪",SCORCHING_SUN:"烈日"});
function create(ctx){
  if(!ctx?.state)throw new Error("BattlePresentationController requires state().");
  function teamPresentation(team){if(team===ctx.TEAM?.PLAYER||team==="P"||team==="PLAYER")return"PLAYER";if(team===ctx.TEAM?.ENEMY||team==="E"||team==="ENEMY")return"ENEMY";if(team===ctx.TEAM?.NEUTRAL||team==="N"||team==="NEUTRAL")return"NEUTRAL";return String(team||"NEUTRAL");}
  function tileHydrology(tile){
    const depth=Number(window.HydrologyEngine?.waterDepth?.(tile)??tile?.waterDepth??0),surface=window.HydrologyEngine?.waterSurfaceZ?.(tile);
    const edgeOutflows=Object.fromEntries(Object.entries(tile?.hydrologyEdgeOutflows||{}).map(([dir,flow])=>[dir,{...flow}]));
    const edgeDischarge=Object.fromEntries(Object.entries(tile?.hydrologyEdgeDischarge||{}).map(([dir,flow])=>[dir,{...flow}]));
    return{
      waterDepth:Math.max(0,Number.isFinite(depth)?depth:0),waterSurfaceZ:surface==null?null:Number(surface),soilMoisture:Number(tile?.soilMoisture||0),debrisMass:Number(tile?.debrisMass||0),material:tile?.material||null,snowDepth:Number(tile?.snowDepth||0),iceThickness:Number(tile?.iceThickness||0),flowX:Number(tile?.flowX||0),flowY:Number(tile?.flowY||0),flowSpeed:Number(tile?.flowSpeed||0),river:!!tile?.river,ford:!!tile?.ford,
      hydrologySource:tile?.hydrologySource===true,hydrologySourceDisabled:tile?.hydrologySourceDisabled===true,hydrologySourceInflow:Number(tile?.hydrologySourceInflow||0),hydrologyRequestedSourceInflow:Number(tile?.hydrologyRequestedSourceInflow||0),
      hydrologyEdgeOutflows:edgeOutflows,hydrologyEdgeDischarge:edgeDischarge,hydrologyCascadeToX:tile?.hydrologyCascadeToX??null,hydrologyCascadeToY:tile?.hydrologyCascadeToY??null,hydrologyCascadeDrop:Number(tile?.hydrologyCascadeDrop||0),hydrologyChannelBaseElevation:tile?.hydrologyChannelBaseElevation??null,
      ...(tile?.dryTerrain?{dryTerrain:tile.dryTerrain}:{})
    };
  }
  function unitRenderZ(unit,tile){
    // BurialEngine owns the buried figure pose; otherwise VerticalMobilityEngine
    // owns swim/flight/dive poses. Never paint a buried unit above the deposit.
    if(globalThis.BurialEngine?.state?.(unit)&&Number.isFinite(Number(unit?.renderZ)))return Number(unit.renderZ);
    const vertical=globalThis.VerticalMobilityEngine?.describe?.(unit,tile);
    return Number(vertical?.renderZ??unit?.z??TacticalEngine.elevation(tile)??0);
  }
  const viewerTeam=ctx.viewerTeam??ctx.TEAM?.PLAYER??"P";
  function viewerObservers(s){return(s.units||[]).filter(unit=>unit.alive&&unit.team===viewerTeam)}
  function visibilityModel(){
    const s=ctx.state(),allVisible=new Set((s.map?.tiles||[]).map(tile=>`${tile.x},${tile.y}`));
    const intelMode=s.stage?.intelMode||(s.stage?.mode==="VERSUS"?"DYNAMIC_INTEL":"FULL_VISIBILITY");
    // This mask only governs tactical knowledge. Terrain/weather never inherit it.
    if(intelMode!=="DYNAMIC_INTEL")return{active:false,visible:allVisible,observerless:false};
    const observers=[...viewerObservers(s),...TacticalEngine.teamVisionSources(s,viewerTeam)];
    const visible=new Set();
    for(const tile of s.map?.tiles||[])
      if(TacticalEngine.teamCanSee(s.map,s.units,viewerTeam,tile,s.environmentState,s))visible.add(`${tile.x},${tile.y}`);
    return{active:true,visible,observerless:!observers.length};
  }
  function tileVisible(tile,visibility=visibilityModel()){return !!tile&&visibility.visible.has(`${tile.x},${tile.y}`)}
  function unitVisibleToPlayer(unit){
    // TacticalEngine owns visibility; Renderer/Presentation may only read it.
    return TacticalEngine.teamCanIdentifyUnit(ctx.state(),viewerTeam,unit);
  }
  function tileInteractions(tile,effects){const s=ctx.state(),environment=EnvironmentEngine.environmentAt(s.map,tile.x,tile.y),notes=[];if(environment==="GRASS"){if(EnvironmentEngine.isRain(s.environmentState))notes.push("草木受雨勢影響，小火無法形成持續燃燒。");else notes.push("草木可被 FIRE／HEAVY_FIRE 點燃。");}if(environment==="WATER"){notes.push("小火會被熄滅；HEAVY_FIRE 先融冰，再使液態水沸騰並逐步蒸發。");notes.push("降雨先使平地飽和成泥濘；土壤飽和或湖水溢流後才形成地表積水。");notes.push("水域可傳導雷元素；河道在豪雨／雷雨／颱風時會形成急流。 ");}if(environment==="STONE")notes.push("EXPLOSION 可產生岩石破片；高山厚雪可被爆炸／衝擊觸發雪崩。");if(tile.terrain==="MUD")notes.push("泥濘提高一般移動成本；雨勢結束後逐步乾燥。");for(const effect of effects||[]){const note=TILE_EFFECT_INFO[effect.type]?.interaction;if(note&&!notes.includes(note))notes.push(note);}return notes;}
  function tileAnnotation(tile){if(!tile)return"";const s=ctx.state(),terrain=TERRAINS[tile.terrain]||{},environment=EnvironmentEngine.environmentAt(s.map,tile.x,tile.y),effects=s.environmentState?EnvironmentEngine.effectAt(s.environmentState,tile.x,tile.y):[],object=(s.map.objects||[]).find(o=>!o.destroyed&&o.x===tile.x&&o.y===tile.y),depth=HydrologyEngine.waterDepth(tile),surface=HydrologyEngine.waterSurfaceZ(tile),lines=[`地圖格 (${tile.x},${tile.y})｜${terrain.name||tile.terrain}｜H${Number(tile.elevation||0)}`,`移動成本：${terrain.passable===false?"不可通行":terrain.moveCost??"-"}｜迴避修正：${Number(terrain.evasion||0)>=0?"+":""}${Number(terrain.evasion||0)}${terrain.rangedAccuracy?`｜遠程命中 +${terrain.rangedAccuracy}`:""}`,`環境材質：${TILE_ENVIRONMENT_NAME[environment]||environment}｜天候：${WEATHER_NAME[s.environmentState?.weather]||s.environmentState?.weather||"晴朗"}｜風況：${globalThis.EnvironmentEngine?.windLabel?.(EnvironmentEngine.windAt?.(s.environmentState)||{})||"無風"}`];if(depth>0)lines.push(`水文：地面 H${Number(tile.elevation||0)}｜水深 ${Number(depth).toFixed(2)}｜水面 H${Number(surface).toFixed(2)}`);if(Number(tile.snowDepth||0)>0)lines.push(`積雪：${Number(tile.snowDepth).toFixed(2)}`);if(Number(tile.iceThickness||0)>0)lines.push(`冰厚：${Number(tile.iceThickness).toFixed(2)}`);if(tile.river)lines.push(`河流：流速 ${Number(tile.flowSpeed||0).toFixed(2)}${tile.ford?"｜淺灘／渡口":""}`);if(object)lines.push(`地圖物件：${object.name||object.id}${object.destructible?"｜可破壞":""}`);if(effects.length)lines.push("目前效果："+effects.map(effect=>{const info=TILE_EFFECT_INFO[effect.type],duration=effect.duration==null?"":`（剩 ${effect.duration} 回合）`,damage=effect.damage?`／傷害 ${effect.damage}`:"";return`${info?.name||effect.type}${duration}${damage}`;}).join("、"));else lines.push("目前效果：無");const interactions=tileInteractions(tile,effects);lines.push(`環境互動：${interactions.length?interactions.join(" "):"目前沒有特殊互動。"}`);return lines.join("\n");}
  function combatPreview(attacker,target,skill){if(!attacker?.alive||!target?.alive||!skill||target.kind==="CORE")return null;const s=ctx.state(),resolved=ctx.effectiveSkill(attacker,skill),at=TacticalEngine.tile(s.map,attacker.x,attacker.y),dt=TacticalEngine.tile(s.map,target.x,target.y),weapon=attacker.character.weapons?.[resolved.weapon],type=resolved.attackType==="INHERIT"?weapon?.attackType:resolved.attackType,terrainAcc=at?.terrain==="HIGH_GROUND"&&(type==="SHOT"||type==="MAGIC")&&at.elevation>dt?.elevation?Number(TERRAINS[at.terrain]?.rangedAccuracy||0):0,terrainEva=Number(TERRAINS[dt?.terrain]?.evasion||0),ac={...attacker.character,modifiers:{...(attacker.character.modifiers||{}),accuracy:Number(attacker.character.modifiers?.accuracy||0)+terrainAcc}},dc={...target.character,modifiers:{...(target.character.modifiers||{}),evasion:Number(target.character.modifiers?.evasion||0)+terrainEva}};return{skillId:resolved.id,skillName:resolved.name,hit:BattleEngine.hitChance(ac,dc,resolved),crit:BattleEngine.critChance(ac,resolved),terrainAcc,terrainEva};}
  function unitSkillPresentation(unit){
    if(!unit?.character)return[];
    const ids=window.EffectEngine?EffectEngine.skillIds(unit):unit.character.skills;
    return SkillDatabase.list(ids).map(skill=>{
      const range=TacticalEngine.range(skill);
      return{
        id:skill.id,name:skill.name,category:skill.category||"SKILL",
        range:{min:range.min,max:range.max},
        resource:UnitRuntimeEngine.resourceLabel(unit,skill),
        variants:Array.isArray(skill.variants)?skill.variants.map(variant=>({id:variant.id,name:variant.name||variant.id})):[]
      };
    });
  }
  function unitPresentation(unit){
    const s=ctx.state();if(!unit?.alive)return null;
    const visibility=visibilityModel(),tile=TacticalEngine.tile(s.map,unit.x,unit.y),team=teamPresentation(unit.team);
    if(unit.team!==viewerTeam&&!unitVisibleToPlayer(unit,visibility))return null;
    const maxHp=Number(unit.character.combat.hp||unit.hp||1),combat=unit.character.combat||{},baseHit=Math.max(BATTLE_RULES.combatParams.minHit,Math.min(BATTLE_RULES.combatParams.maxHit,BATTLE_RULES.combatParams.baseHit+BattleEngine.accuracy(unit.character,{}))),actionState=team==="ENEMY"?"敵方單位":team==="NEUTRAL"?"中立／野怪":unit.acted?(unit.waited?"已待機":"已完成主動行動 / 可支援"):unit.moved?"已移動 / 可攻擊":"可移動 / 可行動",preview=s.selected&&s.selected!==unit&&s.selectedSkill&&s.mode==="attack"?combatPreview(s.selected,unit,s.selectedSkill):null;UnitRuntimeEngine.syncMana(unit);UnitRuntimeEngine.syncResources(unit);
    const vertical=globalThis.VerticalMobilityEngine?.describe?.(unit,tile)||null;
    const shownHp=unit.hallucination?Math.max(1,Number(unit.perceivedHp||maxHp)):unit.hp,shownMaxHp=unit.hallucination?Math.max(1,Number(unit.perceivedMaxHp||maxHp)):maxHp;
    return{id:unit.id,team,name:unit.character.name,visualId:unit.character.visualId||null,facing:TacticalEngine.ensureFacing(unit),hp:shownHp,maxHp:shownMaxHp,mana:unit.mana,maxMana:unit.maxMana,resources:UnitRuntimeEngine.resourceSnapshot(unit),move:Number(combat.move||0),x:unit.x,y:unit.y,z:Number(unit.z??(tile?.elevation||0)),renderZ:Number(vertical?.renderZ??unitRenderZ(unit,tile)),verticalMode:vertical?.mode||null,verticalLayer:vertical?.layer||null,immersionDepth:Number(vertical?.immersionDepth||0),verticalSurfaceZ:Number(vertical?.surfaceZ??tile?.elevation??0),collisionHeight:Number(unit.character?.collision?.height||0),terrain:tile?TERRAINS[tile.terrain]?.name||tile.terrain:"",elevation:Number(tile?.elevation||0),stealthed:!!globalThis.EffectEngine?.isStealthed?.(unit),friendlyToViewer:unit.team===viewerTeam,actionState,stats:{atk:Number(combat.atk||0),def:Number(combat.def||0),matk:Number(combat.matk||0),mdef:Number(combat.mdef||0),hit:baseHit,eva:BattleEngine.evasion(unit.character),crit:BattleEngine.critChance(unit.character,{}),spd:BattleEngine.actionSpeed(unit.character,{})},skills:unitSkillPresentation(unit),preview};
  }
  function equipmentLightSources(s,visibility){
    const out=[];
    for(const unit of s?.units||[]){
      // Do not reveal hidden enemy positions with an equipped light. The same
      // visibility owner already gates the unit mesh and its own-tile glow.
      if(!unitVisibleToPlayer(unit,visibility))continue;
      for(const light of globalThis.EquipmentDatabase?.lightSources?.(unit.character)||[]){
        out.push({
          x:Number(unit.x||0),y:Number(unit.y||0),
          radius:Math.max(0,Number(light.radius||0)),
          source:"EQUIPMENT_LIGHT",
          sourceId:light.sourceId||null,
          sourceName:light.sourceName||null,
          unitId:unit.id,
          team:unit.team,
          kind:light.kind||null,
          color:light.color||null,
          intensity:Number(light.intensity||1)
        });
      }
    }
    return out;
  }
  function presentationLightSources(s,visibility){
    // Fire affects the burning cell and its eight neighbors, never a guessed
    // world-space radius. This is presentation only; existing gameplay LOS
    // and EnvironmentEngine lightRadius remain unchanged.
    const environmentLights=(s.environmentState?EnvironmentEngine.lightSources(s.environmentState):[]).map(light=>{
      const flame=light.source==="BURNING"||light.source==="FIRE_TORNADO";
      return flame?{...light,footprint:"FIRE_3X3",intensity:light.source==="FIRE_TORNADO"?1.2:.94,color:[1,.45,.14]}:light;
    });
    const sourceObservers=[...viewerObservers(s),...TacticalEngine.teamVisionSources(s,viewerTeam)];
    const structureLights=[];
    const points=DeploymentEngine.points(s.stage);
    // The light radius is derived from the *actual deployment cells*, rather
    // than a fixed number of squares. Keep one point-light candidate per site.
    const coverRadius=(origin,cells,minimum)=>Math.max(minimum,Math.ceil(Math.max(0,...(cells||[]).map(p=>Math.hypot(p.x-origin.x,p.y-origin.y)))+1));
    for(const core of s.cores||[]){
      if(Number(core.hp||0)<=0)continue;
      const home=points.filter(p=>p.owner===core.owner).sort((a,b)=>Math.hypot((a.captureTiles?.[0]?.x??99)-core.x,(a.captureTiles?.[0]?.y??99)-core.y)-Math.hypot((b.captureTiles?.[0]?.x??99)-core.x,(b.captureTiles?.[0]?.y??99)-core.y))[0];
      const cells=(home?.area||[]).length?home.area:[{x:core.x,y:core.y}];
      structureLights.push({x:core.x,y:core.y,radius:coverRadius(core,cells,3),cells:cells.map(cell=>({x:cell.x,y:cell.y})),source:"CORE_LIGHT",sourceId:core.id,steady:true,intensity:1.8,color:core.owner==="PLAYER"?[.42,.66,1]:[1,.40,.36]});
    }
    // The captured site's ownership governs physical illumination. An empty
    // garrison still retains the site; losing the capture changes its owner.
    // Its *tactical vision* remains separately defender-gated by TacticalEngine.
    for(const point of points){
      const held=point.owner==="PLAYER"||point.owner==="ENEMY";
      if(!held||point.capturable===false)continue;
      const center=point.captureTiles?.[0];if(!center)continue;
      const cells=(point.area||[]).length?point.area:[center];
      structureLights.push({x:center.x,y:center.y,radius:coverRadius(center,cells,2),cells:cells.map(cell=>({x:cell.x,y:cell.y})),source:"CAPTURE_LIGHT",sourceId:point.id,steady:true,intensity:1.65,color:point.owner==="PLAYER"?[.42,.72,1]:[1,.52,.32]});
    }
    // Units illuminate only their own occupied tile. A hidden hostile is not
    // published: its illumination cannot leak tactical intelligence to a viewer.
    const unitLights=(s.units||[]).filter(unit=>unit?.alive&&unitVisibleToPlayer(unit,visibility))
      .map(unit=>({x:unit.x,y:unit.y,cells:[{x:unit.x,y:unit.y}],source:"UNIT_TILE_LIGHT",sourceId:unit.id,
        intensity:unit.team===viewerTeam?.70:.45,color:unit.team===viewerTeam?[.57,.78,1]:[1,.70,.43],steady:true}));
    // Lighting is world presentation, not enemy intel. Mist scatter uses real optical transmission.
    return[...environmentLights,...equipmentLightSources(s,visibility),...structureLights,...unitLights].map(light=>({
      ...light,visible:true,
      transmission:Math.max(0,...sourceObservers.map(observer=>TacticalEngine.lightTransmission(s.map,observer,light,s.environmentState)))
    }));
  }
  function battleSnapshot(){
    const s=ctx.state(),visibility=visibilityModel(),reachable=s.selected&&s.phase===ctx.PHASE.PLAYER&&!s.selected.acted&&!s.selected.moved&&(s.mode==="command"||s.mode==="move")?TacticalEngine.reachable(s.map,s.units,s.selected):new Map(),targets=s.selected&&s.phase===ctx.PHASE.PLAYER&&!s.selected.acted&&s.mode==="attack"&&s.selectedSkill&&ctx.targetType(s.selectedSkill)==="SINGLE"?ctx.targetableEntities(s.selected,s.selectedSkill):[],targetRange=s.selected&&s.phase===ctx.PHASE.PLAYER&&!s.selected.acted&&s.mode==="attack"&&s.selectedSkill&&ctx.targetType(s.selectedSkill)==="SINGLE"?ctx.targetRangeTiles(s.selected,s.selectedSkill):[],mapTargets=s.selected&&s.phase===ctx.PHASE.PLAYER&&!s.selected.acted&&s.mode==="map-target"&&s.selectedSkill?ctx.mapTargetTiles(s.selected,s.selectedSkill):[],points=DeploymentEngine.points(s.stage),tiles=s.map.tiles.map(tile=>{const unit=ctx.unitAt(tile.x,tile.y),core=ctx.coreAt(tile.x,tile.y),capturePoint=points.find(point=>(point.captureTiles||[]).some(t=>t.x===tile.x&&t.y===tile.y))||null,effects=s.environmentState?EnvironmentEngine.effectAt(s.environmentState,tile.x,tile.y):[],deployable=!!(s.pendingCard&&s.phase===ctx.PHASE.CARD&&CardDatabase.isCharacter(s.pendingCard)&&DeploymentEngine.canDeploy({stage:s.stage,map:s.map,units:s.units,owner:"PLAYER",x:tile.x,y:tile.y})),spellTargetable=!!(s.pendingCard&&s.phase===ctx.PHASE.CARD&&CardDatabase.isSpell(s.pendingCard)&&TacticalEngine.teamCanCastSpell(s.map,s.units,viewerTeam,tile,s.environmentState,s,s.pendingCard)&&(!s.pendingCard.effect?.targetEnvironment||String(s.pendingCard.effect.targetEnvironment).toUpperCase()!=="WATER"||HydrologyEngine.isWater(tile))),attackable=!!(spellTargetable||(unit&&unitVisibleToPlayer(unit,visibility)&&targets.includes(unit))||(core&&targets.some(target=>target.kind==="CORE"&&target.core===core))||mapTargets.includes(tile));return{x:tile.x,y:tile.y,terrain:tile.terrain,elevation:Number(tile.elevation||0),...tileHydrology(tile),reachable:reachable.has(tile.x+","+tile.y),targetRange:targetRange.includes(tile),attackable,deployable,inspected:!!(s.inspectedTile&&s.inspectedTile.x===tile.x&&s.inspectedTile.y===tile.y),effects:effects.map(effect=>effect.type),effectDetails:effects.map(effect=>({
      type:String(effect?.type||""),
      intensity:effect?.intensity==null?null:Number(effect.intensity),
      duration:effect?.duration==null?null:Number(effect.duration),
      visionBlock:effect?.visionBlock===true,
      element:effect?.element==null?null:String(effect.element),
      clusterSize:effect?.clusterSize==null?null:Number(effect.clusterSize),
      clusterStrength:effect?.clusterStrength==null?null:Number(effect.clusterStrength),
      pushDistance:effect?.pushDistance==null?null:Number(effect.pushDistance),
      lift:effect?.lift==null?null:Number(effect.lift),
      damage:effect?.damage==null?null:Number(effect.damage),
      carriedLogs:effect?.carriedLogs==null?null:Number(effect.carriedLogs),
      debrisDamage:effect?.debrisDamage==null?null:Number(effect.debrisDamage),
      vortexId:effect?.vortexId==null?null:String(effect.vortexId),
      centerX:effect?.centerX==null?null:Number(effect.centerX),
      centerY:effect?.centerY==null?null:Number(effect.centerY),
      radius:effect?.radius==null?null:Number(effect.radius),
      strength:effect?.strength==null?null:Number(effect.strength),
      pullDistance:effect?.pullDistance==null?null:Number(effect.pullDistance),
      submergeTurns:effect?.submergeTurns==null?null:Number(effect.submergeTurns)
    })),fogged:false,visionBlocked:!!s.environmentState&&!!EnvironmentEngine.visionModifier(s.environmentState,tile.x,tile.y)?.blocked,deploymentAreaOwner:points.find(point=>(point.area||[]).some(t=>t.x===tile.x&&t.y===tile.y))?.owner||null,capturePoint:capturePoint?{id:capturePoint.id,name:capturePoint.name,owner:capturePoint.owner}:null,core:core?{id:core.id,owner:core.owner,name:core.name,hp:core.hp,maxHp:core.maxHp}:null};});
    return{revision:s.renderRevision,phase:s.phase,round:s.round,mode:s.mode,map:{id:s.map.id,width:s.map.width,height:s.map.height,tiles,objects:(s.map.objects||[]).map(o=>({...o}))},cores:s.cores.map(core=>({...core})),presentation:{deploymentPoints:points.map(point=>({id:point.id,name:point.name,owner:point.owner,capturable:point.capturable!==false,area:(point.area||[]).map(t=>({...t})),captureTiles:(point.captureTiles||[]).map(t=>({...t}))})),environment:{lightSources:presentationLightSources(s,visibility),weather:s.environmentState?.weather||"CLEAR",fogIntensity:Number(globalThis.EnvironmentEngine?.fogAt?.(s.environmentState)?.intensity||0),weatherTurnsRemaining:s.environmentState?.weatherTurnsRemaining??null,timeOfDay:s.environmentState?.timeOfDay||"DAY",moonlight:s.environmentState?.moonlight||"PARTIAL",wind:globalThis.EnvironmentEngine?.climateSnapshot?.(s.environmentState)?.wind||null},enemyHandCount:s.enemyCardState?.zones?.hand?.length||0,enemyDeckCount:s.enemyCardState?.zones?.deck?.length||0},units:s.units.filter(u=>u.alive&&unitVisibleToPlayer(u,visibility)).map(u=>{
      const tile=TacticalEngine.tile(s.map,u.x,u.y),vertical=globalThis.VerticalMobilityEngine?.describe?.(u,tile)||null;
      const normalMaxHp=Number(u.character.combat.hp||u.hp||1),shownHp=u.hallucination?Math.max(1,Number(u.perceivedHp||normalMaxHp)):u.hp,shownMaxHp=u.hallucination?Math.max(1,Number(u.perceivedMaxHp||normalMaxHp)):normalMaxHp;
      return{id:u.id,x:u.x,y:u.y,z:Number(u.z??(TacticalEngine.elevation(tile)||0)),renderZ:unitRenderZ(u,tile),verticalMode:vertical?.mode||null,verticalLayer:vertical?.layer||null,immersionDepth:Number(vertical?.immersionDepth||0),verticalSurfaceZ:Number(vertical?.surfaceZ??tile?.elevation??0),collisionHeight:Number(u.character?.collision?.height||0),facing:TacticalEngine.ensureFacing(u),team:teamPresentation(u.team),faction:u.faction||null,monsterId:u.monsterId||null,name:u.character.name,visualId:u.character.visualId||null,hp:shownHp,maxHp:shownMaxHp,mana:(UnitRuntimeEngine.syncMana(u),u.mana),maxMana:u.maxMana,resources:UnitRuntimeEngine.resourceSnapshot(u),selected:!u.hallucination&&u===s.selected,finished:!!u.acted,moved:!!u.moved,acted:!!u.acted,stealthed:!!globalThis.EffectEngine?.isStealthed?.(u),friendlyToViewer:u.team===viewerTeam};
    })};
  }
  return Object.freeze({battleSnapshot,unitPresentation,combatPreview,tileAnnotation});
}
window.BattlePresentationController=Object.freeze({create});
})();
