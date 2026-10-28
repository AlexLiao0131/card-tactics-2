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
#ct-bench-control.collapsed #fields,#ct-bench-control.collapsed #controls,#ct-bench-control.collapsed #instructions{display:none}
#ct-bench-control #instructions{font-size:10px;line-height:1.4;color:#aac5d8;margin-top:5px}
@media(max-width:540px){#ct-bench-control{max-width:calc(100vw - 24px)}#ct-bench-control #fields{margin:5px 0}}
`;
const style=document.createElement('style');style.textContent=OVERLAY_STYLE;document.head.appendChild(style);
const panel=document.createElement('aside');panel.id='ct-bench-control';panel.setAttribute('aria-label','正式戰局壓測工具');
panel.innerHTML=`<header><span>Card Tactics｜正式戰局自動測試</span><button id="toggle" type="button">收合</button></header>
<div id="fields"><label>Seed <input id="seed" value="4138639676" inputmode="numeric"></label><label>地圖 <select id="size"><option>SMALL</option><option selected>MEDIUM</option><option>LARGE</option><option>XLARGE</option></select></label><label>回合上限 <input id="rounds" value="12" type="number" min="1" max="60"></label><label>場景 <select id="scenario"><option value="SCENARIO">完整戰局＋極端氣候</option><option value="NATURAL">完整自然戰局</option></select></label></div>
<div id="controls"><button id="start" type="button" disabled>一鍵正式戰局壓測</button><button id="stop" type="button" disabled>停止</button><button id="download" type="button" disabled>下載 JSON 報告</button></div>
<div id="instructions">直接在正式 index.html、正式 AI 和同一個 BabylonRenderer 上測試。測試期間請勿切至背景。</div>
<pre id="status">等待正式遊戲載入中…</pre>`;
document.body.appendChild(panel);
const $=id=>panel.querySelector('#'+id);
const els={start:$('start'),stop:$('stop'),download:$('download'),status:$('status'),seed:$('seed'),size:$('size'),rounds:$('rounds'),scenario:$('scenario')};
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
els.download.onclick=()=>{if(lastReport)downloadJson(`Card_Tactics_2_FullBattleBenchmark_${lastReport.setup.seed}_${Date.now()}.json`,lastReport);};

async function readyGame(){
  for(let i=0;i<400;i++){
    const win=window;
    try{if(win?.CardTacticsRuntime?.getBattleSnapshot&&win?.CardTacticsRenderer?.scene&&win?.CardDatabase&&win?.TacticalEngine)return win;}catch(_){/* navigating */}
    await sleep(100);
  }
  throw new Error('正式 Runtime / Babylon Renderer 未在啟動期限內載入');
}

/** Owns a bounded set of samples collected from the EXISTING Babylon scene clock. */
class FrameCapture{
  constructor(win,report){
    this.win=win;this.report=report;this.windowStart=performance.now();this.previousTime=null;
    this.interval=[];this.cpu=[];this.render=[];this.shadow=[];this.windowPhase='BOOT';this.windowRound=1;
    this.initialFrames=0;
    this.disposed=false;
    this.observer=win.CardTacticsRenderer.scene.onAfterRenderObservable.add(()=>this.sample());
  }
  sample(){
    if(this.disposed||document.hidden||this.win.document.hidden){this.previousTime=null;return;}
    const now=performance.now(),perf=this.win.CardTacticsRenderer.performanceStats||{};
    const phase=this.win.CardTacticsRuntime.getPhase?.()||'UNKNOWN';
    const round=Number(this.win.CardTacticsRenderer.lastState?.round||0);
    if(phase!==this.windowPhase||round!==this.windowRound){this.flush();this.windowPhase=phase;this.windowRound=round;this.previousTime=null;}
    if(this.previousTime!==null&&now-this.previousTime<2000)this.interval.push(now-this.previousTime);
    this.previousTime=now;
    if(Number.isFinite(perf.frameMs))this.cpu.push(perf.frameMs);
    if(Number.isFinite(perf.renderMs))this.render.push(perf.renderMs);
    if(Number.isFinite(perf.shadowPassCpuMs))this.shadow.push(perf.shadowPassCpuMs);
    if(now-this.windowStart>=5000)this.flush();
  }
  flush(){
    if(!this.interval.length&&!this.cpu.length){this.windowStart=performance.now();return;}
    const win=this.win,renderer=win.CardTacticsRenderer;
    const metrics=renderer.diagnostics?.();
    this.report.windows.push({atMs:round2(performance.now()-this.report.startedAtMonotonic),round:this.windowRound,
      phase:this.windowPhase,frameIntervalMs:metricSet(this.interval),cpuFrameMs:metricSet(this.cpu),
      sceneRenderCpuMs:metricSet(this.render),shadowSubmissionCpuMs:metricSet(this.shadow),
      drawCallsPerFrame:metrics?.performance?.drawCallsPerFrame??null,
      meshes:renderer.scene.meshes.length,activeMeshes:renderer.scene.getActiveMeshes?.()?.length??null,
      shadowsCasters:metrics?.shadows?.casters??null,
      rendererErrors:metrics?.rendererErrors||{},weather:win.CardTacticsRuntime.debug?.state?.()?.weather||null});
    this.interval.length=0;this.cpu.length=0;this.render.length=0;this.shadow.length=0;this.windowStart=performance.now();
  }
  dispose(){if(this.disposed)return;this.flush();this.disposed=true;this.win.CardTacticsRenderer.scene.onAfterRenderObservable.remove(this.observer);}
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
    ||actions.find(a=>a.id==='GUARD_ACCEPT')
    ||actions.find(a=>a.id==='SUPPORT_NONE')
    ||actions.find(a=>a.id==='BACK_SUPPORT');
  if(!chosen)return false;
  runtime.handleEngagementUIAction(chosen.id,chosen.payload||{});
  report.actions.REACTION++;
  return true;
}

async function attemptAttack(win,report,abort){
  const runtime=win.CardTacticsRuntime,doc=win.document;
  if(!clickBtn(findButton(doc,/^攻擊$/)))return false;
  const skills=actionButtons(doc).filter(b=>/射程/.test(b.textContent||''));
  for(const skill of skills){
    if(abort.stop)return false;
    skill.click();
    let snap=runtime.getBattleSnapshot();
    if(snap.mode==='variant-menu'){
      const variant=actionButtons(doc).find(b=>!/返回|關閉/.test(b.textContent||''));
      if(variant){variant.click();snap=runtime.getBattleSnapshot();}
    }
    const enemyTiles=(snap.map?.tiles||[]).filter(t=>t.attackable&&(
      snap.units?.some(u=>u.team==='ENEMY'&&u.x===t.x&&u.y===t.y)||
      t.core?.owner==='ENEMY'));
    if(enemyTiles.length){
      const target=enemyTiles[0];
      runtime.clickBattleTile(target.x,target.y);
      report.actions.ATTACK_TARGET++;
      await sleep(200);
      resolveEngagement(win,report);
      return true;
    }
    // No legal attack target. Re-select the actor to restore the command menu.
    const selected=snap.units?.find(u=>u.selected===true);
    if(selected)runtime.clickBattleTile(selected.x,selected.y);
    const back=findButton(doc,/返回|取消施放/);
    if(back)back.click();
    if(runtime.getBattleSnapshot().mode!=='command')break;
    if(!clickBtn(findButton(doc,/^攻擊$/)))break;
  }
  return false;
}

async function playerAction(win,report,abort){
  const runtime=win.CardTacticsRuntime,doc=win.document;
  if(resolveEngagement(win,report))return;
  // The official selector excludes companions and other non-participating units.
  // Do not infer turn eligibility from the visual snapshot alone.
  const hasActor=runtime.selectNextAvailableUnit?.();
  const snapBefore=runtime.getBattleSnapshot();
  const selected=(snapBefore.units||[]).find(u=>u.team==='PLAYER'&&u.selected===true&&u.acted===false);
  if(!hasActor||!selected){
    if(runtime.endPlayerTurn())report.actions.TURN_END++;
    else report.warnings.push('PLAYER_END_REJECTED');
    return;
  }
  runtime.clickBattleTile(selected.x,selected.y);
  await sleep(120);
  if(win.CardTacticsRuntime.getPhase()!=='PLAYER_TURN')return;
  if(clickBtn(findButton(doc,/^佔領/))){report.actions.CAPTURE++;return;}
  if(await attemptAttack(win,report,abort))return;
  // Restore the command mode and move via the same reachable tiles used by manual play.
  runtime.clickBattleTile(selected.x,selected.y);
  const snap=runtime.getBattleSnapshot();
  const reachable=(snap.map?.tiles||[]).filter(t=>t.reachable&&(t.x!==selected.x||t.y!==selected.y));
  const destination=nearest(reachable,targets(snap));
  if(destination&&runtime.getPhase()==='PLAYER_TURN'){
    runtime.clickBattleTile(destination.x,destination.y);
    report.actions.MOVE++;
    await sleep(180);
  }
  if(runtime.getPhase()!=='PLAYER_TURN')return;
  const after=runtime.getBattleSnapshot();
  const actor=after.units?.find(u=>u.id===selected.id);
  if(actor){
    runtime.clickBattleTile(actor.x,actor.y);
    if(clickBtn(findButton(doc,/^佔領/))){report.actions.CAPTURE++;return;}
    if(await attemptAttack(win,report,abort))return;
    runtime.clickBattleTile(actor.x,actor.y);
  }
  if(clickBtn(findButton(doc,/^待機$/))){report.actions.WAIT++;return;}
  // End turn is a public legal user action. Never directly mark units acted.
  report.warnings.push(`ACTOR_ACTION_UNAVAILABLE:${selected.id}`);
  if(runtime.getPhase()==='PLAYER_TURN'&&runtime.endPlayerTurn())report.actions.TURN_END++;
}

// Controlled baseline-isolate-baseline-isolate measurements in a paused but
// fully-rendering real battle scene. Isolate only via Babylon's supported
// refresh/start/stop interfaces and restore every original state in finally.
async function measureStaticPass(win,label,abort){
  const scene=win.CardTacticsRenderer.scene,renderer=win.CardTacticsRenderer;
  const intervals=[],render=[],frameCpu=[];let previous=null;
  const capture=scene.onAfterRenderObservable.add(()=>{
    if(abort.stop||document.hidden)return;
    const now=performance.now();
    if(previous!=null&&now-previous<2000)intervals.push(now-previous);
    previous=now;
    const stats=renderer.performanceStats||{};
    if(Number.isFinite(stats.renderMs))render.push(stats.renderMs);
    if(Number.isFinite(stats.frameMs))frameCpu.push(stats.frameMs);
  });
  try{await sleep(3000);}
  finally{scene.onAfterRenderObservable.remove(capture);}
  return{label,frameIntervalMs:metricSet(intervals),renderCpuMs:metricSet(render),frameCpuMs:metricSet(frameCpu)};
}
async function staticAB(win,report,abort,label='INITIAL'){
  const runtime=win.CardTacticsRuntime,renderer=win.CardTacticsRenderer;
  const revision=runtime.getBattleSnapshot().revision;
  const output={label,sourceRevision:revision,mode:'PAUSED_REAL_BATTLE_SCENE',trials:[],status:'RUNNING',
    notCovered:['TREE_WIND_CPU','GRASS_WIND_CPU','WATER_RENDER'],
    note:'Only SHADOW_REPAINT and ACTIVE_WEATHER_PARTICLES are isolated by stable Babylon controls. Not a full A-F attribution.'};
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
      results.every(x=>x.frameIntervalMs.count>0),
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
    errors:perf?.rendererErrors||{}});
}

async function runBenchmark(win,setup,abort){
  const runtime=win.CardTacticsRuntime,doc=win.document;
  const report={kind:'CARD_TACTICS_2_FORMAL_BATTLE_AUTO_BENCHMARK',version:1,reviewedSourceHead:'94376c9834e9a944a95d1d08d708378e77c20929',servedCodeHead:'NOT_VERIFIED_IN_BROWSER',
    generatedAt:null,startedAt:new Date().toISOString(),startedAtMonotonic:performance.now(),
    setup:{...setup},scenarioInjections:[],engine:'REAL_INDEX_HTML_TOP_LEVEL',gameplayPath:'OFFICIAL_RUNTIME_AND_AI',
    limitation:'The shipped index.html is loaded into the top-level document. No GPU time or temperature is inferred. No A/B isolation has yet been performed.',
    status:'RUNNING',actions:{CARD_SELECT:0,CARD_RESOLVED:0,CARD_END:0,MOVE:0,ATTACK_TARGET:0,CAPTURE:0,WAIT:0,REACTION:0,TURN_END:0},
    checkpoints:[],windows:[],warnings:[],errors:[],completedRounds:0,coverage:{weather:[],timeOfDay:[],rounds:0,battleActions:0}};
  const capture=new FrameCapture(win,report);
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
    reportCheckpoint(win,report,'START');
    await sleep(1500);
    textStatus('正在做正式場景影格 A/B 對照（陰影、目前啟動的粒子）；不推進遊戲。');
    await staticAB(win,report,abort,'INITIAL_FULL_GAME');
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
          else if(weather==='BLIZZARD'){
            await sleep(1500);
            textStatus('完整戰局暴風雪場景｜執行第二組 A/B 影格測試，保留正式水文與 AI 狀態。');
            await staticAB(win,report,abort,'BLIZZARD_FULL_GAME');
          }
        }else report.warnings.push(`MISSING_MASTER_WEATHER_DURATION:${weather}`);
      }
      const progress=`${round}:${phase}:${snap.mode}:${snap.revision}:${report.actions.CARD_RESOLVED}:${report.actions.MOVE}:${report.actions.WAIT}:${report.actions.REACTION}`;
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
        textStatus(`正式戰局進行中｜Round ${round}/${setup.maxRounds}\n${phase}｜${snap.presentation?.environment?.weather||'—'}\n出牌 ${report.actions.CARD_RESOLVED}／移動 ${report.actions.MOVE}／攻擊 ${report.actions.ATTACK_TARGET}／佔點 ${report.actions.CAPTURE}\nFPS量測視窗 ${report.windows.length} 筆｜可隨時停止`);
      }
      if(loopCount%15===0)reportCheckpoint(win,report,`SAMPLE_${round}`);
      await sleep(250);
    }
    if(abort.stop)report.status='STOPPED_BY_USER';
  }catch(error){report.status='ERROR';report.errors.push(String(error?.stack||error));}
  finally{
    capture.dispose();reportCheckpoint(win,report,'FINAL');
    report.generatedAt=new Date().toISOString();report.durationMs=round2(performance.now()-report.startedAtMonotonic);
    report.coverage.weather=[...seenWeather];report.coverage.timeOfDay=[...seenDay];report.coverage.rounds=report.completedRounds;
    report.coverage.battleActions=report.actions.MOVE+report.actions.ATTACK_TARGET+report.actions.CAPTURE;
    if(report.actions.CARD_RESOLVED===0)report.warnings.push('NO_CARD_RESOLVED');
    if(report.actions.WAIT>0&&report.actions.ATTACK_TARGET===0)report.warnings.push('PASSIVE_PLAYER_BOT_NO_ATTACK_YET');
    report.attributionStatus='NOT_PROVEN_NO_CONTROLLED_AB_ISOLATION';
    if(report.actions.ATTACK_TARGET===0)report.warnings.push('NO_PLAYER_ATTACK_COVERAGE');
    if(report.actions.CAPTURE===0)report.warnings.push('NO_CAPTURE_COVERAGE');
    if(!seenWeather.has('BLIZZARD'))report.warnings.push('BLIZZARD_NOT_COVERED_BY_NATURAL_GAMEPLAY');
    delete report.startedAtMonotonic;
  }
  return report;
}

els.start.onclick=async()=>{
  if(runner)return;
  const maxRounds=Math.max(1,Math.min(60,Math.floor(Number(els.rounds.value)||12)));
  const seed=String(els.seed.value||'4138639676').trim(),mapSize=els.size.value,scenario=els.scenario.value;
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(seed)){textStatus('Seed 僅接受英數字、底線、連字號。');return;}
  runner={stop:false};els.start.disabled=true;els.stop.disabled=false;els.download.disabled=true;
  try{
    const win=await readyGame();
    lastReport=await runBenchmark(win,{seed,mapSize,maxRounds,scenario},runner);
    els.download.disabled=false;
    // Attempt automatic report export. iOS Safari may require a separate user
    // gesture, so the download button stays enabled as an explicit fallback.
    try{downloadJson(`Card_Tactics_2_FullBattleBenchmark_${lastReport.setup.seed}_${Date.now()}.json`,lastReport);}
    catch(error){lastReport.warnings.push(`AUTO_EXPORT_DENIED:${String(error?.message||error)}`);}
    textStatus(`測試結束｜${lastReport.status}\n已完成回合 ${lastReport.completedRounds}｜量測視窗 ${lastReport.windows.length}\n出牌 ${lastReport.actions.CARD_RESOLVED}、移動 ${lastReport.actions.MOVE}、攻擊 ${lastReport.actions.ATTACK_TARGET}、佔點 ${lastReport.actions.CAPTURE}\n警示 ${lastReport.warnings.length}｜已嘗試自動輸出；若手機未下載，請點「下載 JSON 報告」。`);
  }catch(error){textStatus(`測試啟動失敗：${error?.message||error}`);}
  finally{runner=null;els.start.disabled=false;els.stop.disabled=true;}
};
(async()=>{
  try{await readyGame();els.start.disabled=false;textStatus('正式 Runtime 已載入；按「一鍵正式戰局壓測」即可開始。');}
  catch(error){textStatus(`無法載入正式遊戲：${error.message}`);}
})();
