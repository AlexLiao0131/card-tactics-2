const BOOT_REVISION=Date.now().toString(36);
const versioned=path=>`${path}${path.includes("?")?"&":"?"}boot=${BOOT_REVISION}`;
const load=path=>import(versioned(path));

const bootStatus=document.getElementById("bootStatus"),canvas=document.getElementById("battleCanvas");
globalThis.turnStatus=document.getElementById("turnStatus");
globalThis.skillBar=document.getElementById("skillBar");
globalThis.resetMap=document.getElementById("resetMap");
globalThis.CardTacticsBattleSetup={stageId:"versus_core_battle",mapSize:"MEDIUM"};

const CORE_LOAD_ORDER=[
  "terrain-database.js","environment-object-engine.js","map-database.js","hydrology-engine.js","mass-flow-engine.js","climate-engine.js","environment-resolver.js",
  "map-generator.js","conductivity-engine.js","environment-engine.js","stage-database.js","visual-database.js","unit-animation-engine.js",
  "skill-database.js","equipment-database.js","companion-database.js","character-database.js","card-database.js","loadout-database.js","monster-database.js",
  "item-database.js","reward-database.js","item-inventory-engine.js",
  "pack-database.js","pack-engine.js",
  "deck-engine.js","deployment-engine.js","card-phase-engine.js","battle-log.js","battle-engine.js","effect-engine.js","item-runtime-engine.js","reward-engine.js","burial-engine.js",
  "tactical-engine.js","vertical-mobility-engine.js","environment-contact-engine.js","unit-runtime-engine.js","battle-setup-engine.js","battle-presentation-controller.js",
  "tile-inspection-presentation.js","displacement-engine.js","collision-engine.js","fall-engine.js","trajectory-engine.js",
  "post-engagement-engine.js","battle-resolution.js","stage-engine.js","objective-engine.js",
  "battle-objective-controller.js","battle-core-capture-controller.js","battle-environment-controller.js",
  "encounter-reward-engine.js","death-lifecycle-engine.js","tactical-action-controller.js",
  "tactical-enemy-controller.js","card-phase-controller.js"
];

let loadingStep="啟動器";
try{
  // Start the existing diagnostics recorder before battle initialization so
  // boot failures and the first card/environment events are not lost.
  loadingStep="diagnostics.js";
  await load("./diagnostics.js");
  loadingStep="畫面模組";
  const [{BabylonRenderer},{BattleUI},{CardHandUI},{ShellUI},{UnitControlUI}]=await Promise.all([
    load("./babylon-renderer.js"),
    load("./battle-ui.js"),
    load("./card-hand-ui.js"),
    load("./shell-ui.js"),
    load("./unit-control-ui.js")
  ]);

  for(let i=0;i<CORE_LOAD_ORDER.length;i++){
    const file=CORE_LOAD_ORDER[i];
    loadingStep=file;
    bootStatus.textContent=`載入戰鬥核心 ${i+1}/${CORE_LOAD_ORDER.length}｜${file}`;
    await load(`./${file}`);
  }

  loadingStep="loadout-validation";
  LoadoutDatabase.validate();
  loadingStep="item-validation";
  ItemDatabase.validate();

  loadingStep="tactical-game.js";
  bootStatus.textContent="啟動 Card Tactics Runtime...";
  await load("./tactical-game.js");

  const runtime=globalThis.CardTacticsRuntime;
  if(!runtime)throw new Error("CardTacticsRuntime failed to initialize.");

  // Non-battle screens must not initialize WebGL, shadows, water geometry or
  // battlefield presentation. The first battle entry owns that lifecycle.
  let renderer=null;
  let localBattleUiBound=false;
  let pvp=null;
  const battleUI=new BattleUI();
  function sharedBattleRenderer(surface,snapshot){
    if(surface!==canvas)throw Error('NATIVE_BATTLE_CANVAS_REQUIRED');
    if(!renderer){
      renderer=new BabylonRenderer(canvas,snapshot,{
        onTilePicked:(x,y)=>pvp?.isBattleActive()
          ?pvp.tilePicked(x,y):runtime.clickBattleTile(x,y)
      });
      globalThis.CardTacticsRenderer=renderer;
      shell.renderer=renderer;
      enableLocalBattleUI();
      // The original BattleUI owns these handlers during offline play.  When
      // the FIRST match is online, the very same camera controls still work.
      document.getElementById('rotateLeft').onclick=()=>renderer.rotate(-1);
      document.getElementById('rotateRight').onclick=()=>renderer.rotate(1);
      document.getElementById('projectionToggle').onclick=()=>renderer.toggleProjection();
      document.getElementById('resetView').onclick=()=>renderer.resetView();
    }
    return renderer;
  }
  function enableLocalBattleUI(){
    if(localBattleUiBound)return;
    battleUI.bind(runtime,renderer);
    unitControlUI.bind(runtime);
    localBattleUiBound=true;
  }
  const cardUI=new CardHandUI();cardUI.bind(runtime);
  const shell=new ShellUI(runtime,null);
  const unitControlUI=new UnitControlUI();

  loadingStep="battle-test-console.js";
  await load("./battle-test-console.js");

  // One presentation publication owner, one snapshot per Babylon draw.
  // Game events only invalidate the presentation. Existing gameplay and
  // animation events keep their original sequence and are never throttled.
  let presentationDirty=true,lastObservedSnapshot=null;
  let signalsPending=0;
  const presentationStats={signals:0,commits:0,snapshots:0,coalescedSignals:0,
    lastSnapshotMs:0,lastAnimationMs:0,lastUiMs:0,lastSignalsPerCommit:0};
  globalThis.CardTacticsPresentation=Object.freeze({
    diagnostics:()=>({...presentationStats,pending:presentationDirty})
  });
  let focusedEngagementKey=null;
  function syncEngagementFocus(){
    const model=runtime.getEngagementPresentation?.();
    if(!model||!model.attackerId||!model.defenderId){focusedEngagementKey=null;return;}
    const key=String(model.focusId??`${model.attackerId}:${model.defenderId}:${model.skillName}`);
    if(key===focusedEngagementKey)return;
    // Only focus when combat/response is entered; do not repeatedly fight a
    // player's panning while they inspect their counter/defense choices.
    if(model.mode!=="support-select"&&!String(model.mode).startsWith("enemy-"))return;
    const points=[model.player,model.enemy].filter(Boolean).map(point=>{
      const renderUnit=(renderer.lastState?.units||[]).find(unit=>unit.id===point.id);
      return {...point,renderZ:renderUnit?.renderZ??null};
    });
    // A rejected focus must remain eligible after a resize / scene commit.
    if(renderer.camera.focusEngagement(points,key))focusedEngagementKey=key;
  }

  function publishFrame(){
    // Online presentation is authoritative and arrives only by authenticated
    // WebSocket. A local state event must never draw the offline game on top.
    if(pvp?.isBattleActive()){
      if(renderer)renderer.presentationFrameSync=null;
      return;
    }
    if(!presentationDirty){
      renderer.presentationFrameSync=null;
      return;
    }
    // Clear dirty BEFORE constructing / publishing: reentrant state changes
    // schedule their own next publication rather than being discarded.
    presentationDirty=false;
    const bundledSignals=signalsPending;
    signalsPending=0;
    try{
      const snapshotStart=performance.now();
      const snap=runtime.getBattleSnapshot();
      const snapshotMs=performance.now()-snapshotStart;
      presentationStats.snapshots++;
      presentationStats.lastSnapshotMs=Math.round(snapshotMs*100)/100;
      globalThis.CardTacticsDiagnostics?.recordPerf?.("presentation.snapshotBuild",snapshotMs);

      const animationStart=performance.now(),prev=lastObservedSnapshot;
      if(prev&&(prev.map?.id!==snap.map?.id||Number(snap.round||0)<Number(prev.round||0)))
        globalThis.UnitAnimationEngine?.clear?.();
      globalThis.UnitAnimationEngine?.observe?.(snap);
      // Explicit gameplay/animation events preserve their order. The snapshot
      // records the final drawable state; it never consumes animation history.
      const events=globalThis.UnitAnimationEngine?.drain?.()||[];
      lastObservedSnapshot=snap;
      const animationMs=performance.now()-animationStart;
      presentationStats.lastAnimationMs=Math.round(animationMs*100)/100;
      globalThis.CardTacticsDiagnostics?.recordPerf?.("presentation.animationCollect",animationMs);

      renderer.sync(snap,events);
      renderer.unitHud?.presentEvents?.(events);
      syncEngagementFocus();

      // One published immutable-in-practice view is shared by all official UIs.
      // No UI listener rebuilds the 704-tile battlefield snapshot on a second
      // synchronous game-state event.
      const uiStart=performance.now();
      window.dispatchEvent(new CustomEvent("cardtactics:presentation-published",{
        detail:{snapshot:snap}
      }));
      const uiMs=performance.now()-uiStart;
      presentationStats.lastUiMs=Math.round(uiMs*100)/100;
      presentationStats.commits++;
      presentationStats.coalescedSignals+=Math.max(0,bundledSignals-1);
      presentationStats.lastSignalsPerCommit=bundledSignals;
      globalThis.CardTacticsDiagnostics?.recordPerf?.("presentation.uiPublish",uiMs);
    }finally{
      // Never cancel an invalidation received during Babylon.sync or DOM work.
      renderer.presentationFrameSync=presentationDirty?publishFrame:null;
    }
  }

  function invalidatePresentation(){
    if(pvp?.isBattleActive())return;
    presentationStats.signals++;
    signalsPending++;
    presentationDirty=true;
    if(renderer)renderer.presentationFrameSync=publishFrame;
  }

  window.addEventListener("cardtactics:battle-render",invalidatePresentation);
  window.addEventListener("cardtactics:state",invalidatePresentation);
  window.addEventListener("cardtactics:battle-screen-enter",()=>{
    if(pvp?.isBattleActive()){
      // The server render packet will initialize the shared renderer with
      // its own canonical snapshot. Never call runtime.getBattleSnapshot().
      renderer?.resize();
      return;
    }
    try{
      loadingStep="BabylonRenderer";
      sharedBattleRenderer(canvas,runtime.getBattleSnapshot());
      enableLocalBattleUI();
      renderer.resize();
      invalidatePresentation();
    }catch(error){
      const message=String(error?.message||error);
      bootStatus.textContent=`啟動失敗｜${loadingStep}｜${message}`;
      bootStatus.style.color="#ff9b9b";
      shell.show("bootScreen");
      globalThis.CardTacticsDiagnostics?.push?.("BOOT_FAILURE",
        {step:loadingStep,name:error?.name||"Error",message});
      console.error("Card Tactics battle startup failed",error);
    }
  });
  // Wire screen events before exposing the title screen to clicks. The first
  // battle creates WebGL only when the already-registered event fires.
  loadingStep="shell-ui";
  shell.bind();
  loadingStep="原生 PVP 房間協調器";
  const {PvpLobbyController}=await load('./pvp-lobby.js');
  pvp=new PvpLobbyController({shell,createSharedRenderer:sharedBattleRenderer,cardUI,battleUI,unitControlUI});
  globalThis.CardTacticsPvpInput=Object.freeze({
    nextUnit:()=>pvp?.tacticalUI?.nextUnit(),
    endPhase:()=>pvp?.tacticalUI?.endPhase(),
    rotateFacing:steps=>pvp?.tacticalUI?.rotateFacing(steps),
    adjustAltitude:steps=>pvp?.tacticalUI?.adjustAltitude(steps)
  });
  // PvP before any local game still uses the SAME native turn controls.
  document.getElementById('endTurn').onclick=()=>pvp?.isBattleActive()
    ?pvp.tacticalUI?.endPhase():runtime.endPlayerTurn();
  document.getElementById('nextUnit').onclick=()=>pvp?.isBattleActive()
    ?pvp.tacticalUI?.nextUnit():runtime.selectNextAvailableUnit?.();
  shell.attachPvp(pvp);
  pvp.bind();
  // Before the first battle, there is no scene and nothing to publish.
  // Next updates are consumed by Babylon just before its scene render.
}catch(error){
  const name=error?.name||"Error",message=error?.message||String(error);
  if(bootStatus){
    bootStatus.textContent=`啟動失敗｜${loadingStep}｜${name}: ${message}`;
    bootStatus.style.color="#ff9b9b";
    bootStatus.style.whiteSpace="normal";
    bootStatus.style.overflowWrap="anywhere";
  }
  globalThis.CardTacticsDiagnostics?.push?.("BOOT_FAILURE",{step:loadingStep,name,message});
  console.error("Card Tactics boot failed",{step:loadingStep,error});
  throw error;
}
