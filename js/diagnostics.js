(()=>{
"use strict";

// Existing developer diagnostics owns both the live timeline and the last-session
// recovery record. This is observational only: it never mutates Battle/Grid State.
const MAX=320,SAVED_MAX=200,ROUND_MAX=36,ANNOTATION_MAX=3,STORE_KEY="ct:diagnostics:session:v1",INCIDENT_KEY="ct:diagnostics:incident:v1",PREF_KEY="ct:diagnostics";
const events=[];
const perfCounters=Object.create(null);
const now=()=>new Date().toISOString();
const started=performance.now();
const sessionId=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
let frames=0,lastFpsAt=started,fps=0,lastCheckpoint=null,lastClimateKey="",lastWater=null;
let lastStoredAt=0,lastSavedWaterLog=0,lastSampleAt=0,lastPhaseKey="",lastGameRound=null;
let previousSession=null,previousStatus="",recoveredIncident=null,lifecycle="ACTIVE",storageWarning="";
// Compact, durable history survives the 320-event rolling window. These are
// observations of the ONE battle state, never another simulation or game state.
const roundHistory=[],perfPeaks=Object.create(null),spikeNotifiedAt=Object.create(null);
let lastEvidence=null,lastWaterSeamWarningKey="",lastWaterSeamCaptureAt=0;
const tileAnnotations=[];
const hydrologyBalanceHistory=[];

function readStorage(key){try{return localStorage.getItem(key);}catch(_){return null;}}
function writeStorage(key,value){try{localStorage.setItem(key,value);return true;}catch(err){storageWarning=String(err?.name||err||"Storage unavailable");return false;}}
function removeStorage(key){try{localStorage.removeItem(key);}catch(_){}}

// New installations enable a small, bounded crash recorder automatically;
// an explicit user choice of OFF continues to be respected.
let enabled=readStorage(PREF_KEY)!=="0";
try{
  const old=JSON.parse(readStorage(STORE_KEY)||"null");
  if(old&&Array.isArray(old.events)&&old.sessionId!==sessionId){
    previousSession=old;
    if(Array.isArray(old.tileAnnotations))tileAnnotations.push(...old.tileAnnotations.slice(-ANNOTATION_MAX));
    if(Array.isArray(old.hydrologyBalanceHistory))hydrologyBalanceHistory.push(...old.hydrologyBalanceHistory.slice(-ROUND_MAX));
    previousStatus=old.lifecycle==="ACTIVE"
      ?"疑似異常中斷（也可能是系統回收或無預警重新載入；不能確定是閃退）"
      :old.lifecycle==="BACKGROUND"
        ?"上次在背景結束／被系統回收（原因未確認）"
        :"上次正常離開或重新整理";
    if(old.lifecycle==="ACTIVE"){
      recoveredIncident={status:previousStatus,...old};
      writeStorage(INCIDENT_KEY,JSON.stringify(recoveredIncident));
    }
  }
  if(!recoveredIncident)recoveredIncident=JSON.parse(readStorage(INCIDENT_KEY)||"null");
}catch(_){storageWarning="上一場診斷紀錄損毀，已略過";}

function shorten(value,max=240){return String(value??"").slice(0,max);}
function numeric(value){const n=Number(value);return Number.isFinite(n)?Math.round(n*1000)/1000:null;}
function errorData(err){
  if(!err)return{};
  return{name:shorten(err.name||"Error",100),message:shorten(err.message||err,800),stack:shorten(err.stack||"",2600)};
}

function store(force=false){
  if(!enabled)return;
  const ms=Date.now();if(!force&&ms-lastStoredAt<6500)return;
  lastStoredAt=ms;
  const record={schema:2,sessionId,startedAt:new Date(Date.now()-(performance.now()-started)).toISOString(),
    updatedAt:now(),lifecycle,checkpoint:lastCheckpoint,events:events.slice(-SAVED_MAX),
    roundHistory,perfPeaks,lastEvidence,tileAnnotations,hydrologyBalanceHistory};
  return writeStorage(STORE_KEY,JSON.stringify(record));
}
function recordPerf(name,elapsed){
  if(!enabled)return;
  const ms=Number(elapsed);if(!Number.isFinite(ms)||ms<0)return;
  const stat=perfCounters[name]||(perfCounters[name]={samples:0,lastMs:0,maxMs:0,totalMs:0});
  stat.samples++;stat.lastMs=Math.round(ms*100)/100;stat.maxMs=Math.max(stat.maxMs,stat.lastMs);stat.totalMs+=ms;
  // Record the true session high-water mark separately: the rolling aggregate
  // resets after 120 samples and used to erase the biggest long-game stalls.
  if(!perfPeaks[name]||ms>perfPeaks[name].ms)
    perfPeaks[name]={ms:Math.round(ms*100)/100,at:now(),round:lastGameRound??lastCheckpoint?.round??null,
      weather:lastCheckpoint?.weather??null,phase:lastCheckpoint?.phase??null};
  // Attribute individual expensive syncs to their actual round, even when a
  // 5-second checkpoint happens only after the spike has already finished.
  if(name==="renderSync.water"||name==="renderSync.mapObjects"){
    const round=Number(lastGameRound??lastCheckpoint?.round);
    if(Number.isFinite(round)){
      const entry=ensureRoundHistory(round);
      if(name==="renderSync.water")entry.maxWaterMs=Math.max(entry.maxWaterMs,ms);
      else entry.maxObjectsMs=Math.max(entry.maxObjectsMs,ms);
    }
  }
  const threshold=name.startsWith("renderSync.")?350:
    name.startsWith("environmentSync.")?75:
    (name==="scene.renderElapsed"||name==="frame.cpuElapsed"?180:Infinity);
  const time=Date.now();
  if(ms>=threshold&&time-(spikeNotifiedAt[name]||0)>=30000){
    spikeNotifiedAt[name]=time;
    push("PERF_SPIKE",{metric:name,ms:Math.round(ms*100)/100,
      round:lastCheckpoint?.round??null,weather:lastCheckpoint?.weather??null});
  }
  // Last 120 samples: bounded aggregation, not a second diagnostics event stream.
  if(stat.samples>120){stat.samples=1;stat.totalMs=ms;stat.maxMs=stat.lastMs;}
}
function perfSnapshot(){return Object.fromEntries(Object.entries(perfCounters).map(([name,x])=>[name,{lastMs:x.lastMs,maxMs:x.maxMs,meanMs:Math.round(x.totalMs/Math.max(1,x.samples)*100)/100,samples:x.samples}]));}
function push(type,data={}){
  if(!enabled&&type!=="ERROR"&&type!=="REJECTION")return;
  // Every entry stays compact so keeping the prior session is safe on iPhone.
  events.push({at:now(),type,data});
  if(events.length>MAX)events.splice(0,events.length-MAX);
  if(type==="ERROR"||type==="REJECTION"||type==="BOOT_FAILURE"||type==="WEBGL_CONTEXT_LOST"||type==="SKILL_FAILURE"||type==="CARD_FAILURE")store(true);
  else store();
}
// Annotations are first-class diagnostic evidence, not rolling game events.
// The same Settings report owns their persistence and export. Large global
// seam audits and visual captures remain separate to avoid redundant storage.
function recordHydrologyBalance(balance){
  if(!enabled||!balance)return;
  hydrologyBalanceHistory.push(balance);
  while(hydrologyBalanceHistory.length>ROUND_MAX)hydrologyBalanceHistory.shift();
  push("HYDROLOGY_CYCLE_BALANCE",{environmentTurn:balance.environmentTurn,
    inventoryDelta:numeric(balance.inventoryDelta),explainedDelta:numeric(balance.explainedDelta),
    unattributedDelta:numeric(balance.unattributedDelta),offMapDrain:numeric(balance.offMapDrain),
    precipitation:numeric(balance.precipitation),sourceInflow:numeric(balance.sourceInflow),
    transportSteps:balance.transportSteps,
    deferredRedistributions:balance.deferredRedistributions,
    requestedTransportSources:balance.requestedTransportSources,
    outletConnectivity:balance.outletConnectivity||null});
  store(true);
}
function recordTileAnnotation(annotation){
  if(!enabled||!annotation||!Array.isArray(annotation.tiles)||!annotation.tiles.length)return false;
  const record={...annotation};
  tileAnnotations.push(record);
  while(tileAnnotations.length>ANNOTATION_MAX)tileAnnotations.shift();
  const saved=store(true);
  push("TEST_TILE_ANNOTATION",{schema:record.schema,at:record.at,
    annotationType:record.annotationType,selectedCount:record.selectedCount,
    tiles:record.tiles.slice(0,12).map(tile=>({x:tile.x,y:tile.y}))});
  return saved===true;
}

function classifyLog(kind,message){
  const s=String(message||"");
  if(/(?:無法|失敗|不合法|未生效|不足|不能施放|無合法|無法施放|無法建立|未載入)/.test(s))return"GAME_FAILURE";
  if(/(?:氣候|天氣|氣象|雨|雪|冰|霧|雷|颱風|風力|風場|日夜|月光|暴風)/.test(s))return"CLIMATE_EVENT";
  if(/(?:水體|水位|Water Volume|瀑布|溪流|泥濘|淹水|退水|沖刷|地表水|洪水|漩渦)/.test(s))return"HYDROLOGY_EVENT";
  if(/(?:野火|燃燒|森林大火|火龍捲|泥石流|土石流|崩落|龍捲風|地形|隕石)/.test(s))return"ENVIRONMENT_EVENT";
  return kind==="DETAIL"?"GAME_DETAIL":"GAME_FLOW";
}
function gameLog(detail){
  if(!enabled||!detail||!detail.text)return;
  const type=classifyLog(detail.type,detail.text);
  // Hydrology emits frequent per-tile redistribution details. Keep samples,
  // plus the periodic aggregate, rather than hammering localStorage.
  if(type==="HYDROLOGY_EVENT"&&/^(?:水體重新分配)/.test(detail.text)){
    if(Date.now()-lastSavedWaterLog<4500)return;
    lastSavedWaterLog=Date.now();
  }
  push(type,{channel:shorten(detail.type||"SYSTEM",20),text:shorten(detail.text,340)});
}
function gameAction(type,data={}){
  if(!enabled)return;
  const safe={};
  for(const key of ["unitId","unit","team","skillId","skill","cardId","card","targetId","target","reason","x","y","phase","result"]){
    const value=data?.[key];if(value==null)continue;
    if(typeof value==="string"||typeof value==="number"||typeof value==="boolean")safe[key]=typeof value==="string"?shorten(value,140):value;
  }
  push(type,safe);
}

window.addEventListener("error",e=>push("ERROR",{message:shorten(e.message,800),file:shorten(e.filename,260),line:e.lineno,column:e.colno,...errorData(e.error)}));
window.addEventListener("unhandledrejection",e=>push("REJECTION",errorData(e.reason)));
document.addEventListener("webglcontextlost",e=>{push("WEBGL_CONTEXT_LOST",{canvas:e.target?.id||null});store(true);},true);
document.addEventListener("webglcontextrestored",e=>push("WEBGL_CONTEXT_RESTORED",{canvas:e.target?.id||null}),true);
window.addEventListener("cardtactics:log",e=>gameLog(e.detail));
window.addEventListener("cardtactics:state",()=>checkPhase());
window.addEventListener("cardtactics:battle-render",()=>checkPhase());

function frame(t){
  frames++;
  if(t-lastFpsAt>=1000){fps=Math.round(frames*1000/(t-lastFpsAt));frames=0;lastFpsAt=t;}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function runtime(){
  const s=window.CardTacticsRuntime?.getBattleSnapshot?.();
  return s?{round:s.round,phase:s.phase,mode:s.mode,revision:s.revision,
    units:s.units?.length||0,tiles:s.map?.tiles?.length||0}:null;
}
function renderer(){return window.CardTacticsRenderer?.diagnostics?.()||null;}
function memory(){
  const m=performance.memory;
  return m?{usedMB:numeric(m.usedJSHeapSize/1048576),totalMB:numeric(m.totalJSHeapSize/1048576),limitMB:numeric(m.jsHeapSizeLimit/1048576)}:null;
}
function audit(){
  const s=window.CardTacticsRuntime?.getBattleSnapshot?.(),v=renderer();if(!s)return null;
  const expected={tiles:s.map?.tiles?.length||0,mapObjects:(s.map?.objects||[]).filter(o=>!o.destroyed&&o.type!=="CORE").length,units:s.units?.length||0,enemyHand:s.presentation?.enemyHandCount||0};
  // renderer.tiles counts terrain MESHES, not map tiles; v.units is an
  // object of renderer statistics, not a scalar. Do not flag false mismatches.
  const actual={tiles:null,mapObjects:v?.mapObjects?.objects??null,
    units:typeof v?.units?.units==="number"?v.units.units:null,
    enemyHand:document.querySelectorAll(".opponent-hand .opponent-card-back").length};
  const mismatch=[];
  for(const key of ["tiles","mapObjects","units","enemyHand"])if(actual[key]!==null&&expected[key]!==actual[key])mismatch.push(`${key}:${expected[key]}!=${actual[key]}`);
  return{expected,actual,ok:!mismatch.length,mismatch};
}
function checkPhase(){
  if(!enabled)return;
  const s=window.CardTacticsRuntime;
  if(!s)return;
  const round=s.debug?.state?.()?.round,phase=s.getPhase?.();
  const key=`${round??""}|${phase||""}`;
  if(key!==lastPhaseKey){lastPhaseKey=key;lastGameRound=round;push("PHASE",{round,phase});}
}
function checkpoint(){
  const runtime=window.CardTacticsRuntime,env=runtime?.debug?.state?.(),map=runtime?.getBattleMap?.(),tiles=map?.tiles;
  if(!env||!Array.isArray(tiles))return null;
  const weather=env.weather||"CLEAR",climate=env.climate||null;
  let storedD=0,soil=0,wet=0,deep=0,maxDepth=0,snow=0,snowSWE=0,ice=0,flowing=0;
  for(const tile of tiles){
    const depth=Number(globalThis.HydrologyEngine?.waterDepth?.(tile)??tile?.waterDepth??0);
    const d=Number.isFinite(depth)?Math.max(0,depth):0;
    storedD+=d;soil+=Number(tile?.soilMoisture||0);
    if(d>0.001)wet++;if(d>0.5)deep++;if(d>maxDepth)maxDepth=d;
    snow+=Number(tile?.snowDepth||0);
    snowSWE+=Number(tile?.snowWaterEquivalent??tile?.snowDepth??0);
    ice+=Number(tile?.iceThickness||0);
    if(Number(tile?.flowSpeed||0)>0.1)flowing++;
  }
  const visual=window.CardTacticsRenderer,scene=visual?.scene;
  const lightSources=visual?.lastState?.presentation?.environment?.lightSources||[];
  const lightTypes={};for(const source of lightSources){const type=String(source?.source||"UNKNOWN");lightTypes[type]=(lightTypes[type]||0)+1;}
  return{at:now(),uptimeSeconds:Math.round((performance.now()-started)/1000),fps,
    round:env.round,environmentSteps:env.environmentSteps,phase:runtime.getPhase?.(),
    map:{width:map.width,height:map.height,tiles:tiles.length},units:env.units?.length??null,
    weather,timeOfDay:env.timeOfDay,moonlight:env.moonlight,
    climate:climate?{precipitation:climate.precipitation?.type,intensity:numeric(climate.precipitation?.intensity),fog:numeric(climate.fog?.intensity),thunder:numeric(climate.thunder?.intensity),heat:numeric(climate.heat?.intensity),wind:climate.wind?{direction:climate.wind.direction,strength:numeric(climate.wind.strength)}:null}:null,
    hydrology:{storedD:numeric(storedD),soil:numeric(soil),wetTiles:wet,deepTiles:deep,maxDepth:numeric(maxDepth),snow:numeric(snow),snowWaterEquivalent:numeric(snowSWE),ice:numeric(ice),
      // Frozen water is already included in storedD; it is not added again.
      liquidSurface:numeric(storedD-ice),totalWaterEquivalent:numeric(storedD+soil+snowSWE),flowingTiles:flowing},
    waterRebuild:visual?.water?.waterRebuildDiagnostics?.()??null,
    // Cached geometry audit: O(1) between actual surface rebuilds. Its
    // "open boundary" count includes legitimate shorelines, not just cracks.
    waterSeams:visual?.water?.waterSeamDiagnostics?.()??null,
    lighting:{sourceTypes:lightTypes,physicalLights:visual?.environment?.physicalLightsById?.size??null,sourceIds:lightSources.filter(source=>source?.source==="CORE_LIGHT"||source?.source==="CAPTURE_LIGHT").slice(0,12).map(source=>`${source.source}:${source.sourceId??"unknown"}`)},
    scene:scene?{meshes:scene.meshes?.length??null,materials:scene.materials?.length??null,textures:scene.textures?.length??null,lights:scene.lights?.length??null,activeMeshes:scene.getActiveMeshes?.()?.length??null}:null,
     performance:perfSnapshot(),
    heap:memory()};
}
function ensureRoundHistory(round,at=now()){
  let entry=roundHistory.find(item=>item.round===round);
  if(!entry){
    entry={round,firstAt:at,lastAt:at,samples:0,minFps:null,maxFps:null,
      maxRenderPeakMs:0,maxWaterMs:0,maxObjectsMs:0,weathers:[],nightSamples:0,
      maxMeshes:0,maxShadowCasters:0,
      maxWaterSeamWarnings:0,maxWaveInputMismatches:0,maxWaterVisualBoundaryCandidates:0};
    roundHistory.push(entry);
    while(roundHistory.length>ROUND_MAX)roundHistory.shift();
  }
  return entry;
}
function keepRoundHistory(sample){
  const round=Number(sample?.round);
  if(!Number.isFinite(round))return;
  const entry=ensureRoundHistory(round,sample.at);
  entry.samples++;entry.lastAt=sample.at;
  entry.lastPhase=sample.phase;entry.lastWeather=sample.weather;
  if(!entry.weathers.includes(sample.weather))entry.weathers.push(sample.weather);
  if(sample.timeOfDay==="NIGHT")entry.nightSamples++;
  if(Number.isFinite(sample.fps)){
    entry.minFps=entry.minFps==null?sample.fps:Math.min(entry.minFps,sample.fps);
    entry.maxFps=entry.maxFps==null?sample.fps:Math.max(entry.maxFps,sample.fps);
  }
  const visual=window.CardTacticsRenderer;
  entry.maxRenderPeakMs=Math.max(entry.maxRenderPeakMs,Number(visual?.performanceStats?.renderPeakMs||0));
  entry.maxMeshes=Math.max(entry.maxMeshes,Number(sample.scene?.meshes||0));
  entry.maxShadowCasters=Math.max(entry.maxShadowCasters,Number(visual?.shadowState?.casters||0));
  entry.maxWaterSeamWarnings=Math.max(entry.maxWaterSeamWarnings,Number(sample.waterSeams?.warningCount||0));
  entry.maxWaveInputMismatches=Math.max(entry.maxWaveInputMismatches,Number(sample.waterSeams?.crossMeshVertexMotionMismatch||0));
  entry.maxMissingWetSurfaceEdges=Math.max(Number(entry.maxMissingWetSurfaceEdges||0),
    Number(sample.waterSeams?.internalBoundaries?.internalMissingSurfaceEdges||0));
  entry.maxWaterVisualBoundaryCandidates=Math.max(entry.maxWaterVisualBoundaryCandidates,
    Number(sample.waterSeams?.visualBoundaryCandidates||0));
}

// A deliberately explicit "capture now" command for black terrain, missing
// crystal light, invisible deployment areas and night sight discrepancies.
// It reads existing Renderer/Presentation ownership; it does not alter a mesh.
function capture(label="MANUAL_VISUAL"){
  if(!enabled)return null;
  try{
    const current=checkpoint(),visual=window.CardTacticsRenderer?.captureVisualDiagnostics?.()||null;
    lastEvidence={at:now(),label:shorten(label,48),checkpoint:current,
      presentation:audit(),visual,
      waterSeams:window.CardTacticsRenderer?.water?.waterSeamDiagnostics?.({detailed:true})||null,
      overlays:{deployment:window.CardTacticsRenderer?.highlights?.areas?.size??null,
        tactical:window.CardTacticsRenderer?.highlights?.dynamic?.size??null,
        fog:window.CardTacticsRenderer?.environment?.visibilityHazeMesh?.name??null,
        lightField:window.CardTacticsRenderer?.environment?.lightFieldMesh?.name??null,
        transparentMeshes:(window.CardTacticsRenderer?.scene?.meshes||[]).reduce((counts,mesh)=>{
          const kind=String(mesh?.metadata?.kind||""),name=String(mesh?.name||"");
          if(kind.startsWith("water")||name.startsWith("water-")||name.startsWith("runoff-")||name.startsWith("cascade-"))counts.water++;
          else if(kind==="tactical-ground-highlight")counts.tactical++;
          else if(kind==="weather-visibility-haze")counts.visibility++;
          else if(kind==="environment-light-field")counts.illumination++;
          else if(name.startsWith("environment-surface-"))counts.snowIce++;
          return counts;
        },{water:0,tactical:0,visibility:0,illumination:0,snowIce:0})}};
    push("VISUAL_CAPTURE",{label:lastEvidence.label,round:current?.round,
      weather:current?.weather,timeOfDay:current?.timeOfDay,
      sightTiles:visual?.opticalSight?.visibleTiles??null,
      deploymentMeshes:visual?.deployment?.meshes??null,
      contextLost:visual?.webgl?.contextLost??null});
    store(true);
    return lastEvidence;
  }catch(err){push("VISUAL_CAPTURE_FAILED",errorData(err));store(true);return null;}
}
function sample(){
  if(!enabled||document.visibilityState==="hidden")return;
  try{
    const sample=checkpoint();if(!sample)return;
    const nextKey=JSON.stringify({w:sample.weather,t:sample.timeOfDay,m:sample.moonlight,c:sample.climate});
    if(lastClimateKey&&lastClimateKey!==nextKey)push("CLIMATE_CHANGE",{previous:JSON.parse(lastClimateKey),current:JSON.parse(nextKey)});
    lastClimateKey=nextKey;
    const water=sample.hydrology;
    if(lastWater){
      const delta=water.storedD-lastWater.storedD;
      if(Math.abs(delta)>=25||Math.abs(water.wetTiles-lastWater.wetTiles)>=30||Math.abs(water.snow-lastWater.snow)>=15){
        push("HYDROLOGY_CHANGE",{D:water.storedD,deltaD:numeric(delta),wetTiles:water.wetTiles,snow:water.snow,ice:water.ice});
      }
    }
    lastWater=water;lastCheckpoint=sample;
    keepRoundHistory(sample);
    const seams=sample.waterSeams;
    if(seams?.warningCount>0){
      const warningKey=`${seams.revision}:${seams.warningCount}`;
      if(warningKey!==lastWaterSeamWarningKey){
        lastWaterSeamWarningKey=warningKey;
        push("WATER_SEAM_WARNING",{round:sample.round,weather:sample.weather,
          revision:seams.revision,regions:seams.surfaceRegions,
          reused:seams.update?.reused,built:seams.update?.built,
          invalid:seams.invalidIndices+seams.invalidVertices,
          degenerate:seams.degenerateTriangles,
          nonManifold:seams.nonManifoldEdges,
          internalMissingSurfaceEdges:seams.internalBoundaries?.internalMissingSurfaceEdges||0,
          internalUnweldedEdges:seams.internalBoundaries?.internalUnweldedEdges||0,
          waveInputMismatch:seams.crossMeshVertexMotionMismatch,
          sameMeshWaveInputMismatch:seams.sameMeshWaveInputMismatch||0,
          colorAlphaCandidates:seams.crossMeshColorMismatch,
          normalCandidates:seams.crossMeshNormalMismatch,
          missingAnimation:seams.missingSurfaceAnimation});
        // Readback and long-form evidence can be expensive on mobile. Keep
        // periodic summaries, but at most one automatic full capture/minute.
        if(Date.now()-lastWaterSeamCaptureAt>=60000){
          lastWaterSeamCaptureAt=Date.now();
          capture("AUTO_WATER_SEAM");
        }
      }
    }
    if(Date.now()-lastSampleAt>=12000){lastSampleAt=Date.now();push("CHECKPOINT",{round:sample.round,environmentSteps:sample.environmentSteps,weather:sample.weather,timeOfDay:sample.timeOfDay,fps:sample.fps,hydrology:sample.hydrology,waterSeams:sample.waterSeams,lighting:sample.lighting,scene:sample.scene,performance:sample.performance,heap:sample.heap});}
    store();
  }catch(err){push("DIAGNOSTICS_SAMPLE_FAILED",errorData(err));}
}

// A normal pagehide is not a crash. An unmarked active session on the next
// launch is a *suspect*, never proof of an OOM or a precise crash reason.
document.addEventListener("visibilitychange",()=>{
  if(!enabled)return;
  lifecycle=document.visibilityState==="hidden"?"BACKGROUND":"ACTIVE";
  push("LIFECYCLE",{status:lifecycle});
  if(lifecycle==="ACTIVE")sample();
  store(true);
});
window.addEventListener("pagehide",()=>{lifecycle="PAGEHIDE";push("LIFECYCLE",{status:lifecycle});store(true);});
window.addEventListener("pageshow",e=>{if(e.persisted){lifecycle="ACTIVE";push("LIFECYCLE",{status:"BF_CACHE_RESUME"});store(true);}});
setInterval(()=>{sample();store();},5000);

function report(){
  const data={generatedAt:now(),userAgent:navigator.userAgent,enabled,sessionId,
    uptimeSeconds:Math.round((performance.now()-started)/1000),fps,
    runtime:runtime(),renderer:renderer(),memory:memory(),performance:perfSnapshot(),checkpoint:lastCheckpoint,
    roundHistory,perfPeaks,lastEvidence,tileAnnotations,hydrologyBalanceHistory,
    battleLog:{count:window.CardTacticsRuntime?.getBattleLog?.()?.entries?.length??null,max:window.BattleLog?.MAX_ENTRIES??null},
    presentation:audit(),storageWarning:storageWarning||null,
    previousSession:previousSession?{status:previousStatus,...previousSession}:null,
    recoveredIncident,
    recentEvents:events.slice(-MAX)};
  return "CARD TACTICS 2.0 DIAGNOSTICS\n"+JSON.stringify(data,null,2);
}
async function copy(){
  const value=report();
  try{await navigator.clipboard.writeText(value);return true;}
  catch(_){const ta=document.createElement("textarea");ta.value=value;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();const ok=document.execCommand("copy");ta.remove();return ok;}
}
function clear(){events.length=0;roundHistory.length=0;tileAnnotations.length=0;hydrologyBalanceHistory.length=0;
  for(const key of Object.keys(perfCounters))delete perfCounters[key];
  for(const key of Object.keys(perfPeaks))delete perfPeaks[key];
  for(const key of Object.keys(spikeNotifiedAt))delete spikeNotifiedAt[key];
  lastEvidence=null;lastWaterSeamWarningKey="";lastWaterSeamCaptureAt=0;previousSession=null;previousStatus="";recoveredIncident=null;
  lastCheckpoint=null;lastWater=null;lastClimateKey="";lastSampleAt=0;lastSavedWaterLog=0;
  removeStorage(STORE_KEY);removeStorage(INCIDENT_KEY);if(enabled)store(true);}
function mount(){
  const panel=document.querySelector("#settingsScreen .settings-panel");
  if(!panel||document.getElementById("diagnosticsPanel"))return;
  const box=document.createElement("section");box.id="diagnosticsPanel";box.className="diagnostics-panel";
  box.innerHTML=`<h3>開發者診斷</h3>
    <label><span>啟用診斷與異常中斷紀錄</span><input id="diagnosticsToggle" type="checkbox"></label>
    <p class="diagnostics-note">記錄戰鬥、技能失敗、天氣、水文、光照資源及錯誤。手機閃退時無法當場寫入；下次開啟可查看最後儲存的檢查點。僅儲存在本機，不會自動上傳。</p>
    <pre id="diagnosticsSummary"></pre>
    <details><summary>查看最近事件與上次紀錄</summary><pre id="diagnosticsTimeline" style="max-height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere"></pre></details>
    <div class="diagnostics-actions"><button id="diagnosticsCapture" type="button">擷取當下渲染現場（不截圖）</button><button id="diagnosticsCopy" type="button">複製診斷報告（含上次紀錄）</button><button id="diagnosticsClear" type="button">清除紀錄</button></div>`;
  panel.appendChild(box);
  // Keep the capture action accessible WHILE the damaged battlefield is on
  // screen; navigating to Settings would destroy the evidence on some flows.
  const battleRail=document.querySelector("#battleScreen .battle-right-rail");
  let battleCapture=document.getElementById("diagnosticsCaptureBattle");
  if(battleRail&&!battleCapture){
    battleCapture=document.createElement("button");
    battleCapture.id="diagnosticsCaptureBattle";
    battleCapture.type="button";
    battleCapture.textContent="LOG";
    battleCapture.title="擷取當下畫面診斷（不截圖、不重建場景）";
    battleCapture.hidden=!enabled;
    battleCapture.onclick=()=>{
      const evidence=capture("BATTLE_VISUAL");
      battleCapture.title=evidence?"現場已保留，請至設定複製診斷報告":"擷取失敗，請確認診斷已啟用";
    };
    battleRail.insertBefore(battleCapture,battleRail.querySelector("#endTurn")||null);
  }
  const toggle=box.querySelector("#diagnosticsToggle"),summary=box.querySelector("#diagnosticsSummary"),timeline=box.querySelector("#diagnosticsTimeline"),copyBtn=box.querySelector("#diagnosticsCopy");
  toggle.checked=enabled;
  toggle.onchange=()=>{enabled=toggle.checked;writeStorage(PREF_KEY,enabled?"1":"0");if(enabled){push("DIAGNOSTICS",{enabled});sample();store(true);}else removeStorage(STORE_KEY);if(battleCapture)battleCapture.hidden=!enabled;refresh();};
  box.querySelector("#diagnosticsClear").onclick=()=>{clear();refresh();};
  box.querySelector("#diagnosticsCapture").onclick=()=>{
    const evidence=capture("SETTINGS_VISUAL");
    box.querySelector("#diagnosticsCapture").textContent=evidence?"已保留現場，請複製報告":"擷取失敗，請檢查診斷是否啟用";
    refresh();
  };
  copyBtn.onclick=async()=>{const ok=await copy(),old=copyBtn.textContent;copyBtn.textContent=ok?"已複製":"複製失敗";setTimeout(()=>copyBtn.textContent=old,1200);};
  function refresh(){
    const m=memory(),c=lastCheckpoint,v=window.CardTacticsRenderer?.diagnostics?.();
    summary.textContent=[
      `FPS ${fps}｜本次事件 ${events.length}/${MAX}｜診斷${enabled?"開":"關"}`,
      recoveredIncident?`保留的異常中斷：${recoveredIncident.updatedAt}（未確認原因）`:"",
      previousSession?`上次紀錄：${previousStatus}｜最後記錄 ${previousSession.updatedAt}`:"上次紀錄：無",
      c?`Round ${c.round}｜${c.phase}｜環境回合 ${c.environmentSteps}｜${c.weather}｜${c.timeOfDay}｜Units ${c.units}`:"Runtime 尚未完成檢查點",
      c?`水文 D ${c.hydrology.storedD}｜濕格 ${c.hydrology.wetTiles}｜最大深度 ${c.hydrology.maxDepth}｜雪 ${c.hydrology.snow}`:"",
      c?.scene?`Babylon meshes ${c.scene.meshes}｜materials ${c.scene.materials}｜textures ${c.scene.textures}｜lights ${c.scene.lights}｜physical ${c.lighting?.physicalLights??"-"}`:"",
      v?.performance?`最近每幀 Draw Calls ≈ ${v.performance.drawCallsPerFrame??"無可靠資料"}｜渲染 ${v.performance.renderMeanMs??"-"} ms` :"",
      `已保留 ${roundHistory.length} 回合摘要｜最高尖峰 ${Object.keys(perfPeaks).length} 類｜問題格取證 ${tileAnnotations.length} 組`,
      c?.waterSeams?`水面連通區 ${c.waterSeams.surfaceRegions}｜重用 ${c.waterSeams.update?.reused??0}／重建 ${c.waterSeams.update?.built??0}｜疑似缺水邊 ${c.waterSeams.internalBoundaries?.internalMissingSurfaceEdges??"-"}｜幾何警訊 ${c.waterSeams.warningCount}`:"",
      lastEvidence?`視覺現場：${lastEvidence.at}（${lastEvidence.label}）`:"尚未手動擷取視覺現場",
      v?`Babylon｜Tiles ${v.tiles??"-"}｜Units ${v.units??"-"}｜Zoom ${v.zoom??"-"}`:"",
      m?`JS Heap ${m.usedMB}/${m.totalMB} MB`:"iOS 無法提供 JS Heap 數值",
      storageWarning?`儲存警告：${storageWarning}`:""
    ].filter(Boolean).join("\n");
    if(box.querySelector("details")?.open){
      const last=events.slice(-36).map(e=>`${e.at} [${e.type}] ${JSON.stringify(e.data)}`);
      const old=previousSession?.events?.slice(-18).map(e=>`${e.at} [${e.type}] ${JSON.stringify(e.data)}`)||[];
      const incident=recoveredIncident?.events?.slice(-18).map(e=>`${e.at} [${e.type}] ${JSON.stringify(e.data)}`)||[];
      timeline.textContent=[`【本次】`,...last,previousSession?"【上次】":"",...old,recoveredIncident?"【保留的疑似異常中斷】":"",...incident].join("\n");
    }
  }
  setInterval(()=>{if(document.getElementById("settingsScreen")?.classList.contains("active"))refresh();},1200);
  box.querySelector("details").addEventListener("toggle",refresh);
  refresh();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
window.CardTacticsDiagnostics={push,gameAction,recordPerf,recordHydrologyBalance,recordTileAnnotation,report,copy,capture,clear,isEnabled:()=>enabled};
if(enabled){push("SESSION_START",{previousStatus:previousStatus||null});sample();store(true);}
})();
