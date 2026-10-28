/* Card Tactics 2.0 — full game benchmark controller.
 * Diagnostic driver, not a second Game State, renderer, AI or hydrology simulation.
 * No gameplay engine constants are modified. Only official Runtime/UI actions are used.
 */
// Running in the top-level original index.html document, with the real game renderer.
const OVERLAY_STYLE=`
#ct-bench-control{position:fixed;z-index:99999;left:max(8px,env(safe-area-inset-left));top:max(7px,env(safe-area-inset-top));max-width:min(440px,calc(100vw - 20px));background:#101d30f2;color:#eaf2fa;border:1px solid #4b6980;border-radius:12px;padding:9px;box-shadow:0 5px 20px #0009;font-family:system-ui,-apple-system,sans-serif}
#ct-bench-control header{display:flex;justify-content:space-between;align-items:center;gap:12px;font-weight:800;font-size:13px}
#ct-bench-control button,#ct-bench-control select,#ct-bench-control input{min-height:34px;border:1px solid #7192ab;background:#192b42;color:#fff;border-radius:7px;padding:4px 9px;font-size:12px}
#ct-bench-control button{cursor:pointer;font-weight:700}
#ct-bench-control button:disabled{opacity:.4}
#ct-bench-control #toggle{min-width:65px}
#ct-bench-control #fields{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}
#ct-bench-control #fields label{font-size:11px;display:flex;align-items:center;gap:5px}
#ct-bench-control #rounds{width:55px}
#ct-bench-control #scenario{max-width:185px}
#ct-bench-control #seed{width:100px}
#ct-bench-control #controls{display:flex;gap:6px;flex-wrap:wrap}
#ct-bench-control #status{margin:8px 0 0;font:11px/1.4 ui-monospace,monospace;max-height:115px;overflow:auto;white-space:pre-wrap}
#ct-bench-control.collapsed #fields,#ct-bench-control.collapsed #controls,#ct-bench-control.collapsed #options,#ct-bench-control.collapsed #instructions{display:none}
#ct-bench-control #instructions{font-size:10px;line-height:1.4;color:#aac5d8;margin-top:5px}
@media(max-width:540px){#ct-bench-control{max-width:calc(100vw - 24px)}#ct-bench-control #fields{margin:5px 0}}
`;
const style=document.createElement('style');style.textContent=OVERLAY_STYLE;document.head.appendChild(style);
const panel=document.createElement('aside');panel.id='ct-bench-control';panel.setAttribute('aria-label','正式戰局壓測工具');
panel.innerHTML=`<header><span>Card Tactics｜正式戰局自動測試</span><button id="toggle" type="button">收合</button></header>
<div id="fields"><label>Seed <input id="seed" value="4138639676" inputmode="numeric"></label><label>地圖 <select id="size"><option>SMALL</option><option selected>MEDIUM</option><option>LARGE</option><option>XLARGE</option></select></label><label>回合上限 <input id="rounds" value="12" type="number" min="1" max="60"></label><label>場景 <select id="scenario"><option value="SCENARIO">完整戰局＋極端氣候</option><option value="NATURAL">完整自然戰局</option></select></label></div>
<div id="controls"><button id="start" type="button" disabled>自動戰局測試</button><button id="manual" type="button" disabled>手玩低負擔監測</button><button id="stop" type="button" disabled>停止</button><button id="download" type="button" disabled>下載 JSON 報告</button></div>
<div id="options"><label><input id="runAB" type="checkbox"> 額外執行耗時的陰影／粒子／植被 A/B（自動測試專用，預設關閉）</label></div>
<div id="instructions">自動模式由測試器操作；手玩模式完全不控制角色、不重置地圖，每 2 秒讀取正式 Renderer 的現成指標。兩種模式的 FPS 與樣本量不可直接當成同一量測方法。</div>
<pre id="status">等待正式遊戲載入中…</pre>`;
document.body.appendChild(panel);
const $=id=>panel.querySelector('#'+id);
const els={start:$('start'),manual:$('manual'),runAB:$('runAB'),stop:$('stop'),download:$('download'),status:$('status'),seed:$('seed'),size:$('size'),rounds:$('rounds'),scenario:$('scenario')};
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const percentile=(data,p)=>{if(!data.length)return null;const sorted=[...data].sort((a,b)=>a-b);return +(sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))]).toFixed(2);};
const round2=n=>Number.isFinite(n)?+n.toFixed(2):null;
const metricSet=data=>({count:data.length,p50:percentile(data,.5),p95:percentile(data,.95),p99:percentile(data,.99),max:data.length?round2(Math.max(...data)):null});
const visible=(doc)=>doc.querySelector('#battleScreen')?.classList.contains('active');
const textStatus=(message)=>{els.status.textContent=message;};
const downloadJson=(filename,data)=>{const objectUrl=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=objectUrl;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),3000);};
let lastReport=null,runner=null;
$('toggle').onclick=()=>{const root=panel;root.classList.toggle('collapsed');$('toggle').textContent=root.classList.contains('collapsed')?'展開':'收合';};
els.stop.onclick=()=>{if(runner){runner.stop=true;textStatus('收到停止請求；正在結束當前正式遊戲動作並輸出已蒐集數據。');}};
const reportFilename=report=>`${report.kind==='CARD_TACTICS_2_MANUAL_PLAY_PERF'?'Card_Tactics_2_ManualPlayPerf':'Card_Tactics_2_FullBattleBenchmark'}_${report.setup?.seed||'current'}_${Date.now()}.json`;
els.download.onclick=()=>{if(lastReport)downloadJson(reportFilename(lastReport),lastReport);};

async function readyGame(){
  for(let i=0;i<400;i++){
    const win=window;
    try{if(win?.CardTacticsRuntime?.getBattleSnapshot&&win?.CardTacticsRenderer?.scene&&win?.CardDatabase&&win?.TacticalEngine)return win;}catch(_){/* navigating */}
    await sleep(100);
  }
  throw new Error('正式 Runtime / Babylon Renderer 未在啟動期限內載入');
}

/** This is a passive diagnostic observer; BabylonRenderer remains the sole RAF/render owner.
 * After-render microtasks read this SAME frame's CPU stats AFTER runRenderLoop commits them.
 * A long visible frame gap is never discarded, even when it exceeds two seconds.
 */
const MAX_WINDOWS=700,MAX_COMMITS=2500,MAX_SPIKES_PER_KIND=48;
const PUBLISH_STAGES=['sky','lighting','camera','picker','terrain','water','mapObjects','units','environment','mapObjectBatches','objectives','highlights','shadows','unitHud','actionAnchor'];
const singleMetric=n=>Number.isFinite(n)?round2(n):null;
class FrameCapture{
  constructor(win,report){
    this.win=win;this.report=report;this.startedAt=performance.now();
    this.windowStart=this.startedAt;this.windowPhase='BOOT';this.windowRound=0;this.heartbeatAt=this.startedAt;this.heartbeatWarned=false;
    this.lastFrameAt=null;this.disposed=false;this.seenCommits=new WeakSet();
    this.lastObservedCommit=null;this.nextDetailedAt=0;this.detailSamples=0;
    this.lastWatchdogAt=performance.now();
    report.eventLoopObservations={timerDelays:[],browserLongTasks:[],
      longTaskApiSupported:false,
      interpretation:'Timer delay is not a GPU timer or proof of thermal throttling.'};
    // A browser-supported long-task entry provides independent evidence of
    // main-thread blocking. Safari may not expose this API: absence is not
    // evidence that the main thread was idle.
    this.longTaskObserver=null;
    try{
      if(typeof PerformanceObserver!=='undefined'&&
        PerformanceObserver.supportedEntryTypes?.includes('longtask')){
        report.eventLoopObservations.longTaskApiSupported=true;
        this.longTaskObserver=new PerformanceObserver(list=>{
          for(const entry of list.getEntries()){
            const events=report.eventLoopObservations.browserLongTasks;
            if(events.length>=160)events.shift();
            events.push({atMs:round2(entry.startTime-report.startedAtMonotonic),
              durationMs:round2(entry.duration),entryType:entry.entryType});
          }
        });
        this.longTaskObserver.observe({entryTypes:['longtask']});
      }
    }catch(_){this.longTaskObserver?.disconnect?.();this.longTaskObserver=null;}
    this.data=this.emptyData();this.visibleFrames=0;this.hiddenFrames=0;
    for(const oldCommit of win.CardTacticsRenderer.presentationCommitHistory||[]){this.seenCommits.add(oldCommit);this.lastObservedCommit=oldCommit;}
    this.observer=win.CardTacticsRenderer.scene.onAfterRenderObservable.add(()=>this.sample());
    this.watchdog=setInterval(()=>{
      if(this.disposed)return;
      const now=performance.now(),delay=now-this.lastWatchdogAt-1000;
      this.lastWatchdogAt=now;
      if(document.hidden)return;
      if(delay>=1500){
        const events=report.eventLoopObservations.timerDelays;
        if(events.length>=160)events.shift();
        events.push({atMs:round2(now-report.startedAtMonotonic),
          delayMs:round2(delay),visible:!document.hidden,
          note:'Timer scheduling delay: main-thread blockage OR browser scheduling/throttling; not independently causal.'});
      }
      const gap=now-this.heartbeatAt;
      if(gap>=2000&&!this.heartbeatWarned){
        this.heartbeatWarned=true;
        if(this.report.lifecycle.length>=80)this.report.lifecycle.shift();
        this.report.lifecycle.push({type:'VISIBLE_NO_SCENE_FRAME_HEARTBEAT',
          atMs:round2(performance.now()-this.report.startedAtMonotonic),
          gapObservedMs:round2(gap),
          note:'JS event loop scheduling delay or scene rendering pause; this is not a root cause classification'});
      }
    },1000);
    this.onVisibility=()=>{
      const now=performance.now();
      if(this.report.lifecycle.length>=80)this.report.lifecycle.shift();
      this.report.lifecycle.push({atMs:round2(now-this.report.startedAtMonotonic),type:'VISIBILITY',state:document.visibilityState});
      // Do not mix background suspension into foreground FPS. Never silently drop it.
      if(document.hidden){this.flush();this.lastFrameAt=null;this.report.visibilityInterruptions++;}
      else{this.lastFrameAt=null;this.windowStart=now;}
      this.heartbeatAt=now;this.heartbeatWarned=false;this.lastWatchdogAt=now;
    };
    this.onPageHide=()=>{this.report.lifecycle.push({atMs:round2(performance.now()-this.report.startedAtMonotonic),type:'PAGEHIDE'});this.lastFrameAt=null;};
    document.addEventListener('visibilitychange',this.onVisibility);
    window.addEventListener('pagehide',this.onPageHide);
  }
  emptyData(){return{interval:[],cpu:[],render:[],shadow:[],nonScene:[],sync:[],frames:0,commits:0};}
  sample(){
    if(this.disposed)return;
    const now=performance.now();
    if(document.hidden){this.hiddenFrames++;this.lastFrameAt=null;return;}
    this.heartbeatAt=now;this.heartbeatWarned=false;
    const interval=this.lastFrameAt==null?null:now-this.lastFrameAt;
    this.lastFrameAt=now;
    const d=this.data;d.frames++;this.visibleFrames++;
    // The per-render path must be O(1): no snapshot, no history scan,
    // no sorting, and no microtask on most frames. Preserve ALL intervals.
    if(interval!=null&&Number.isFinite(interval)&&interval>=0){
      d.interval.push(interval);
      if(interval>=250)this.remember('FRAME_GAP',interval,{round:this.windowRound,phase:this.windowPhase});
    }
    if(now<this.nextDetailedAt)return;
    this.nextDetailedAt=now+500; // Detailed data is sampled at most twice per second.
    this.detailSamples++;
    const renderer=this.win.CardTacticsRenderer,frame=renderer.lastState||{};
    const phase=frame.phase||'UNKNOWN',round=Number(frame.round||0);
    if(phase!==this.windowPhase||round!==this.windowRound){
      this.flush();this.windowPhase=phase;this.windowRound=round;this.windowStart=now;
    }
    const commits=this.collectCommits(now);
    // Rendering statistics are finalized by the game's render loop; read
    // them in a microtask on detailed samples ONLY, never on every frame.
    queueMicrotask(()=>{
      if(this.disposed||document.hidden)return;
      const p=renderer.performanceStats||{};
      const cpu=Number(p.frameMs),render=Number(p.renderMs),shadow=Number(p.shadowPassCpuMs);
      const nonScene=Number.isFinite(cpu)&&Number.isFinite(render)?Math.max(0,cpu-render):null;
      if(Number.isFinite(cpu)){d.cpu.push(cpu);this.remember('CPU_FRAME',cpu,{round,phase,weather:frame.presentation?.environment?.weather,renderCpuMs:singleMetric(render),nonSceneCpuMs:singleMetric(nonScene)});}
      if(Number.isFinite(render))d.render.push(render);
      if(Number.isFinite(shadow))d.shadow.push(shadow);
      if(nonScene!=null){d.nonScene.push(nonScene);this.remember('CPU_OUTSIDE_SCENE_RENDER',nonScene,{round,phase,weather:frame.presentation?.environment?.weather,frameCpuMs:singleMetric(cpu)});}
      if(commits.length){d.commits+=commits.length;d.sync.push(...commits.map(c=>c.elapsedMs));}
      if(now-this.windowStart>=5000)this.flush();
    });
  }
  collectCommits(now){
    const renderer=this.win.CardTacticsRenderer,commits=[];
    const history=renderer.presentationCommitHistory||[];
    if(history.at(-1)===this.lastObservedCommit)return commits;
    const previousIndex=history.lastIndexOf(this.lastObservedCommit);
    for(let i=previousIndex+1;i<history.length;i++){
      const commit=history[i];
      if(this.seenCommits.has(commit))continue;
      this.seenCommits.add(commit);
      const ms=Number(commit.elapsedMs||0);
      const item={atMs:round2(now-this.report.startedAtMonotonic),revision:commit.revision,round:commit.round,
        elapsedMs:singleMetric(ms),complete:commit.complete===true,failedStages:[...(commit.failedStages||[])],
        ownersChanged:[...(commit.changes||[])],stages:Object.fromEntries(PUBLISH_STAGES
          .filter(name=>Number.isFinite(Number(commit.syncMs?.[name])))
          .map(name=>[name,Number(commit.syncMs[name])]))};
      // Preserve provenance. These are measured by the real WaterRenderer at
      // the moment it actually rebuilt, NOT inferred from elapsed frame time.
      if(ms>=150||item.ownersChanged.includes('waterGeometryVersion')){
        const details=renderer.water?.surfaceRebuildHistory?.findLast?.(entry=>
          entry.gameRevision===item.revision);
        if(details)item.waterRebuild={...details};
      }
      commits.push(item);this.report.publication.totalCommits++;
      if(!item.complete)this.report.publication.failedCommits++;
      const buckets=this.report.publication.bySubsystem;
      for(const [name,duration] of Object.entries(item.stages)){
        const b=buckets[name]||(buckets[name]={count:0,totalMs:0,maxMs:0,recentSamples:[]});
        b.count++;b.totalMs=round2(b.totalMs+duration);b.maxMs=Math.max(b.maxMs,duration);
        if(b.recentSamples.length>=MAX_COMMITS)b.recentSamples.shift();
        b.recentSamples.push(duration);
      }
      this.remember('SYNC_COMMIT',ms,{revision:item.revision,round:item.round,complete:item.complete,stages:item.stages,ownersChanged:item.ownersChanged});
      if(this.report.publication.commits.length>=MAX_COMMITS){this.report.publication.discardedOldestCommits++;this.report.publication.commits.shift();}
      this.report.publication.commits.push(item);
    }
    this.lastObservedCommit=history.at(-1)||this.lastObservedCommit;
    return commits;
  }
  remember(kind,elapsedMs,detail){
    const top=this.report.spikes[kind]||(this.report.spikes[kind]=[]);
    if(top.length>=MAX_SPIKES_PER_KIND&&elapsedMs<=top[top.length-1].elapsedMs)return;
    top.push({atMs:round2(performance.now()-this.report.startedAtMonotonic),elapsedMs:round2(elapsedMs),...detail});
    top.sort((a,b)=>b.elapsedMs-a.elapsedMs);
    if(top.length>MAX_SPIKES_PER_KIND)top.pop();
  }
  flush(){
    const d=this.data;
    if(!d.frames)return;
    const renderer=this.win.CardTacticsRenderer,perf=renderer.performanceStats||{};
    if(this.report.windows.length>=MAX_WINDOWS){this.report.discardedOldestWindows++;this.report.windows.shift();}
    this.report.windows.push({atMs:round2(performance.now()-this.report.startedAtMonotonic),round:this.windowRound,
      phase:this.windowPhase,frameIntervalMs:metricSet(d.interval),cpuFrameMs:metricSet(d.cpu),
      sceneRenderCpuMs:metricSet(d.render),shadowSubmissionCpuMs:metricSet(d.shadow),
      cpuOutsideSceneRenderMs:metricSet(d.nonScene),syncCommitMs:metricSet(d.sync),
      frames:d.frames,commits:d.commits,drawCallsPerFrame:perf.drawCallsPerFrame??null,
      meshes:renderer.scene.meshes.length,materials:renderer.scene.materials.length,
      activeMeshes:renderer.scene.getActiveMeshes?.()?.length??null,
      shadowsCasters:null,
      rendererErrors:Object.fromEntries([...(renderer.subsystemErrors?.keys?.()||[])].map(k=>[k,true])),weather:renderer.lastState?.presentation?.environment?.weather??null,
      night:renderer.lastState?.presentation?.environment?.timeOfDay??null});
    this.data=this.emptyData();this.windowStart=performance.now();
  }
  dispose(){
    if(this.disposed)return;
    // Drain latest commit before final disposal; no ownership changes.
    this.collectCommits(performance.now());this.flush();this.disposed=true;
    clearInterval(this.watchdog);
    this.longTaskObserver?.disconnect?.();
    document.removeEventListener('visibilitychange',this.onVisibility);
    window.removeEventListener('pagehide',this.onPageHide);
    this.win.CardTacticsRenderer.scene.onAfterRenderObservable.remove(this.observer);
    this.report.frameCoverage={visibleFrames:this.visibleFrames,hiddenFrames:this.hiddenFrames,
      method:'O(1) after-render interval recorder; detailed stats <=2Hz; all foreground frame intervals included',
      detailedSamples:this.detailSamples,
      caveat:'CPU/render distributions sample 2Hz and are NOT all-frame percentiles. SyncCommitMs is per-commit (not per-frame). Frame interval includes scheduling and GPU pacing; no GPU timer.'};
  }
}

/** Require the SAME committed snapshot on the real renderer and at least two rendered
 * scene turns. A loaded Runtime alone does NOT mean an XLARGE terrain is published.
 */
async function waitForPresentation(win,{abort=null,timeoutMs=45000,label='SCENE_READY'}={}){
  const renderer=win.CardTacticsRenderer,runtime=win.CardTacticsRuntime;
  const started=performance.now();let lastRenderId=renderer.scene.getRenderId?.()??-1;
  let stable=0,lastDiagnostic=null;
  while(performance.now()-started<timeoutMs){
    if(abort?.stop)throw new Error(`${label}:STOPPED`);
    const snap=runtime.getBattleSnapshot(),actual=renderer.lastState;
    const commit=(renderer.presentationCommitHistory||[]).at(-1);
    const renderId=renderer.scene.getRenderId?.()??-1;
    const errors=[...(renderer.subsystemErrors?.keys?.()||[])];
    const hasTerrain=!!renderer.terrain?.meshes?.get?.('surface');
    const published=Number.isFinite(Number(snap?.revision))&&
      renderer.lastCompletedPresentationRevision===snap.revision&&
      actual?.revision===snap.revision&&actual?.map?.id===snap.map?.id&&
      actual?.map?.tiles?.length===snap.map?.tiles?.length&&
      commit?.revision===snap.revision&&commit?.complete===true&&errors.length===0&&hasTerrain;
    const drew=renderId>lastRenderId&&document.visibilityState==='visible';
    stable=published&&drew?stable+1:0;
    lastDiagnostic={label,published,drew,stable,expectedRevision:snap?.revision,
      completedRevision:renderer.lastCompletedPresentationRevision??null,
      rendererRevision:actual?.revision??null,commitRevision:commit?.revision??null,
      expectedTiles:snap?.map?.tiles?.length??null,renderedTiles:actual?.map?.tiles?.length??null,
      mapId:snap?.map?.id,renderedMapId:actual?.map?.id,
      terrainMeshExists:hasTerrain,errors,renderId,visible:!document.hidden};
    if(stable>=2)return{...lastDiagnostic,waitMs:round2(performance.now()-started)};
    lastRenderId=renderId;
    await sleep(100);
  }
  throw new Error(`${label}:PRESENTATION_NOT_READY:${JSON.stringify(lastDiagnostic)}`);
}
const actionButtons=doc=>[...doc.querySelectorAll('#skillBar button')].filter(b=>!b.disabled);
const findButton=(doc,pattern)=>actionButtons(doc).find(b=>pattern.test(b.textContent||''));
const clickBtn=button=>{if(!button)return false;button.click();return true;};
const pointDist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const nearest=(candidates,goals)=>candidates.slice().sort((a,b)=>{
  const da=goals.length?Math.min(...goals.map(g=>pointDist(a,g))):Infinity;
  const db=goals.length?Math.min(...goals.map(g=>pointDist(b,g))):Infinity;
  return da-db||a.y-b.y||a.x-b.x;
})[0]||null;

function targets(snap){
  const pointTargets=(snap.presentation?.deploymentPoints||[]).filter(p=>p.owner!=='PLAYER'&&p.capturable!==false).flatMap(p=>p.captureTiles||[]);
  if(pointTargets.length)return pointTargets;
  const enemyCores=(snap.cores||[]).filter(c=>c.owner==='ENEMY'&&c.hp>0);
  if(enemyCores.length)return enemyCores;
  return (snap.units||[]).filter(u=>u.team==='ENEMY').map(u=>({x:u.x,y:u.y}));
}

function chooseCardTarget(snap,card){
  const eligible=(snap.map?.tiles||[]).filter(t=>card.type==='CHARACTER'?t.deployable:t.attackable);
  if(!eligible.length)return null;
  if(card.type==='CHARACTER'){
    const goals=targets(snap);
    return nearest(eligible,goals);
  }
  // Keep weather manipulation entirely in the real card system; select a legal centre only.
  const enemy=(snap.units||[]).filter(u=>u.team==='ENEMY');
  const friendly=(snap.units||[]).filter(u=>u.team==='PLAYER');
  const benefit=/(HEAL|BUFF|DISPEL)/.test(card.effect?.type||'');
  return nearest(eligible,(benefit?friendly:enemy).length?(benefit?friendly:enemy):targets(snap));
}

async function completeCardPhase(win,report,abort){
  const runtime=win.CardTacticsRuntime;
  let attempts=0;
  const rejected=new Set();
  while(runtime.getPhase()==='CARD_PHASE'&&!abort.stop&&attempts++<32){
    const state=runtime.getCardState();
    const cardId=(state?.zones?.hand||[]).find(id=>!rejected.has(id)&&runtime.canPlayCard(id));
    if(!cardId)break;
    const card=win.CardDatabase.get(cardId);
    if(!card||!runtime.playCard(cardId)){rejected.add(cardId);continue;}
    report.actions.CARD_SELECT++;
    if(runtime.getPendingCard()){
      const snap=runtime.getBattleSnapshot();
      const tile=chooseCardTarget(snap,card);
      if(!tile){runtime.cancelCard();rejected.add(cardId);report.warnings.push(`CARD_TARGET_UNAVAILABLE:${cardId}`);continue;}
      const preRevision=snap.revision;
      runtime.clickBattleTile(tile.x,tile.y);
      for(let i=0;i<60&&runtime.getPendingCard()&&!abort.stop;i++)await sleep(100);
      if(runtime.getPendingCard()){
        // Resolve remains pending (e.g. async card effect); never progress into illegal phase.
        report.warnings.push(`CARD_RESOLUTION_TIMEOUT:${cardId}:${preRevision}`);
        runtime.cancelCard();break;
      }
    }
    report.actions.CARD_RESOLVED++;
    await sleep(150);
  }
  if(runtime.getPhase()==='CARD_PHASE'&&!abort.stop){
    if(runtime.getPendingCard())runtime.cancelCard();
    if(!runtime.endCardPhase())throw new Error('正式 endCardPhase 拒絕，卡牌階段未結束');
    report.actions.CARD_END++;
  }
}

function resolveEngagement(win,report){
  const runtime=win.CardTacticsRuntime,engagement=runtime.getEngagementPresentation?.();
  if(!engagement)return false;
  const actions=(engagement.actions||[]).filter(a=>!a.disabled);
  // Official UI reaction/engagement path. No direct HP, hit chance, or AI changes.
  const chosen=actions.find(a=>a.id==='CONFIRM_ENGAGEMENT')
    ||actions.find(a=>a.id==='REACTION_EVADE')
    ||actions.find(a=>a.id==='GUARD_ACCEPT');
  // SUPPORT_NONE / BACK_SUPPORT only edit UI choices, and must never count
  // as combat progress or keep the driver alive in a support-choice loop.
  if(!chosen)return false;
  runtime.handleEngagementUIAction(chosen.id,chosen.payload||{});
  report.actions.REACTION++;
  return true;
}

const actorFrom=(snap,id)=>(snap.units||[]).find(u=>u.id===id);
function actionCompleted(runtime,actorId){
  if(runtime.getPhase()!=='PLAYER_TURN')return true;
  return actorFrom(runtime.getBattleSnapshot(),actorId)?.acted===true;
}
function restoreActorCommand(runtime,doc,actorId){
  for(let i=0;i<4;i++){
    const snap=runtime.getBattleSnapshot();
    if(snap.mode==='command'||actorFrom(snap,actorId)?.acted)return true;
    const back=findButton(doc,/^取消施放$|^返回$/);
    if(back){back.click();continue;}
    const actor=actorFrom(snap,actorId);
    if(actor&&snap.mode!=='support-select'){runtime.clickBattleTile(actor.x,actor.y);continue;}
    break;
  }
  return runtime.getBattleSnapshot().mode==='command';
}
function recordRejectedAttack(report,actorId,skill,target,reason,runtime){
  const history=report.rejectedActions;
  report.rejectedAttackCount++;
  if(history.length<80)history.push({round:runtime.getBattleSnapshot().round,actorId,
    skill,target:{x:target.x,y:target.y},reason,mode:runtime.getBattleSnapshot().mode});
}
async function attemptAttack(win,report,abort,actorId){
  const runtime=win.CardTacticsRuntime,doc=win.document;
  if(!clickBtn(findButton(doc,/^攻擊$/)))return false;
  const skillLabels=actionButtons(doc).filter(b=>/射程/.test(b.textContent||''))
    .map(b=>b.textContent||'');
  for(const skillLabel of skillLabels){
    if(abort.stop)return false;
    // Re-read the button from the current rendered UI; previous menu nodes
    // were discarded on each mode transition.
    const skill=actionButtons(doc).find(b=>(b.textContent||'')===skillLabel);
    if(!skill)continue;
    skill.click();
    let snap=runtime.getBattleSnapshot();
    if(snap.mode==='variant-menu'){
      const variant=actionButtons(doc).find(b=>!/返回|關閉/.test(b.textContent||''));
      if(variant){variant.click();snap=runtime.getBattleSnapshot();}
    }
    const enemyPositions=new Set((snap.units||[]).filter(u=>u.team==='ENEMY').map(u=>`${u.x},${u.y}`));
    const enemyTiles=(snap.map?.tiles||[]).filter(t=>t.attackable&&(
      enemyPositions.has(`${t.x},${t.y}`)||t.core?.owner==='ENEMY'));
    if(enemyTiles.length){
      const target=enemyTiles[0];
      runtime.clickBattleTile(target.x,target.y);
      report.actions.ATTACK_TARGET++; // Click attempt only; NOT a confirmed attack.
      // Official support confirmation, reaction and resolution may be separate
      // UI states. Use the actual actor turn state, never render revision.
      for(let step=0;step<6&&!abort.stop;step++){
        if(actionCompleted(runtime,actorId)){
          report.actions.ATTACK_RESOLVED++;
          return true;
        }
        // The official runtime may be resolving an asynchronous skill even
        // when no engagement-choice panel is visible yet.
        resolveEngagement(win,report);
        await sleep(100);
      }
      if(actionCompleted(runtime,actorId)){
        report.actions.ATTACK_RESOLVED++;
        return true;
      }
      recordRejectedAttack(report,actorId,skillLabel,target,'ACTOR_NOT_FINISHED_AFTER_TARGET_CLICK',runtime);
      // This exact attack must not be retried in the next automation tick.
      // Recover the official command menu so MOVE / WAIT can complete the turn.
      restoreActorCommand(runtime,doc,actorId);
      return false;
    }
    if(!restoreActorCommand(runtime,doc,actorId))return false;
    if(!clickBtn(findButton(doc,/^攻擊$/)))return false;
  }
  restoreActorCommand(runtime,doc,actorId);
  return false;
}

function confirmActorAction(runtime,actorId){
  if(runtime.getPhase()!=='PLAYER_TURN')return true;
  const actor=actorFrom(runtime.getBattleSnapshot(),actorId);
  return !actor||actor.acted;
}
async function playerAction(win,report,abort){
  const runtime=win.CardTacticsRuntime,doc=win.document;
  if(resolveEngagement(win,report))return;
  const engagement=runtime.getEngagementPresentation?.();
  if((engagement?.actions||[]).some(a=>!a.disabled))
    throw new Error('TEST_DRIVER_ENGAGEMENT_UNRESOLVED');
  const hasActor=runtime.selectNextAvailableUnit?.();
  const snapBefore=runtime.getBattleSnapshot();
  const selected=(snapBefore.units||[]).find(u=>u.team==='PLAYER'&&u.selected===true&&u.acted===false);
  if(!hasActor||!selected){
    if(runtime.endPlayerTurn())report.actions.TURN_END++;
    else throw new Error('TEST_DRIVER_PLAYER_END_REJECTED');
    return;
  }
  const actorId=selected.id;
  runtime.clickBattleTile(selected.x,selected.y);
  await sleep(120);
  if(runtime.getPhase()!=='PLAYER_TURN')return;
  if(clickBtn(findButton(doc,/^佔領/))){
    if(confirmActorAction(runtime,actorId)){report.actions.CAPTURE++;return;}
    report.warnings.push(`CAPTURE_NOT_RESOLVED:${actorId}`);
  }
  if(await attemptAttack(win,report,abort,actorId))return;
  if(!restoreActorCommand(runtime,doc,actorId))throw new Error(`TEST_DRIVER_COMMAND_RESTORE_FAILED:${actorId}`);
  const snap=runtime.getBattleSnapshot(),actor=actorFrom(snap,actorId);
  if(!actor||actor.acted||runtime.getPhase()!=='PLAYER_TURN')return;
  const reachable=(snap.map?.tiles||[]).filter(t=>t.reachable&&(t.x!==actor.x||t.y!==actor.y));
  const destination=nearest(reachable,targets(snap));
  let changedPosition=false;
  if(destination){
    runtime.clickBattleTile(destination.x,destination.y);
    const post=runtime.getBattleSnapshot(),moved=actorFrom(post,actorId);
    if(moved&&(moved.x!==actor.x||moved.y!==actor.y)){
      report.actions.MOVE++;changedPosition=true;
    }
    await sleep(180);
  }
  if(runtime.getPhase()!=='PLAYER_TURN')return;
  const after=runtime.getBattleSnapshot(),current=actorFrom(after,actorId);
  if(current&&!current.acted){
    restoreActorCommand(runtime,doc,actorId);
    const ready=runtime.getBattleSnapshot(),reselected=actorFrom(ready,actorId);
    if(reselected){
      runtime.clickBattleTile(reselected.x,reselected.y);
      if(clickBtn(findButton(doc,/^佔領/))&&confirmActorAction(runtime,actorId)){
        report.actions.CAPTURE++;return;
      }
      // A second attack search is meaningful only from a NEW position;
      // retrying from the same tile reproduces the old fake-success loop.
      if(changedPosition&&await attemptAttack(win,report,abort,actorId))return;
    }
  }
  if(confirmActorAction(runtime,actorId))return;
  if(!restoreActorCommand(runtime,doc,actorId))throw new Error(`TEST_DRIVER_COMMAND_RESTORE_FAILED:${actorId}`);
  if(clickBtn(findButton(doc,/^待機$/))&&confirmActorAction(runtime,actorId)){
    report.actions.WAIT++;return;
  }
  // Stop with an explicit DRIVER failure. Do not end a legal turn or falsely
  // report a game performance stall when the automation cannot complete it.
  throw new Error(`TEST_DRIVER_ACTOR_UNRESOLVED:${actorId}:ROUND_${snapBefore.round}`);
}

// Controlled baseline-isolate-baseline-isolate measurements in a paused but
// fully-rendering real battle scene. Isolate only via Babylon's supported
// refresh/start/stop interfaces and restore every original state in finally.
async function measureStaticPass(win,label,abort){
  const scene=win.CardTacticsRenderer.scene,renderer=win.CardTacticsRenderer;
  const intervals=[],render=[],frameCpu=[];
  let previous=null,interruptions=0;
  const onVisibility=()=>{interruptions++;previous=null;};
  document.addEventListener('visibilitychange',onVisibility);
  const capture=scene.onAfterRenderObservable.add(()=>{
    if(abort.stop||document.hidden)return;
    const now=performance.now();
    if(previous!=null)intervals.push(now-previous); // NEVER discard >2s foreground stalls.
    previous=now;
    queueMicrotask(()=>{
      if(abort.stop||document.hidden)return;
      const stats=renderer.performanceStats||{};
      if(Number.isFinite(stats.renderMs))render.push(stats.renderMs);
      if(Number.isFinite(stats.frameMs))frameCpu.push(stats.frameMs);
    });
  });
  try{await sleep(3000);}
  finally{scene.onAfterRenderObservable.remove(capture);document.removeEventListener('visibilitychange',onVisibility);}
  return{label,frameIntervalMs:metricSet(intervals),renderCpuMs:metricSet(render),
    frameCpuMs:metricSet(frameCpu),visibilityInterrupted:interruptions>0};
}
async function staticAB(win,report,abort,label='INITIAL'){
  const runtime=win.CardTacticsRuntime,renderer=win.CardTacticsRenderer;
  const revision=runtime.getBattleSnapshot().revision;
  const output={label,sourceRevision:revision,mode:'PAUSED_REAL_BATTLE_SCENE',trials:[],status:'RUNNING',
    notCovered:['GRASS_WIND_CPU','WATER_RENDER'],
    note:'Vegetation sway, shadow repaint and active particle ownership are isolated only while gameplay state is paused. Frame intervals include GPU pacing; these are not GPU timings.'};
  (report.isolations||(report.isolations=[])).push(output);
  const constant=()=>runtime.getBattleSnapshot().revision===revision;
  async function runOne(name,apply,restore){
    if(abort.stop||!constant())return;
    const results=[];
    try{
      for(const mode of ['BASELINE','ISOLATED','BASELINE','ISOLATED']){
        if(abort.stop||!constant())break;
        if(mode==='ISOLATED')apply();else restore();
        await sleep(600); // Allow render target / particle warmup after a switch.
        results.push(await measureStaticPass(win,`${name}_${mode}`,abort));
      }
    }finally{restore();}
    output.trials.push({name,segments:results,valid:results.length===4&&constant()&&!abort.stop&&
      results.every(x=>x.frameIntervalMs.count>0&&!x.visibilityInterrupted),
      interpretation:'Inspect raw segment medians/P95 and return-to-baseline; no inferred GPU milliseconds or temperature.'});
  }
  // A rendering diagnostic, never a permanent shadow disable or lighting change.
  const texture=renderer.shadowGenerator?.getShadowMap?.();
  if(texture&&typeof texture.refreshRate==='number'){
    const saved=texture.refreshRate;
    try{await runOne('SHADOW_MAP_REPAINT',()=>{texture.refreshRate=win.BABYLON?.RenderTargetTexture?.REFRESHRATE_RENDER_ONCE??0;texture.resetRefreshCounter?.();},
      ()=>{texture.refreshRate=saved;texture.resetRefreshCounter?.();});}
    catch(error){output.trials.push({name:'SHADOW_MAP_REPAINT',valid:false,error:String(error?.message||error)});}
    finally{texture.refreshRate=saved;texture.resetRefreshCounter?.();}
  }
  // The real particle ownership stays inside EnvironmentRenderer. Restore all
  // systems to their prior started state. If none is emitting, avoid a fake result.
  const systems=[renderer.environment?.rainSystem,renderer.environment?.snowSystem,renderer.environment?.mistSystem]
    .filter(system=>system&&typeof system.isStarted==='function');
  const started=systems.filter(system=>system.isStarted());
  if(started.length&&constant()&&!abort.stop){
    try{await runOne('WEATHER_PARTICLE_SYSTEMS',()=>started.forEach(system=>system.stop()),
      ()=>started.forEach(system=>{if(!system.isStarted())system.start();}));}
    catch(error){output.trials.push({name:'WEATHER_PARTICLE_SYSTEMS',valid:false,error:String(error?.message||error)});}
    finally{started.forEach(system=>{if(!system.isStarted())system.start();});}
  }else output.trials.push({name:'WEATHER_PARTICLE_SYSTEMS',valid:false,reason:'NO_ACTIVE_SYSTEM_OR_STATE_CHANGED'});
  // Isolate the existing vegetation animation observer without removing or
  // reordering it, replacing its shader, or disabling scene light/shadows.
  // Observer.mask=0 simply suppresses callbacks for this stationary A/B pass.
  // Preserve the exact original mask in every exit path.
  const windObserver=renderer.mapObjects?.vegetationObserver;
  if(windObserver&&typeof windObserver.mask==='number'&&
    Number(renderer.mapObjects?.vegetationWind?.strength||0)>0&&constant()&&!abort.stop){
    const saved=windObserver.mask;
    try{await runOne('TREE_BUSH_WIND_UPDATE_AND_UPLOAD',()=>{windObserver.mask=0;},
      ()=>{windObserver.mask=saved;});}
    catch(error){output.trials.push({name:'TREE_BUSH_WIND_UPDATE_AND_UPLOAD',valid:false,error:String(error?.message||error)});}
    finally{windObserver.mask=saved;}
  }else output.trials.push({name:'TREE_BUSH_WIND_UPDATE_AND_UPLOAD',valid:false,
    reason:'OBSERVER_MASK_UNAVAILABLE_OR_CALM_WIND_OR_STATE_CHANGED'});
  output.status=abort.stop?'STOPPED':constant()?'DONE':'INVALID_GAME_STATE_CHANGED';
}

function reportCheckpoint(win,report,label){
  const runtime=win.CardTacticsRuntime,renderer=win.CardTacticsRenderer;
  const snap=runtime.getBattleSnapshot(),perf=renderer.diagnostics?.();
  report.checkpoints.push({label,atMs:round2(performance.now()-report.startedAtMonotonic),round:snap.round,phase:snap.phase,revision:snap.revision,
    weather:snap.presentation?.environment?.weather||null,time:snap.presentation?.environment?.timeOfDay||null,
    units:snap.units?.length||0,tiles:snap.map?.tiles?.length||0,mapSeed:win.CardTacticsBattleSetup?.seed||null,
    meshes:renderer.scene.meshes.length,materials:renderer.scene.materials.length,textures:renderer.scene.textures.length,
    shadowCasters:perf?.shadows?.casters||0,drawCallsPerFrame:perf?.performance?.drawCallsPerFrame??null,
    lastFrame:perf?.performance?.frameMs??null,renderElapsed:perf?.performance?.renderMs??null,
    mapObjects:perf?.mapObjects||null,environment:perf?.environment||null,
    rendererPublishedRevision:renderer.lastCompletedPresentationRevision??null,
    rendererPublishedTileCount:renderer.lastState?.map?.tiles?.length??null,
    publicationComplete:renderer.lastCompletedPresentationRevision===snap.revision&&
      renderer.lastState?.map?.tiles?.length===snap.map?.tiles?.length,
    lastPublication:renderer.presentationCommitHistory?.at(-1)?{
      revision:renderer.presentationCommitHistory.at(-1).revision,
      totalMs:renderer.presentationCommitHistory.at(-1).elapsedMs,
      complete:renderer.presentationCommitHistory.at(-1).complete,
      slowSubsystems:Object.entries(renderer.presentationCommitHistory.at(-1).syncMs||{})
        .filter(([key])=>PUBLISH_STAGES.includes(key))
        .sort((a,b)=>b[1]-a[1]).slice(0,6)}:null,
    unitMaterialsCached:renderer.units?.figureMaterials?.size??null,
    unitEntries:renderer.units?.entries?.size??null,
    errors:perf?.rendererErrors||{}});
}

async function runBenchmark(win,setup,abort){
  const runtime=win.CardTacticsRuntime,doc=win.document;
  const report={kind:'CARD_TACTICS_2_FORMAL_BATTLE_AUTO_BENCHMARK',version:2,reviewedSourceHead:'ede84124f21212c288187cc64cc4f8f2ecf85dba',diagnosticRevision:'STAGE_8N_D_TEST_DRIVER',servedCodeHead:'NOT_VERIFIED_IN_BROWSER',
    generatedAt:null,startedAt:new Date().toISOString(),startedAtMonotonic:performance.now(),
    setup:{...setup},scenarioInjections:[],engine:'REAL_INDEX_HTML_TOP_LEVEL',gameplayPath:'OFFICIAL_RUNTIME_AND_AI',
    limitation:'Game sync timings are official. Frame intervals include scheduling and GPU pacing. CPU detailed stats sampled <=2Hz. Optional A/B is never representative of manual play.',
    status:'RUNNING',actions:{CARD_SELECT:0,CARD_RESOLVED:0,CARD_END:0,MOVE:0,ATTACK_TARGET:0,ATTACK_RESOLVED:0,CAPTURE:0,WAIT:0,REACTION:0,TURN_END:0},
    checkpoints:[],windows:[],lifecycle:[],visibilityInterruptions:0,discardedOldestWindows:0,
    spikes:{},publication:{commits:[],totalCommits:0,failedCommits:0,discardedOldestCommits:0,bySubsystem:{}},
    warnings:[],errors:[],rejectedActions:[],rejectedAttackCount:0,completedRounds:0,coverage:{weather:[],timeOfDay:[],rounds:0,battleActions:0}};
  let capture=null;
  const seenWeather=new Set(),seenDay=new Set();
  let lastRound=0,lastCheckpointAt=0,lastProgressAt=performance.now(),lastProgress='',loopCount=0,lastEnemySnapshot=null,lastEnemySnapshotAt=0;
  const stressPlan=new Map([[2,'HEAVY_RAIN'],[4,'SNOW'],[6,'BLIZZARD'],[8,'SCORCHING_SUN'],[10,'THUNDERSTORM']]);
  const appliedStages=new Set();
    try{
    // Use the exact BattleSetupEngine entrypoint. No debug spawn, move, weather or environment step.
    const selectedDeck=win.DeckEngine?.getActive?.()||[];
    const validation=win.DeckEngine?.validate?.(selectedDeck);
    const firstPack=win.PackDatabase?.list?.()?.[0]?.id;
    const generatedDeck=validation?.valid?null:win.DeckEngine?.autoBuild?.(firstPack);
    const generatedIsValid=generatedDeck&&win.DeckEngine?.validate?.(generatedDeck)?.valid;
    const benchmarkDeck=validation?.valid?selectedDeck:generatedIsValid?generatedDeck:null;
    report.deckSource=validation?.valid?'EXISTING_ACTIVE_DECK':generatedIsValid?'OFFICIAL_AUTO_BUILD_NOT_PERSISTED':'STAGE_DEFAULT_DECK';
    win.CardTacticsBattleSetup={stageId:'versus_core_battle',mapSize:setup.mapSize,seed:setup.seed,
      ...(benchmarkDeck?{deck:[...benchmarkDeck]}:{})};
    runtime.resetBattle();
    // Only show the normal game's battle screen; the runtime and renderer are unchanged.
    for(const screen of doc.querySelectorAll('.game-screen'))screen.classList.toggle('active',screen.id==='battleScreen');
    win.CardTacticsRenderer.resize();win.CardTacticsRenderer.resetView();
    win.dispatchEvent(new win.CustomEvent('cardtactics:battle-screen-enter'));
    textStatus('等待正式 XLARGE/所選地圖已經發布到 Babylon Renderer…');
    report.sceneReady=await waitForPresentation(win,{abort,label:'AFTER_RESET'});
    // A fully-published initial terrain can be expensive, but this boot cost
    // must not pollute the steady-state gameplay frame distribution.
    const initialCommit=win.CardTacticsRenderer.presentationCommitHistory?.at(-1);
    report.initialScenePublication=initialCommit?{revision:initialCommit.revision,
      elapsedMs:initialCommit.elapsedMs,complete:initialCommit.complete,
      stages:Object.fromEntries(PUBLISH_STAGES.filter(k=>initialCommit.syncMs?.[k]!=null)
        .map(k=>[k,initialCommit.syncMs[k]]))}:null;
    capture=new FrameCapture(win,report);
    reportCheckpoint(win,report,'START_PUBLISHED');
    if(setup.runAB){
      await sleep(1500);
      textStatus('執行額外 A/B 隔離測試（此段不能當作手玩 FPS）。');
      await staticAB(win,report,abort,'INITIAL_FULL_GAME');
    }
    if(setup.runAB&&!abort.stop){
      try{report.sceneReadyAfterAB=await waitForPresentation(win,{abort,label:'AFTER_INITIAL_AB'});}
      catch(error){report.warnings.push('POST_AB_SCENE_NOT_STABLE:'+String(error?.message||error));}
    }
    while(!abort.stop){
      const phase=runtime.getPhase();
      const now=performance.now();
      const snap=phase==='ENEMY_TURN'&&lastEnemySnapshot&&now-lastEnemySnapshotAt<1200?lastEnemySnapshot:runtime.getBattleSnapshot();
      if(phase==='ENEMY_TURN'){lastEnemySnapshot=snap;lastEnemySnapshotAt=now;}
      const round=Number(snap.round||0);
      seenWeather.add(snap.presentation?.environment?.weather||'UNKNOWN');
      seenDay.add(snap.presentation?.environment?.timeOfDay||'UNKNOWN');
      if(round!==lastRound){lastRound=round;lastProgressAt=performance.now();report.completedRounds=Math.max(report.completedRounds,round-1);reportCheckpoint(win,report,`ROUND_${round}`);}
      if(phase==='MATCH_ENDED'){report.status='MATCH_ENDED';break;}
      if(round>setup.maxRounds){report.status='ROUND_LIMIT';break;}
      // Stress mode changes only official weather state, at round boundaries.
      // Cards, tactical turns, enemy AI, climate ticks and hydrology remain real.
      // These injections are EXPLICIT in the report and never labeled natural play.
      if(setup.scenario==='SCENARIO'&&phase==='CARD_PHASE'&&stressPlan.has(round)&&!appliedStages.has(round)){
        appliedStages.add(round);
        const weather=stressPlan.get(round);
        const duration=win.EnvironmentEngine?.WEATHER_TURNS?.[weather];
        if(Number.isFinite(Number(duration))&&Number(duration)>0&&runtime.debug?.setWeather){
          const success=runtime.debug.setWeather(weather,duration,{applyPulse:false});
          report.scenarioInjections.push({round,weather,duration,success,source:'OFFICIAL_RUNTIME_DEBUG_WEATHER',appliedWithoutImmediatePulse:true});
          if(!success)report.warnings.push(`SCENARIO_WEATHER_REJECTED:${weather}`);
          else if(weather==='BLIZZARD'&&setup.runAB){
            report.blizzardSceneReady=await waitForPresentation(win,{abort,label:'BLIZZARD_BEFORE_AB'});
            await sleep(1500);
            textStatus('完整戰局暴風雪場景｜執行第二組 A/B 影格測試，保留正式水文與 AI 狀態。');
            await staticAB(win,report,abort,'BLIZZARD_FULL_GAME');
          }
        }else report.warnings.push(`MISSING_MASTER_WEATHER_DURATION:${weather}`);
      }
      // Real game progress only. Render revisions and target clicks are NOT
      // action progress; previously they kept a failed attack loop alive.
      const progress=`${round}:${phase}:${report.actions.CARD_RESOLVED}:${report.actions.ATTACK_RESOLVED}:${report.actions.MOVE}:${report.actions.CAPTURE}:${report.actions.WAIT}:${report.actions.REACTION}:${report.actions.TURN_END}`;
      if(progress!==lastProgress){lastProgress=progress;lastProgressAt=performance.now();}
      if(performance.now()-lastProgressAt>120000){report.warnings.push('NO_PROGRESS_FOR_120_SECONDS');report.status='STALLED';break;}
      if(phase==='CARD_PHASE')await completeCardPhase(win,report,abort);
      else if(phase==='PLAYER_TURN')await playerAction(win,report,abort);
      else if(phase==='ENEMY_TURN'){
        if(!resolveEngagement(win,report))await sleep(350);
      }else{report.status='UNKNOWN_PHASE';report.warnings.push(`PHASE:${phase}`);break;}
      loopCount++;
      if(loopCount%6===0||performance.now()-lastCheckpointAt>15000){
        lastCheckpointAt=performance.now();
        textStatus(`正式戰局進行中｜Round ${round}/${setup.maxRounds}\n${phase}｜${snap.presentation?.environment?.weather||'—'}\n出牌 ${report.actions.CARD_RESOLVED}／移動 ${report.actions.MOVE}／已結算攻擊 ${report.actions.ATTACK_RESOLVED}／目標點擊 ${report.actions.ATTACK_TARGET}／佔點 ${report.actions.CAPTURE}\nFPS量測視窗 ${report.windows.length} 筆｜可隨時停止`);
      }
      // Checkpoints are collected at round boundaries and finalization only.
      // Avoid invoking the expensive renderer.diagnostics() during active play.
      await sleep(250);
    }
    if(abort.stop)report.status='STOPPED_BY_USER';
  }catch(error){report.status=String(error?.message||error).startsWith('TEST_DRIVER_')?'TEST_DRIVER_ERROR':'ERROR';report.errors.push(String(error?.stack||error));
    if(String(error?.message||error).includes('PRESENTATION_NOT_READY'))report.warnings.push('INVALID_SCENE_PUBLICATION_NO_BENCHMARK_RESULT');}
  finally{
    capture?.dispose();reportCheckpoint(win,report,'FINAL');
    for(const summary of Object.values(report.publication.bySubsystem)){
      const recent=summary.recentSamples||[];
      summary.recentMetrics=metricSet(recent);delete summary.recentSamples;
    }
    report.generatedAt=new Date().toISOString();report.durationMs=round2(performance.now()-report.startedAtMonotonic);
    report.coverage.weather=[...seenWeather];report.coverage.timeOfDay=[...seenDay];report.coverage.rounds=report.completedRounds;
    report.coverage.battleActions=report.actions.MOVE+report.actions.ATTACK_RESOLVED+report.actions.CAPTURE;
    if(report.actions.CARD_RESOLVED===0)report.warnings.push('NO_CARD_RESOLVED');
    if(report.actions.WAIT>0&&report.actions.ATTACK_RESOLVED===0)report.warnings.push('PASSIVE_PLAYER_BOT_NO_CONFIRMED_ATTACK_YET');
    report.attributionStatus=setup.runAB?'OPTIONAL_PARTIAL_AB_NOT_CAUSAL_PROOF':'NO_AB_LOW_INTERFERENCE';
    report.captureLimitations=['No GPU timer or chip temperature readout',
      'published per-subsystem sync times are exact per commit; CPU outside scene render is residual, not identified subsystem time',
      'auto benchmark is not manual play and cannot be used to claim manual-play FPS',
      '2Hz CPU detailed sampling; frame interval observations are all frames',
      'same-round play can diverge due to shuffled deck and AI: no complete-game replay equivalence asserted'];
    if(report.actions.ATTACK_RESOLVED===0)report.warnings.push('NO_CONFIRMED_PLAYER_ATTACK_COVERAGE');
    if(report.actions.CAPTURE===0)report.warnings.push('NO_CAPTURE_COVERAGE');
    if(!seenWeather.has('BLIZZARD'))report.warnings.push('BLIZZARD_NOT_COVERED_BY_NATURAL_GAMEPLAY');
    if(report.visibilityInterruptions)report.warnings.push('BACKGROUND_INTERRUPTION_FOREGROUND_WINDOWS_NOT_COMPARABLE');
    delete report.startedAtMonotonic;
  }
  return report;
}

els.start.onclick=async()=>{
  if(runner)return;
  const maxRounds=Math.max(1,Math.min(60,Math.floor(Number(els.rounds.value)||12)));
  const seed=String(els.seed.value||'4138639676').trim(),mapSize=els.size.value,scenario=els.scenario.value,runAB=els.runAB.checked;
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(seed)){textStatus('Seed 僅接受英數字、底線、連字號。');return;}
  runner={stop:false};els.start.disabled=true;els.manual.disabled=true;els.stop.disabled=false;els.download.disabled=true;
  try{
    const win=await readyGame();
    lastReport=await runBenchmark(win,{seed,mapSize,maxRounds,scenario,runAB},runner);
    els.download.disabled=false;
    // Attempt automatic report export. iOS Safari may require a separate user
    // gesture, so the download button stays enabled as an explicit fallback.
    try{downloadJson(reportFilename(lastReport),lastReport);}
    catch(error){lastReport.warnings.push(`AUTO_EXPORT_DENIED:${String(error?.message||error)}`);}
    const worstCpu=lastReport.spikes?.CPU_FRAME?.[0],worstSync=lastReport.spikes?.SYNC_COMMIT?.[0];
    textStatus(`測試結束｜${lastReport.status}\n已完成回合 ${lastReport.completedRounds}｜量測視窗 ${lastReport.windows.length}\n最重CPU幀 ${worstCpu?.elapsedMs??'—'}ms｜最重場景同步 ${worstSync?.elapsedMs??'—'}ms\n出牌 ${lastReport.actions.CARD_RESOLVED}、移動 ${lastReport.actions.MOVE}、已結算攻擊 ${lastReport.actions.ATTACK_RESOLVED}（點擊 ${lastReport.actions.ATTACK_TARGET}）、佔點 ${lastReport.actions.CAPTURE}\n警示 ${lastReport.warnings.length}｜已嘗試自動輸出；若手機未下載，請點「下載 JSON 報告」。`);
  }catch(error){textStatus(`測試啟動失敗：${error?.message||error}`);}
  finally{runner=null;els.start.disabled=false;els.manual.disabled=false;els.stop.disabled=true;}
};

/** A completely separate manual-play observer. No game reset, no auto actions,
 * no RAF callback, no A/B; it only polls already-maintained renderer values.
 * The report schema and provenance make it impossible to mistake for an auto run.
 */
async function runManualObservation(win,abort){
  const renderer=win.CardTacticsRenderer;
  const started=performance.now();
  const report={kind:'CARD_TACTICS_2_MANUAL_PLAY_PERF',version:1,
    diagnosticRevision:'STAGE_8N_D_QUIET_MANUAL',generatedAt:null,
    startedAt:new Date().toISOString(),status:'RUNNING',
    mode:'MANUAL_PLAY_PASSIVE',setup:{seed:win.CardTacticsBattleSetup?.seed||null,
      mapSize:win.CardTacticsBattleSetup?.mapSize||null},
    pollingIntervalMs:2000,sceneRenderObserverInstalled:false,
    botActions:0,abInterventions:0,gameStateMutations:0,
    samples:[],commitSpikes:[],totalNewCommits:0,failedCommits:0,
    visibilityInterruptions:0,monitoringCost:{samples:0,totalMs:0,maxMs:0},
    notes:['Existing Babylon engine.getFps and renderer.performanceStats are sampled, not recalculated.',
      '2s polling reports point-in-time values, NOT continuous frame FPS percentiles.',
      'Commit history has bounded retention; this is not guaranteed exhaustive across long pauses.',
      'Do not directly compare these samples with the detailed auto benchmark.']};
  let lastCommit=renderer.presentationCommitHistory?.at(-1)||null;
  const seen=new WeakSet();
  if(lastCommit)seen.add(lastCommit);
  let hidden=document.hidden;
  const onVisibility=()=>{if(document.hidden&&!hidden)report.visibilityInterruptions++;hidden=document.hidden;};
  document.addEventListener('visibilitychange',onVisibility);
  try{
    while(!abort.stop){
      await sleep(2000);
      if(abort.stop)break;
      const t0=performance.now();
      if(document.hidden)continue;
      const game=renderer.lastState||{},perf=renderer.performanceStats||{};
      const history=renderer.presentationCommitHistory||[];
      const idx=history.lastIndexOf(lastCommit);
      for(let i=idx+1;i<history.length;i++){
        const commit=history[i];if(seen.has(commit))continue;
        seen.add(commit);report.totalNewCommits++;
        if(!commit.complete)report.failedCommits++;
        if(Number(commit.elapsedMs)>=150||!commit.complete){
          const entry={atMs:round2(performance.now()-started),round:commit.round,
            revision:commit.revision,totalMs:round2(Number(commit.elapsedMs)||0),
            complete:!!commit.complete,failedStages:[...(commit.failedStages||[])],
            stages:Object.fromEntries(Object.entries(commit.syncMs||{}).filter(([k])=>PUBLISH_STAGES.includes(k)))};
          report.commitSpikes.push(entry);
          report.commitSpikes.sort((a,b)=>b.totalMs-a.totalMs);
          if(report.commitSpikes.length>32)report.commitSpikes.pop();
        }
      }
      lastCommit=history.at(-1)||lastCommit;
      if(report.samples.length>=1200)report.samples.shift();
      report.samples.push({atMs:round2(performance.now()-started),
        round:game.round??null,phase:game.phase??null,
        weather:game.presentation?.environment?.weather||null,
        time:game.presentation?.environment?.timeOfDay||null,
        units:game.units?.length??null,tiles:game.map?.tiles?.length??null,
        fps:singleMetric(renderer.scene?.getEngine?.().getFps?.()),
        cpuFrameMs:singleMetric(Number(perf.frameMs)),
        sceneRenderCpuMs:singleMetric(Number(perf.renderMs)),
        drawCallsPerFrame:singleMetric(Number(perf.drawCallsPerFrame)),
        meshes:renderer.scene?.meshes?.length??null});
      const cost=performance.now()-t0;
      report.monitoringCost.samples++;
      report.monitoringCost.totalMs=round2(report.monitoringCost.totalMs+cost);
      report.monitoringCost.maxMs=Math.max(report.monitoringCost.maxMs,round2(cost));
      if(report.samples.length%10===0)textStatus(`手玩監測中｜${report.samples.length} 次低負擔採樣｜Round ${game.round??'—'}｜FPS ${report.samples.at(-1).fps??'—'}
正常操作即可；監測器不控制遊戲。按停止後下載報告。`);
      if(game.phase==='MATCH_ENDED'){report.status='MATCH_ENDED';break;}
    }
    if(abort.stop)report.status='STOPPED_BY_USER';
  }finally{
    document.removeEventListener('visibilitychange',onVisibility);
    report.generatedAt=new Date().toISOString();report.durationMs=round2(performance.now()-started);
    report.monitoringCost.meanMs=report.monitoringCost.samples?
      round2(report.monitoringCost.totalMs/report.monitoringCost.samples):null;
  }
  return report;
}
els.manual.onclick=async()=>{
  if(runner)return;
  runner={stop:false};els.start.disabled=true;els.manual.disabled=true;
  els.stop.disabled=false;els.download.disabled=true;
  try{
    const win=await readyGame();
    textStatus('手玩低負擔監測已啟動。請照常操作遊戲；不會自動出牌、攻擊或重置地圖。');
    lastReport=await runManualObservation(win,runner);
    els.download.disabled=false;
    textStatus(`手玩監測結束｜${lastReport.status}
採樣 ${lastReport.samples.length} 次｜新提交 ${lastReport.totalNewCommits} 次｜失敗 ${lastReport.failedCommits} 次
監測 CPU 平均 ${lastReport.monitoringCost.meanMs??'—'}ms／次
請按「下載 JSON 報告」。`);
  }catch(error){textStatus(`手玩監測錯誤：${error?.message||error}`);}
  finally{runner=null;els.start.disabled=false;els.manual.disabled=false;els.stop.disabled=true;}
};

(async()=>{
  try{await readyGame();els.start.disabled=false;els.manual.disabled=false;textStatus('正式 Runtime 已載入。可選「自動戰局測試」或「手玩低負擔監測」。');}
  catch(error){textStatus(`無法載入正式遊戲：${error.message}`);}
})();
