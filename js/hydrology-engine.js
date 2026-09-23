export const WATERLINE = 0;
export const RAIN_FILL_PER_EVENT = 0.06;
export const HEAVY_RAIN_FILL_PER_EVENT = 0.12;
export const STORM_RAIN_FILL_PER_EVENT = 0.16;
export const NATURAL_WATER_DEPTH = 1;
export const SOIL_SATURATION_CAPACITY = 0.45;
export const DRYING_PER_CLEAR_TURN = 0.10;
export const EPSILON = 0.0001;
export const FLOW_EPSILON = 0.0005;
export const MAX_FLOW_ITERATIONS = 256;
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]], FLOW_DIRS=[[1,0],[0,1]], key=(x,y)=>`${x},${y}`;
export const elevation=t=>Number(t?.elevation||0);
export const waterDepth=t=>Math.max(0,Number(t?.waterDepth||0));
export const waterSurfaceZ=t=>waterDepth(t)>EPSILON?elevation(t)+waterDepth(t):null;
export const isWater=t=>!!t&&waterDepth(t)>EPSILON;
const canHoldWater=t=>!!t&&t.terrain!=="WALL";
const clean=v=>Math.max(0,Math.round(Number(v||0)*10000)/10000);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v||0)));
export const soilMoisture=t=>clamp(t?.soilMoisture??(t?.terrain==="MUD"?SOIL_SATURATION_CAPACITY:0),0,SOIL_SATURATION_CAPACITY);
const terrainHasSoil=t=>t==="PLAIN"||t==="MUD"||t==="FOREST";
const hasSoil=t=>!!t&&(terrainHasSoil(t.terrain)||(t.terrain==="WATER"&&terrainHasSoil(t.dryTerrain)));
export function tileAt(map,x,y){return map?.tiles?.find(t=>t.x===x&&t.y===y)||null}
export function surfaceWaterVolume(map){return(map?.tiles||[]).reduce((s,t)=>s+waterDepth(t),0)}
export function soilWaterVolume(map){return(map?.tiles||[]).reduce((s,t)=>s+(hasSoil(t)?soilMoisture(t):0),0)}
export function totalWater(map){return surfaceWaterVolume(map)+soilWaterVolume(map)}
export function initializeMap(map){
  for(const tile of map?.tiles||[]){
    if(tile.terrain==="MUD"){tile.soilMoisture=SOIL_SATURATION_CAPACITY;continue}
    if(tile.terrain!=="WATER")continue;
    if(!Number.isFinite(Number(tile.waterDepth))||Number(tile.waterDepth)<=0){
      tile.waterDepth=NATURAL_WATER_DEPTH;
      tile.elevation=Number(tile.elevation||0)-NATURAL_WATER_DEPTH;
    }
    tile.waterDepth=clean(tile.waterDepth);
    tile.waterSurfaceZ=elevation(tile)+waterDepth(tile);
    tile.dryTerrain??="PLAIN";
    if(terrainHasSoil(tile.dryTerrain))tile.soilMoisture=SOIL_SATURATION_CAPACITY;
  }
  return map;
}
export function connectedWaterBody(map,x,y){
  const start=tileAt(map,x,y);if(!isWater(start))return[];
  const by=new Map((map?.tiles||[]).map(t=>[key(t.x,t.y),t])),seen=new Set(),q=[start],out=[];
  while(q.length){const t=q.shift(),k=key(t.x,t.y);if(seen.has(k))continue;seen.add(k);if(!isWater(t))continue;out.push(t);
    for(const[dx,dy]of DIRS){const n=by.get(key(t.x+dx,t.y+dy));if(n&&!seen.has(key(n.x,n.y))&&isWater(n))q.push(n)}}
  return out;
}
export function fillCapacity(tile){return Math.max(0,WATERLINE-elevation(tile))}
function markMud(tile,events=[],source="SATURATION"){if(!tile||tile.terrain!=="PLAIN")return false;tile.terrain="MUD";events.push({type:"MUD_CREATED",x:tile.x,y:tile.y,source,soilMoisture:soilMoisture(tile)});return true}
function saturateSoil(tile,amount,events=[],source="RAIN"){
  if(!tile||!hasSoil(tile)||amount<=EPSILON)return Math.max(0,Number(amount||0));
  const before=soilMoisture(tile),cap=Math.max(0,SOIL_SATURATION_CAPACITY-before),absorbed=Math.min(cap,Math.max(0,Number(amount||0)));
  if(absorbed>EPSILON){tile.soilMoisture=clean(before+absorbed);if(tile.terrain==="PLAIN")markMud(tile,events,source);events.push({type:"SOIL_MOISTURE_CHANGED",x:tile.x,y:tile.y,from:before,to:tile.soilMoisture,absorbed,source})}
  return Math.max(0,Number(amount||0)-absorbed);
}
function sync(tile,events=[]){
  if(!tile)return;const d=waterDepth(tile);tile.waterDepth=d<=EPSILON?0:clean(d);tile.waterSurfaceZ=tile.waterDepth>0?elevation(tile)+tile.waterDepth:null;
  if(tile.waterDepth>0&&tile.terrain!=="WATER"){const base=tile.terrain;tile.dryTerrain=base;if(terrainHasSoil(base))tile.soilMoisture=SOIL_SATURATION_CAPACITY;tile.terrain="WATER";events.push({type:"BASIN_FILLED",x:tile.x,y:tile.y,elevation:elevation(tile),waterDepth:tile.waterDepth,waterSurfaceZ:tile.waterSurfaceZ,dryTerrain:tile.dryTerrain})}
  else if(tile.waterDepth<=0&&tile.terrain==="WATER"&&tile.dryTerrain){const base=tile.dryTerrain;if(base==="PLAIN"||base==="MUD"){tile.terrain="MUD";tile.soilMoisture=SOIL_SATURATION_CAPACITY}else tile.terrain=base;delete tile.dryTerrain;events.push({type:"BASIN_DRAINED",x:tile.x,y:tile.y,elevation:elevation(tile),waterDepth:0,terrain:tile.terrain})}
}
export function setWaterDepth(tile,nextDepth,events=[],source="HYDROLOGY"){if(!tile)return 0;const before=waterDepth(tile),next=clean(nextDepth);tile.waterDepth=next;if(Math.abs(next-before)>EPSILON)events.push({type:next>before?"WATER_ACCUMULATED":"WATER_REDUCED",x:tile.x,y:tile.y,elevation:elevation(tile),fromDepth:before,waterDepth:next,waterSurfaceZ:next>0?elevation(tile)+next:null,source});sync(tile,events);return next-before}
function pairEquilibrium(a,b){
  if(!canHoldWater(a)||!canHoldWater(b))return 0;const va=waterDepth(a),vb=waterDepth(b),total=va+vb;if(total<=EPSILON)return 0;const ga=elevation(a),gb=elevation(b);let na=0,nb=0;
  if(ga<=gb){const rise=gb-ga;if(total<=rise){na=total;nb=0}else{const level=(total+ga+gb)/2;na=level-ga;nb=level-gb}}
  else{const rise=ga-gb;if(total<=rise){na=0;nb=total}else{const level=(total+ga+gb)/2;na=level-ga;nb=level-gb}}
  na=Math.max(0,na);nb=Math.max(0,nb);const delta=Math.max(Math.abs(na-va),Math.abs(nb-vb));a.waterDepth=na;b.waterDepth=nb;return delta;
}
function absorbStandingWater(map,events=[],source="INFILTRATION"){let absorbed=0;for(const tile of map?.tiles||[]){if(waterDepth(tile)<=EPSILON||!hasSoil(tile))continue;const before=waterDepth(tile),excess=saturateSoil(tile,before,events,source),used=before-excess;if(used>EPSILON){tile.waterDepth=excess;absorbed+=used;events.push({type:"WATER_INFILTRATED",x:tile.x,y:tile.y,amount:used,waterDepth:excess,source})}}return absorbed}
function applyOutlets(map,events=[],source="DRAINAGE"){let drained=0;const open=map?.hydrology?.openBoundary===true;for(const tile of map?.tiles||[]){const outlet=tile.hydrologyDrain===true||tile.drain===true||(open&&(tile.x===0||tile.y===0||tile.x===Number(map.width||0)-1||tile.y===Number(map.height||0)-1));if(!outlet||waterDepth(tile)<=EPSILON)continue;const amount=waterDepth(tile);tile.waterDepth=0;drained+=amount;events.push({type:"WATER_DRAINED_OFF_MAP",x:tile.x,y:tile.y,amount,source})}return drained}
export function redistribute(map,{source="FLOW",events=[]}={}){
  if(!map?.tiles?.length)return events;const beforeDepth=new Map(map.tiles.map(t=>[key(t.x,t.y),waterDepth(t)])),beforeVolume=totalWater(map),by=new Map(map.tiles.map(t=>[key(t.x,t.y),t]));let iterations=0,maxDelta=0;
  for(;iterations<MAX_FLOW_ITERATIONS;iterations++){maxDelta=0;for(const tile of map.tiles){if(!canHoldWater(tile))continue;for(const[dx,dy]of FLOW_DIRS){const other=by.get(key(tile.x+dx,tile.y+dy));if(other)maxDelta=Math.max(maxDelta,pairEquilibrium(tile,other))}}const absorbed=absorbStandingWater(map,events,source);if(maxDelta<FLOW_EPSILON&&absorbed<EPSILON)break}
  const drained=applyOutlets(map,events,source);let changed=0;
  for(const tile of map.tiles){tile.waterDepth=waterDepth(tile)<=EPSILON?0:clean(tile.waterDepth);const old=Number(beforeDepth.get(key(tile.x,tile.y))||0),now=waterDepth(tile);if(Math.abs(now-old)>FLOW_EPSILON){changed++;events.push({type:"WATER_FLOW",x:tile.x,y:tile.y,fromDepth:old,waterDepth:now,waterSurfaceZ:now>0?elevation(tile)+now:null,source})}sync(tile,events)}
  const afterVolume=totalWater(map);if(changed||drained>EPSILON)events.push({type:"HYDROLOGY_REBALANCED",source,changedTiles:changed,iterations:iterations+1,beforeVolume,afterVolume,surfaceWater:surfaceWaterVolume(map),soilWater:soilWaterVolume(map),drained,maxDelta});return events;
}
export function addWater(tile,amount,events=[]){if(!tile)return 0;const incoming=Math.max(0,Number(amount||0)),excess=saturateSoil(tile,incoming,events,"ACCUMULATION"),before=waterDepth(tile),next=before+excess;return Math.max(0,setWaterDepth(tile,next,events,"ACCUMULATION"))}
export function removeWater(tile,amount,events=[]){if(!tile)return 0;const before=waterDepth(tile),next=Math.max(0,before-Math.max(0,Number(amount||0)));setWaterDepth(tile,next,events,"DRAINAGE");return before-next}
export function floodArea(map,tiles,{surfaceRise=1,source="FLOOD"}={}){const events=[],area=(tiles||[]).filter(t=>t&&canHoldWater(t));if(!area.length)return events;const surfaces=area.map(waterSurfaceZ).filter(v=>v!=null&&Number.isFinite(v)),base=surfaces.length?Math.max(...surfaces):Math.min(...area.map(elevation)),target=base+Math.max(0,Number(surfaceRise||0));let injected=0;for(const tile of [...area].sort((a,b)=>elevation(a)-elevation(b)||a.y-b.y||a.x-b.x)){if(elevation(tile)>=target)continue;const before=waterDepth(tile),required=Math.max(before,target-elevation(tile));tile.waterDepth=required;injected+=Math.max(0,required-before)}redistribute(map,{source,events});events.push({type:"FLOOD_AREA_RESOLVED",source,targetSurface:target,injectedVolume:injected,tiles:(map?.tiles||[]).map(t=>({x:t.x,y:t.y,elevation:elevation(t),waterDepth:waterDepth(t),waterSurfaceZ:waterSurfaceZ(t),soilMoisture:soilMoisture(t)}))});return events}
export function deformTerrain(map,x,y,{deltaElevation=0,setElevation=null,source="TERRAIN_DEFORMATION"}={}){const tile=tileAt(map,x,y);if(!tile)return[];const before=elevation(tile),after=setElevation==null?before+Number(deltaElevation||0):Number(setElevation);if(!Number.isFinite(after)||after===before)return[];const beforeDepth=waterDepth(tile);tile.elevation=after;tile.waterDepth=beforeDepth;const events=[{type:"ELEVATION_CHANGED",x,y,from:before,to:after,waterDepth:beforeDepth,source}];redistribute(map,{source,events});return events}
export function applyRain(map,{heavy=false,amount=null,source=null}={}){const resolved=Math.max(0,Number(amount??(heavy?HEAVY_RAIN_FILL_PER_EVENT:RAIN_FILL_PER_EVENT))),events=[],rainSource=source||(heavy?"HEAVY_RAIN":"RAIN");for(const tile of map?.tiles||[]){if(!canHoldWater(tile))continue;if(isWater(tile)){const before=waterDepth(tile);tile.waterDepth=before+resolved;events.push({type:"WATER_ACCUMULATED",x:tile.x,y:tile.y,elevation:elevation(tile),fromDepth:before,waterDepth:tile.waterDepth,waterSurfaceZ:elevation(tile)+tile.waterDepth,source:rainSource});continue}const excess=hasSoil(tile)?saturateSoil(tile,resolved,events,rainSource):resolved;if(excess>EPSILON){tile.waterDepth=waterDepth(tile)+excess;events.push({type:"SURFACE_RUNOFF",x:tile.x,y:tile.y,amount:excess,source:rainSource})}}redistribute(map,{source:rainSource,events});return events}
export function drySoil(map,{amount=DRYING_PER_CLEAR_TURN,source="DRYING"}={}){const events=[];for(const tile of map?.tiles||[]){if(waterDepth(tile)>EPSILON||!hasSoil(tile))continue;const before=soilMoisture(tile);if(before<=EPSILON)continue;const next=clean(Math.max(0,before-Math.max(0,Number(amount||0))));tile.soilMoisture=next;if(Math.abs(next-before)>EPSILON)events.push({type:"SOIL_MOISTURE_CHANGED",x:tile.x,y:tile.y,from:before,to:next,source});if(tile.terrain==="MUD"&&next<=EPSILON){tile.terrain="PLAIN";delete tile.soilMoisture;events.push({type:"MUD_DRY",x:tile.x,y:tile.y,source})}}return events}
