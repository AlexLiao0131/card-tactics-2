export const TileInspectionPresentation=(()=>{
  const ENV={NONE:"一般",GRASS:"草木",WATER:"水",STONE:"石質"},WEATHER={CLEAR:"晴朗",FOG:"迷霧",RAIN:"雨",HEAVY_RAIN:"豪大雨",THUNDERSTORM:"雷雨",TYPHOON:"颱風",SNOW:"降雪",BLIZZARD:"暴風雪",SCORCHING_SUN:"烈日"};
  const EFFECT={TORNADO:"龍捲風",BURNING:"燃燒",BOILING:"沸騰",STEAM:"蒸氣",SMOKE:"黑煙",FRAGMENTS:"岩石破片",FIRE_TORNADO:"火龍捲",ELECTRIFIED:"帶電",SNOW:"積雪",ICE:"結冰",CURRENT:"急流"};
  const fmt=n=>Math.round(Number(n||0)*100)/100;
  const windName=wind=>{const x=Math.sign(Number(wind?.x||0)),y=Math.sign(Number(wind?.y||0));return x===0&&y<0?"北":x>0&&y<0?"東北":x>0&&y===0?"東":x>0&&y>0?"東南":x===0&&y>0?"南":x<0&&y>0?"西南":x<0&&y===0?"西":x<0&&y<0?"西北":"無風";};
  const turns=v=>v==null?"":` ${Math.max(0,Number(v||0))}T`;
  function climateLabels(environmentState){
    if(!environmentState)return["晴朗"];
    const climate=EnvironmentEngine.climateSnapshot?.(environmentState);
    if(!climate)return[WEATHER[environmentState.weather]||environmentState.weather||"晴朗"];
    if(climate.legacyWeather==="TYPHOON")return[`颱風${turns(climate.precipitation?.turnsRemaining)}`];
    const out=[],p=climate.precipitation||{};
    if(p.type==="RAIN")out.push(`雨${turns(p.turnsRemaining)}`);
    else if(p.type==="HEAVY_RAIN")out.push(`豪大雨${turns(p.turnsRemaining)}`);
    else if(p.type==="SNOW")out.push(`${EnvironmentEngine.isBlizzard?.(environmentState)?"暴風雪":"降雪"}${turns(p.turnsRemaining)}`);
    if(Number(climate.fog?.intensity||0)>0)out.push(`霧${turns(climate.fog.turnsRemaining)}`);
    if(Number(climate.thunder?.intensity||0)>0)out.push(`雷暴${turns(climate.thunder.turnsRemaining)}`);
    if(!out.length)out.push("晴朗");
    return out;
  }
  function create({map,environmentState,tile}){
    if(!map||!tile)return null;
    const terrain=TERRAINS[tile.terrain]||{},material=EnvironmentEngine.environmentAt(map,tile.x,tile.y),effects=environmentState?EnvironmentEngine.effectAt(environmentState,tile.x,tile.y):[],depth=HydrologyEngine.waterDepth(tile),surface=HydrologyEngine.waterSurfaceZ(tile),moisture=HydrologyEngine.soilMoisture?.(tile)||0,snow=Number(tile.snowDepth||0),ice=Number(tile.iceThickness||0),flow=Number(tile.flowSpeed||0),ground=Number(tile.elevation||0),move=terrain.passable===false?"×":terrain.moveCost??"-",eva=`${Number(terrain.evasion||0)>=0?"+":""}${Number(terrain.evasion||0)}`;
    const objects=window.EnvironmentObjectEngine?.activeObjectsAt?.(map,tile.x,tile.y)||(map.objects||[]).filter(o=>!o.destroyed&&o.x===tile.x&&o.y===tile.y);
    const rootStrength=Number(window.EnvironmentObjectEngine?.rootStrengthAt?.(map,tile)||0),slope=Number(tile.slopeStability??window.EnvironmentResolver?.stability?.(environmentState,tile,map)??0);
    const title=depth>0?`${terrain.name||tile.terrain}｜地面 H${fmt(ground)}｜水面 H${fmt(surface)}`:`${terrain.name||tile.terrain}｜H${fmt(ground)}`,meta=depth>0?`水深 ${fmt(depth)}｜MOVE ${move}｜EVA ${eva}`:`MOVE ${move}｜EVA ${eva}`,summary={title,meta,status:effects.map(e=>EFFECT[e.type]||e.type).join("・")};
    const labels=climateLabels(environmentState),climate=environmentState?EnvironmentEngine.climateSnapshot?.(environmentState):null;
    const details=[`地圖格 (${tile.x},${tile.y})`,`地形：${terrain.name||tile.terrain}｜地面 H${fmt(ground)}`,`環境材質：${ENV[material]||material}｜氣候：${labels.join("＋")}`];
    const wind=climate?.wind||environmentState?.wind;if(wind)details.push(`風向：${windName(wind)}｜風力 ${fmt(wind.strength)}`);
    if(climate?.temperature!=null)details.push(`基準氣溫：${fmt(climate.temperature)}°C`);
    if(depth>0)details.push(`水深：${fmt(depth)}｜水面 H${fmt(surface)}｜Surface Water ${fmt(depth)}`);
    if(tile.terrain==="MUD")details.push(`土壤含水：${fmt(moisture)}/${fmt(HydrologyEngine.soilCapacity?.(tile)||HydrologyEngine.SOIL_SATURATION_CAPACITY||1)}｜泥濘飽和後才形成地表積水。`);
    if(tile.terrain==="SAND")details.push(`沙地含水：${fmt(moisture)}/${fmt(HydrologyEngine.soilCapacity?.(tile)||1)}｜高滲透、低黏著，較容易被侵蝕。`);
    if(rootStrength>0||tile.terrain==="FOREST")details.push(`水土保持：根系 ${fmt(rootStrength)}｜坡面穩定 ${fmt(slope)}。`);
    if(snow>0)details.push(`積雪深度：${fmt(snow)}｜深雪會增加移動成本。`);
    if(ice>0)details.push(`冰厚：${fmt(ice)}｜重量越大需要越厚冰面；踩裂後重新進入水域判定。`);
    if(tile.river)details.push(`河流：流速 ${fmt(flow)}｜流量 ${fmt(tile.discharge||0)}${tile.ford?"｜此格為淺灘／渡口":""}`);
    if(tile.sourceKind==="OFF_MAP_SOURCE")details.push(`水源：地圖外上游流入${tile.hydrologySource===true?"｜供水中":"｜已停止"}`);
    else if(tile.sourceKind==="SPRING_SOURCE")details.push(`水源：場內泉眼${tile.hydrologySource===true?"｜供水中":"｜已破壞／斷源"}`);
    if(depth>0&&Number.isFinite(Number(tile.hydrologyCascadeToX))&&Number.isFinite(Number(tile.hydrologyCascadeToY))&&Number(tile.hydrologyCascadeDrop||0)>=.18)details.push(`瀑布：→ (${Number(tile.hydrologyCascadeToX)},${Number(tile.hydrologyCascadeToY)})｜落差 ${fmt(tile.hydrologyCascadeDrop)}`);
    if(objects.length)details.push(`物件：${objects.map(o=>`${o.name||o.type||o.id}${o.destructible?`｜耐久 ${Math.round(Number(o.durability??o.maxDurability??0))}/${Math.round(Number(o.maxDurability??o.durability??0))}`:""}`).join("、")}`);
    details.push(`效果：${effects.length?effects.map(e=>`${EFFECT[e.type]||e.type}${e.duration==null?"":` ${e.duration}回合`}${e.type==="BOILING"?`｜Heat ${e.heat||1}`:e.type==="SMOKE"?`｜濃度 ${fmt(e.intensity||0)}`:""}`).join("、"):"無"}`);
    if(effects.some(e=>e.type==="SMOKE"))details.push("黑煙：由燃燒產生，會沿風向漂移並逐步消散；濃煙會遮斷視線。");
    if(material==="WATER")details.push("互動：水體可導電；高熱先沸騰再蒸發；低溫可結冰。河道在豪雨／雷雨／颱風時會增強流速並可能沖走單位。");
    else if(material==="GRASS")details.push(EnvironmentEngine.isRain(environmentState)?"互動：雨勢抑制草木持續燃燒；樹木與灌木提供根系固土。":"互動：草木可被火焰點燃；樹木與灌木提供根系固土，燒毀後坡面穩定會下降。");
    else if(material==="STONE")details.push("互動：爆炸可與石質物件／破片作用；高山積雪受到爆炸／衝擊可觸發雪崩。");
    if(tile.terrain==="MUD")details.push("互動：泥濘提高一般移動成本；泥地本身不是水體導體。");
    if(tile.terrain==="SAND")details.push("互動：沙地移動較慢、保水量低、乾燥較快；土石流侵蝕係數較高。");
    return{summary,details:details.join("\n")};
  }
  return Object.freeze({create,climateLabels});
})();
globalThis.TileInspectionPresentation=TileInspectionPresentation;
