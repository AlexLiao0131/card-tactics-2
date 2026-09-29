export const EnvironmentResolver=(()=>{
"use strict";
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
const CFG=Object.freeze({
  FREEZE_POINT:0,
  FROZEN_SOIL_MOISTURE:.18,
  SLOPE_FAILURE_MOISTURE_RATIO:.82,
  SLOPE_FAILURE_MIN_DROP:1,
  SLOPE_FAILURE_MIN_MASS:.30,
  SNOW_FAILURE_DEPTH:1.15,
  SNOW_FAILURE_MIN_DROP:1,
  SNOW_FAILURE_BASE_STABILITY:.62,
  ROCK_FAILURE_MIN_DROP:1,
  ROCK_FAILURE_DISTURBANCE:.72,
  ROCK_BASE_COHESION:.78,
  ROCK_FRACTURE_DECAY:.82,
  ROCK_MIN_MASS:.45,
  FOREST_GROUND_COVER_STABILITY:.08,
  SAND_STABILITY_PENALTY:.18,
  FROZEN_STABILITY:.35,
  DISTURBANCE_DECAY:.45,
  MAX_MASS_FLOW_STEPS:12,
  NATURAL_FAILURE_WARNING_TURNS:1,
  NATURAL_FLOW_COOLDOWN_TURNS:2,
  MAX_NATURAL_FLOWS_PER_TICK:1,
  TURBIDITY_SETTLE_PER_TURN:.08
});
const key=(x,y)=>`${x},${y}`;
const clean=n=>Math.max(0,Math.round(Number(n||0)*1000)/1000);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v||0)));
const tileAt=(map,x,y)=>map?.tiles?.find(t=>t.x===x&&t.y===y)||null;
const neighbors=(map,tile)=>DIRS.map(([dx,dy])=>tileAt(map,tile.x+dx,tile.y+dy)).filter(Boolean);
const elevation=t=>Number(t?.elevation||0);
const water=t=>Math.max(0,Number(t?.waterDepth||0));
const snow=t=>Math.max(0,Number(t?.snowDepth||0));
const moisture=t=>Math.max(0,Number(globalThis.HydrologyEngine?.soilMoisture?.(t)||0));
const moistureRatio=t=>Math.min(1,moisture(t)/Math.max(.001,Number(globalThis.HydrologyEngine?.soilCapacity?.(t)??globalThis.HydrologyEngine?.SOIL_SATURATION_CAPACITY??.45)));
const temperature=(state,tile)=>Number(globalThis.ClimateEngine?.temperatureAt?.(state,tile)??state?.temperature??7);
const material=t=>String(t?.material||t?.dryTerrain||t?.terrain||"PLAIN");
const rockMaterial=t=>material(t)==="ROCK"||material(t)==="STONE"||String(t?.terrain||"")==="HIGH_GROUND";
const rockMass=t=>Math.max(0,Number(t?.rockMass??(rockMaterial(t)?Math.max(.5,elevation(t)*.35):0)));
const frozenSoil=(state,t)=>temperature(state,t)<=CFG.FREEZE_POINT&&moisture(t)>=CFG.FROZEN_SOIL_MOISTURE&&water(t)<=.001;
const slopeTo=(a,b)=>elevation(a)-elevation(b);
const turnOf=state=>Math.max(0,Number(state?.climate?.turn||0));

function downhill(map,tile,visited=new Set()){
  return neighbors(map,tile).filter(n=>n.terrain!=="WALL"&&!visited.has(key(n.x,n.y))).map(n=>({tile:n,drop:slopeTo(tile,n)})).filter(x=>x.drop>0).sort((a,b)=>b.drop-a.drop||elevation(a.tile)-elevation(b.tile))[0]||null;
}
function groundCoverStability(tile){
  const terrain=String(tile?.terrain||tile?.dryTerrain||""),explicit=Math.max(0,Number(tile?.vegetation||0))*.08;
  return Math.max(explicit,terrain==="FOREST"?CFG.FOREST_GROUND_COVER_STABILITY:0);
}
function vegetationStability(map,tile){
  const roots=Math.max(0,Number(globalThis.EnvironmentObjectEngine?.rootStrengthAt?.(map,tile)||0));
  return clamp(groundCoverStability(tile)+roots,0,.34);
}
function surfaceFriction(state,tile){
  if(globalThis.ClimateEngine?.isSolidIce?.(tile))return .08;
  if(frozenSoil(state,tile))return .72;
  if(material(tile)==="MUD")return .82;
  if(material(tile)==="SAND")return .68;
  if(snow(tile)>=.5)return .55;
  if(water(tile)>0)return .65;
  return 1;
}
function stability(state,tile,map=null){
  const wet=moistureRatio(tile),veg=vegetationStability(map,tile),frozen=frozenSoil(state,tile)?CFG.FROZEN_STABILITY:0,sand=material(tile)==="SAND"?CFG.SAND_STABILITY_PENALTY:0;
  return Math.max(0,Math.min(1,1-wet*.72+veg+frozen-sand));
}
function riskBucket(tile,kind){tile.massFlowRisk??={};tile.massFlowRisk[kind]??={warningTurn:null,cooldownUntil:0};return tile.massFlowRisk[kind];}
function resetRisk(tile,kind){const bucket=riskBucket(tile,kind);bucket.warningTurn=null;}
function markCooldown(flow,kind,turn){for(const p of flow?.path||[]){const tile=p.tile||p._tile||null;void tile;}}
function ensureTileState(map,state){
  const turn=turnOf(state);
  for(const tile of map?.tiles||[]){
    const firstThisTurn=Number(tile._environmentStateTurn)!==turn;
    tile.temperature=temperature(state,tile);
    tile.surfaceFriction=surfaceFriction(state,tile);
    tile.frozenSoil=frozenSoil(state,tile);
    tile.rootStrength=clean(Number(globalThis.EnvironmentObjectEngine?.rootStrengthAt?.(map,tile)||0));
    tile.vegetationStability=clean(vegetationStability(map,tile));
    tile.slopeStability=stability(state,tile,map);
    tile.rockCohesion=rockMaterial(tile)?Math.max(0,Math.min(1,Number(tile.rockCohesion??CFG.ROCK_BASE_COHESION))):0;
    if(firstThisTurn){
      tile.rockFracture=rockMaterial(tile)?clean(Number(tile.rockFracture||0)*CFG.ROCK_FRACTURE_DECAY):0;
      tile.disturbance=clean(Number(tile.disturbance||0)*CFG.DISTURBANCE_DECAY);
      if(Number(tile.waterTurbidity||0)>0)tile.waterTurbidity=clean(Math.max(0,Number(tile.waterTurbidity||0)-CFG.TURBIDITY_SETTLE_PER_TURN));
      tile._environmentStateTurn=turn;
    }
  }
}
function createFlow(map,start,kind,mass){return globalThis.MassFlowEngine?.trace?.(map,start,kind,mass,{maxSteps:CFG.MAX_MASS_FLOW_STEPS})||null;}
function applyFlowTerrain(map,state,flow,events,source){
  if(!flow)return null;
  const result=MassFlowEngine.apply(map,flow,{events,source});
  for(const p of flow.path||[]){
    const t=tileAt(map,p.x,p.y);if(!t)continue;
    if(flow.material==="SNOW"&&globalThis.ClimateEngine?.syncTileVisuals)ClimateEngine.syncTileVisuals(state,t);
    if(water(t)>.001&&(flow.material==="SOIL"||flow.material==="ROCK"||flow.material==="DEBRIS")){
      const added=flow.material==="SOIL"?.42:.28;
      t.waterTurbidity=clean(clamp(Number(t.waterTurbidity||0)+Math.min(.6,Number(flow.mass||0)*added),0,1));
      events.push({type:"WATER_TURBIDITY_CHANGED",x:t.x,y:t.y,turbidity:t.waterTurbidity,material:flow.material,source});
    }
  }
  return result;
}
function warningGate(tile,kind,state,events,{unstable=false,source="ENVIRONMENT_TICK",material=kind,path=[],immediate=false}={}){
  const bucket=riskBucket(tile,kind),turn=turnOf(state);
  if(!unstable){bucket.warningTurn=null;return false;}
  if(turn<Number(bucket.cooldownUntil||0))return false;
  if(immediate)return true;
  if(bucket.warningTurn==null){
    bucket.warningTurn=turn;
    events.push({type:"MASS_FLOW_WARNING",material,x:tile.x,y:tile.y,source,triggerTurn:turn+CFG.NATURAL_FAILURE_WARNING_TURNS,path:path.map(p=>({x:p.x,y:p.y}))});
    return false;
  }
  return turn-Number(bucket.warningTurn)>=CFG.NATURAL_FAILURE_WARNING_TURNS;
}
function snowCandidate(map,state,tile,events,source){
  const next=downhill(map,tile);if(!next||next.drop<CFG.SNOW_FAILURE_MIN_DROP){resetRisk(tile,"SNOW");return null;}
  const depth=snow(tile),disturbance=Number(tile.disturbance||0),veg=vegetationStability(map,tile);
  const snowStability=Math.max(0,Math.min(1,CFG.SNOW_FAILURE_BASE_STABILITY+veg*.65-Math.max(0,depth-CFG.SNOW_FAILURE_DEPTH)*.18-disturbance*.3));tile.snowStability=snowStability;
  const unstable=depth>=CFG.SNOW_FAILURE_DEPTH&&snowStability<=.45;if(!unstable){resetRisk(tile,"SNOW");return null;}
  const released=Math.min(depth,Math.max(.55,depth*(.5+disturbance*.15))),flow=createFlow(map,tile,"SNOW",released);if(!flow||flow.path.length<2)return null;
  if(!warningGate(tile,"SNOW",state,events,{unstable,source,material:"SNOW",path:flow.path,immediate:source!=="ENVIRONMENT_TICK"&&disturbance>=.75}))return null;
  return{kind:"SNOW",material:"SNOW",tile,flow,severity:flow.mass*(1+next.drop*.25),source:"STABILITY_FAILURE"};
}
function soilCandidate(map,state,tile,events,source){
  if(water(tile)>.001||tile?.terrain==="WATER"){resetRisk(tile,"SOIL");return null;}
  const next=downhill(map,tile);if(!next||next.drop<CFG.SLOPE_FAILURE_MIN_DROP){resetRisk(tile,"SOIL");return null;}
  const ratio=moistureRatio(tile),stab=stability(state,tile,map),disturbance=Number(tile.disturbance||0),unstable=ratio>=CFG.SLOPE_FAILURE_MOISTURE_RATIO&&!frozenSoil(state,tile)&&stab-disturbance*.2<=.36;
  if(!unstable){resetRisk(tile,"SOIL");return null;}
  const mass=Math.max(CFG.SLOPE_FAILURE_MIN_MASS,ratio*(1-stab)+disturbance*.15),flow=createFlow(map,tile,"SOIL",mass);if(!flow||flow.path.length<2)return null;
  if(!warningGate(tile,"SOIL",state,events,{unstable,source,material:"SOIL",path:flow.path,immediate:source!=="ENVIRONMENT_TICK"&&disturbance>=.75}))return null;
  return{kind:"SOIL",material:"SOIL",tile,flow,severity:flow.mass*(1+next.drop*.3),source:"SLOPE_FAILURE"};
}
function rockCandidate(map,state,tile,events,source){
  if(!rockMaterial(tile)){resetRisk(tile,"ROCK");return null;}
  const next=downhill(map,tile);if(!next||next.drop<CFG.ROCK_FAILURE_MIN_DROP){resetRisk(tile,"ROCK");return null;}
  const disturbance=Math.max(0,Number(tile.disturbance||0)),fracture=Math.max(0,Number(tile.rockFracture||0)),cohesion=Math.max(0,Math.min(1,Number(tile.rockCohesion??CFG.ROCK_BASE_COHESION))),load=Math.max(0,disturbance+fracture-cohesion);
  const predictedFracture=clean(fracture+disturbance*(.45+Math.min(1,next.drop)*.15));tile.rockFracture=predictedFracture;
  const unstable=(disturbance>=CFG.ROCK_FAILURE_DISTURBANCE||load>0)&&predictedFracture+disturbance*.35>cohesion;
  if(!unstable){resetRisk(tile,"ROCK");return null;}
  const available=rockMass(tile),released=Math.min(available,Math.max(CFG.ROCK_MIN_MASS,available*(.35+Math.min(.45,disturbance*.18))));if(released<=0)return null;
  const flow=createFlow(map,tile,"ROCK",released);if(!flow||flow.path.length<2)return null;
  if(!warningGate(tile,"ROCK",state,events,{unstable,source,material:"ROCK",path:flow.path,immediate:source!=="ENVIRONMENT_TICK"&&disturbance>=CFG.ROCK_FAILURE_DISTURBANCE}))return null;
  return{kind:"ROCK",material:"ROCK",tile,flow,severity:flow.mass*(1+next.drop*.35),source:"ROCK_FAILURE",available,released};
}
function candidatePathKeys(candidate){return new Set((candidate?.flow?.path||[]).map(p=>key(p.x,p.y)));}
function selectCandidates(candidates,source){
  const limit=source==="ENVIRONMENT_TICK"?CFG.MAX_NATURAL_FLOWS_PER_TICK:Math.max(CFG.MAX_NATURAL_FLOWS_PER_TICK,3),claimed=new Set(),selected=[];
  for(const candidate of [...candidates].sort((a,b)=>b.severity-a.severity||elevation(b.tile)-elevation(a.tile))){
    const path=candidatePathKeys(candidate);if([...path].some(k=>claimed.has(k)))continue;
    selected.push(candidate);for(const k of path)claimed.add(k);if(selected.length>=limit)break;
  }
  return selected;
}
function applyCandidate(map,state,candidate,events){
  const turn=turnOf(state),{kind,flow,tile,source}=candidate;
  if(kind==="ROCK")tile.rockMass=clean(Math.max(0,Number(candidate.available||rockMass(tile))-Number(candidate.released||0)));
  const terrain=applyFlowTerrain(map,state,flow,events,source);
  for(const p of flow.path||[]){const t=tileAt(map,p.x,p.y);if(!t)continue;const bucket=riskBucket(t,kind);bucket.warningTurn=null;bucket.cooldownUntil=turn+CFG.NATURAL_FLOW_COOLDOWN_TURNS;}
  if(kind==="SNOW")events.push(MassFlowEngine.event(flow,{source,damage:16+flow.mass*18,forceDistance:Math.max(1,Math.min(3,Math.ceil(flow.mass/1.4)))}));
  else if(kind==="SOIL")events.push(MassFlowEngine.event(flow,{source,damage:12+flow.mass*20,forceDistance:Math.max(1,Math.min(3,Math.ceil(flow.mass/1.2))),extra:{terrainEvolution:terrain}}));
  else events.push(MassFlowEngine.event(flow,{source,damage:20+flow.mass*24,forceDistance:Math.max(1,Math.min(4,Math.ceil(flow.mass/1.1))),extra:{terrainEvolution:terrain}}));
}
function resolve(map,state,{source="ENVIRONMENT_TICK"}={}){
  const events=[];if(!map||!state)return events;ensureTileState(map,state);
  for(const tile of map.tiles||[]){
    if(tile.frozenSoil&&!tile._frozenSoil)events.push({type:"SOIL_FROZEN",x:tile.x,y:tile.y,temperature:tile.temperature,soilMoisture:moisture(tile)});
    if(!tile.frozenSoil&&tile._frozenSoil)events.push({type:"SOIL_THAWED",x:tile.x,y:tile.y,temperature:tile.temperature,soilMoisture:moisture(tile)});
    tile._frozenSoil=tile.frozenSoil;
  }

  // Snapshot all unstable candidates before mutating terrain. This prevents material
  // deposited by one failure from recursively triggering a second failure in the same tick.
  const candidates=[];
  for(const tile of [...(map.tiles||[])].sort((a,b)=>elevation(b)-elevation(a))){
    const snow=snowCandidate(map,state,tile,events,source);if(snow)candidates.push(snow);
    const soil=soilCandidate(map,state,tile,events,source);if(soil)candidates.push(soil);
    const rock=rockCandidate(map,state,tile,events,source);if(rock)candidates.push(rock);
  }
  const alreadyResolvedNatural=source==="ENVIRONMENT_TICK"&&Number(state._naturalMassFlowResolvedTurn)===turnOf(state);
  const selected=alreadyResolvedNatural?[]:selectCandidates(candidates,source);
  for(const candidate of selected)applyCandidate(map,state,candidate,events);
  if(source==="ENVIRONMENT_TICK"&&selected.length)state._naturalMassFlowResolvedTurn=turnOf(state);

  if(events.some(e=>e.type==="ELEVATION_CHANGED"&&e.source&&String(e.source).includes("FAILURE")))globalThis.HydrologyEngine?.redistribute?.(map,{source:"MASS_FLOW",events});
  ensureTileState(map,state);
  events.push({type:"ENVIRONMENT_RESOLVED",source,tiles:map.tiles?.length||0,massFlows:events.filter(e=>e.type==="MASS_FLOW").length,warnings:events.filter(e=>e.type==="MASS_FLOW_WARNING").length});
  return events;
}
function disturb(map,x,y,amount=1,{source="DISTURBANCE"}={}){
  const tile=tileAt(map,x,y);if(!tile)return[];const force=Math.max(0,Number(amount||0));tile.disturbance=clean(Number(tile.disturbance||0)+force);if(rockMaterial(tile))tile.rockFracture=clean(Number(tile.rockFracture||0)+force*.38);return[{type:"ENVIRONMENT_DISTURBANCE",x,y,amount:force,source,rockFracture:Number(tile.rockFracture||0)}];
}
return Object.freeze({CFG,resolve,disturb,tileAt,temperature,frozenSoil,surfaceFriction,stability,vegetationStability,downhill,rockMaterial,rockMass});
})();
globalThis.EnvironmentResolver=EnvironmentResolver;
