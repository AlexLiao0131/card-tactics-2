(()=>{
"use strict";
const MAX=160,events=[];
let enabled=localStorage.getItem("ct:diagnostics")==="1",started=performance.now(),frames=0,lastFpsAt=performance.now(),fps=0;
const now=()=>new Date().toISOString();
function push(type,data={}){
  if(!enabled&&type!=="ERROR"&&type!=="REJECTION")return;
  events.push({at:now(),type,data});
  if(events.length>MAX)events.splice(0,events.length-MAX);
}
function errorData(err){
  if(!err)return{};
  return{name:err.name||"Error",message:String(err.message||err),stack:String(err.stack||"").slice(0,5000)};
}
window.addEventListener("error",e=>push("ERROR",{message:e.message,file:e.filename,line:e.lineno,column:e.colno,...errorData(e.error)}));
window.addEventListener("unhandledrejection",e=>push("REJECTION",errorData(e.reason)));
window.addEventListener("cardtactics:state",()=>push("STATE"));
window.addEventListener("cardtactics:battle-render",e=>push("BATTLE_RENDER",e.detail||{}));
window.addEventListener("cardtactics:log",()=>push("LOG"));
function frame(t){frames++;if(t-lastFpsAt>=1000){fps=Math.round(frames*1000/(t-lastFpsAt));frames=0;lastFpsAt=t}requestAnimationFrame(frame)}
requestAnimationFrame(frame);
function runtime(){
  const s=window.CardTacticsRuntime?.getBattleSnapshot?.();
  return s?{round:s.round,phase:s.phase,mode:s.mode,revision:s.revision,units:s.units?.length||0,tiles:s.map?.tiles?.length||0}:null;
}
function renderer(){return window.CardTacticsBattleView?.diagnostics?.()||null}
function memory(){
  const m=performance.memory;
  return m?{usedMB:+(m.usedJSHeapSize/1048576).toFixed(1),totalMB:+(m.totalJSHeapSize/1048576).toFixed(1),limitMB:+(m.jsHeapSizeLimit/1048576).toFixed(1)}:null;
}

function audit(){
  const s=window.CardTacticsRuntime?.getBattleSnapshot?.(),v=renderer();
  if(!s)return null;
  const expected={
    tiles:s.map?.tiles?.length||0,
    objects:(s.map?.objects||[]).filter(o=>!o.destroyed&&o.type!=="CORE").length,
    cores:s.cores?.length||0,units:s.units?.length||0,
    deploymentTiles:s.map?.tiles?.filter(t=>!!t.deploymentAreaOwner).length||0,
    captureTiles:s.map?.tiles?.filter(t=>!!t.capturePoint).length||0,
    enemyHand:s.presentation?.enemyHandCount||0
  };
  const actual={
    tiles:v?.objects?.tiles??null,objects:v?.objects?.mapObjects??null,cores:v?.objects?.cores??null,units:v?.objects?.units??null,
    enemyHand:document.querySelectorAll(".opponent-hand .opponent-card-back").length
  };
  const mismatch=[];
  for(const k of ["tiles","objects","cores","units","enemyHand"])if(actual[k]!==null&&expected[k]!==actual[k])mismatch.push(`${k}:${expected[k]}!=${actual[k]}`);
  return{expected,actual,ok:mismatch.length===0,mismatch};
}

function report(){
  const data={
    generatedAt:now(),userAgent:navigator.userAgent,
    enabled,uptimeSeconds:Math.round((performance.now()-started)/1000),fps,
    runtime:runtime(),renderer:renderer(),memory:memory(),
    battleLog:{count:window.CardTacticsRuntime?.getBattleLog?.()?.entries?.length??null,max:window.BattleLog?.MAX_ENTRIES??null},
    presentation:audit(),
    recentEvents:events.slice(-80)
  };
  return "CARD TACTICS DIAGNOSTICS\n"+JSON.stringify(data,null,2);
}
async function copy(){
  const value=report();
  try{await navigator.clipboard.writeText(value);return true}catch(_){
    const ta=document.createElement("textarea");ta.value=value;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();
    const ok=document.execCommand("copy");ta.remove();return ok;
  }
}
function mount(){
  const panel=document.querySelector("#settingsScreen .settings-panel");if(!panel||document.getElementById("diagnosticsPanel"))return;
  const box=document.createElement("section");box.id="diagnosticsPanel";box.className="diagnostics-panel";
  box.innerHTML=`<h3>開發者診斷</h3>
    <label><span>啟用診斷</span><input id="diagnosticsToggle" type="checkbox"></label>
    <p class="diagnostics-note">只保留最近 ${MAX} 個診斷事件；錯誤即使關閉診斷仍會保留。</p>
    <pre id="diagnosticsSummary"></pre>
    <div class="diagnostics-actions"><button id="diagnosticsCopy">複製診斷報告</button><button id="diagnosticsClear">清除紀錄</button></div>`;
  panel.insertBefore(box,panel.lastElementChild);
  const toggle=box.querySelector("#diagnosticsToggle"),summary=box.querySelector("#diagnosticsSummary"),copyBtn=box.querySelector("#diagnosticsCopy");
  toggle.checked=enabled;
  toggle.onchange=()=>{enabled=toggle.checked;localStorage.setItem("ct:diagnostics",enabled?"1":"0");push("DIAGNOSTICS",{enabled});refresh()};
  box.querySelector("#diagnosticsClear").onclick=()=>{events.length=0;refresh()};
  copyBtn.onclick=async()=>{const ok=await copy();const old=copyBtn.textContent;copyBtn.textContent=ok?"已複製":"複製失敗";setTimeout(()=>copyBtn.textContent=old,1200)};
  function refresh(){
    const r=runtime(),v=renderer(),m=memory();
    summary.textContent=[
      `FPS ${fps}｜事件 ${events.length}/${MAX}`,
      r?`Round ${r.round}｜${r.phase}｜${r.mode}｜Snapshot #${r.revision}｜Units ${r.units}`:"Runtime 尚未啟動",
      v?`Phaser children ${v.children}｜Zoom ${v.zoom}｜${v.projection}｜Rotation ${v.rotation}｜Render ${v.lastRenderMs}ms`:"Phaser 尚未啟動",
      (()=>{const a=audit();return a?(a.ok?"Presentation 對帳：PASS":`Presentation 對帳：FAIL ${a.mismatch.join(" ")}`):"Presentation 對帳：尚未啟動"})(),
      m?`JS Heap ${m.usedMB} / ${m.totalMB} MB`:"JS Heap：此瀏覽器不提供"
    ].join("\n");
  }
  setInterval(()=>{if(document.getElementById("settingsScreen")?.classList.contains("active"))refresh()},1000);refresh();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
window.CardTacticsDiagnostics={push,report,copy,clear:()=>events.splice(0),isEnabled:()=>enabled};
})();