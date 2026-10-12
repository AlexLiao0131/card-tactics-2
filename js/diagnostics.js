(()=>{
"use strict";

// Existing developer diagnostics owns both the live timeline and the last-session
// recovery record. This is observational only: it never mutates Battle/Grid State.
const MAX=320,SAVED_MAX=200,STORE_KEY="ct:diagnostics:session:v1",INCIDENT_KEY="ct:diagnostics:incident:v1",PREF_KEY="ct:diagnostics";
const events=[];
const now=()=>new Date().toISOString();
const started=performance.now();
const sessionId=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
let frames=0,lastFpsAt=started,fps=0,lastCheckpoint=null,lastClimateKey="",lastWater=null;
let lastStoredAt=0,lastSavedWaterLog=0,lastSampleAt=0,lastPhaseKey="",lastGameRound=null;
let previousSession=null,previousStatus="",recoveredIncident=null,lifecycle="ACTIVE",storageWarning="";

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
  const record={schema:1,sessionId,startedAt:new Date(Date.now()-(performance.now()-started)).toISOString(),
    updatedAt:now(),lifecycle,checkpoint:lastCheckpoint,events:events.slice(-SAVED_MAX)};
  writeStorage(STORE_KEY,JSON.stringify(record));
}
function push(type,data={}){
  if(!enabled&&type!=="ERROR"&&type!=="REJECTION")return;
  // Every entry stays compact so keeping the prior session is safe on iPhone.
  events.push({at:now(),type,data});
  if(events.length>MAX)events.splice(0,events.length-MAX);
  if(type==="ERROR"||type==="REJECTION"||type==="BOOT_FAILURE"||type==="WEBGL_CONTEXT_LOST"||type==="SKILL_FAILURE"||type==="CARD_FAILURE")store(true);
  else store();
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
  const actual={tiles:v?.tiles??null,mapObjects:v?.mapObjects?.objects??null,units:v?.units??null,enemyHand:document.querySelectorAll(".opponent-hand .opponent-card-back").length};
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
  let storedD=0,soil=0,wet=0,deep=0,maxDepth=0,snow=0,ice=0,flowing=0;
  for(const tile of tiles){
    const depth=Number(globalThis.HydrologyEngine?.waterDepth?.(tile)??tile?.waterDepth??0);
    const d=Number.isFinite(depth)?Math.max(0,depth):0;
    storedD+=d;soil+=Number(tile?.soilMoisture||0);
    if(d>0.001)wet++;if(d>0.5)deep++;if(d>maxDepth)maxDepth=d;
    snow+=Number(tile?.snowDepth||0);ice+=Number(tile?.iceThickness||0);
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
    hydrology:{storedD:numeric(storedD),soil:numeric(soil),wetTiles:wet,deepTiles:deep,maxDepth:numeric(maxDepth),snow:numeric(snow),ice:numeric(ice),flowingTiles:flowing},
    lighting:{sourceTypes:lightTypes,physicalLights:visual?.environment?.physicalLightsById?.size??null,sourceIds:lightSources.filter(source=>source?.source==="CORE_LIGHT"||source?.source==="CAPTURE_LIGHT").slice(0,12).map(source=>`${source.source}:${source.sourceId??"unknown"}`)},
    scene:scene?{meshes:scene.meshes?.length??null,materials:scene.materials?.length??null,textures:scene.textures?.length??null,lights:scene.lights?.length??null,activeMeshes:scene.getActiveMeshes?.()?.length??null}:null,
    heap:memory()};
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
    if(Date.now()-lastSampleAt>=12000){lastSampleAt=Date.now();push("CHECKPOINT",{round:sample.round,environmentSteps:sample.environmentSteps,weather:sample.weather,timeOfDay:sample.timeOfDay,fps:sample.fps,hydrology:sample.hydrology,lighting:sample.lighting,scene:sample.scene,heap:sample.heap});}
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
    runtime:runtime(),renderer:renderer(),memory:memory(),checkpoint:lastCheckpoint,
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
function clear(){events.length=0;previousSession=null;previousStatus="";recoveredIncident=null;lastCheckpoint=null;lastWater=null;lastClimateKey="";removeStorage(STORE_KEY);removeStorage(INCIDENT_KEY);if(enabled)store(true);}
function mount(){
  const panel=document.querySelector("#settingsScreen .settings-panel");
  if(!panel||document.getElementById("diagnosticsPanel"))return;
  const box=document.createElement("section");box.id="diagnosticsPanel";box.className="diagnostics-panel";
  box.innerHTML=`<h3>開發者診斷</h3>
    <label><span>啟用診斷與異常中斷紀錄</span><input id="diagnosticsToggle" type="checkbox"></label>
    <p class="diagnostics-note">記錄戰鬥、技能失敗、天氣、水文、光照資源及錯誤。手機閃退時無法當場寫入；下次開啟可查看最後儲存的檢查點。僅儲存在本機，不會自動上傳。</p>
    <pre id="diagnosticsSummary"></pre>
    <details><summary>查看最近事件與上次紀錄</summary><pre id="diagnosticsTimeline" style="max-height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere"></pre></details>
    <div class="diagnostics-actions"><button id="diagnosticsCopy" type="button">複製診斷報告（含上次紀錄）</button><button id="diagnosticsClear" type="button">清除紀錄</button></div>`;
  panel.appendChild(box);
  const toggle=box.querySelector("#diagnosticsToggle"),summary=box.querySelector("#diagnosticsSummary"),timeline=box.querySelector("#diagnosticsTimeline"),copyBtn=box.querySelector("#diagnosticsCopy");
  toggle.checked=enabled;
  toggle.onchange=()=>{enabled=toggle.checked;writeStorage(PREF_KEY,enabled?"1":"0");if(enabled){push("DIAGNOSTICS",{enabled});sample();store(true);}else removeStorage(STORE_KEY);refresh();};
  box.querySelector("#diagnosticsClear").onclick=()=>{clear();refresh();};
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
window.CardTacticsDiagnostics={push,gameAction,report,copy,clear,isEnabled:()=>enabled};
if(enabled){push("SESSION_START",{previousStatus:previousStatus||null});sample();store(true);}
})();
