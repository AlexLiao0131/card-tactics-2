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

  loadingStep="BabylonRenderer";
  const renderer=new BabylonRenderer(canvas,runtime.getBattleSnapshot(),{onTilePicked:(x,y)=>runtime.clickBattleTile(x,y)});
  globalThis.CardTacticsRenderer=renderer;

  const battleUI=new BattleUI();battleUI.bind(runtime,renderer);
  const cardUI=new CardHandUI();cardUI.bind(runtime);
  const shell=new ShellUI(runtime,renderer);shell.bind();
  const unitControlUI=new UnitControlUI();unitControlUI.bind(runtime);

  loadingStep="battle-test-console.js";
  await load("./battle-test-console.js");

  // Battle state and Babylon presentation have ONE render frame owner. Collect
  // every animation delta on the existing runtime events, then commit the latest
  // snapshot immediately before Babylon draws that frame. No second RAF path.
  let pendingSnapshot=null,pendingAnimationEvents=[],lastObservedSnapshot=renderer.lastState;
  let focusedEngagementKey=null;
  function syncEngagementFocus(){
    const model=runtime.getEngagementPresentation?.();
    if(!model||!model.attackerId||!model.defenderId){focusedEngagementKey=null;return;}
    const key=`${model.attackerId}:${model.defenderId}:${model.skillName}`;
    if(key===focusedEngagementKey)return;
    // Only focus when combat/response is entered; do not repeatedly fight a
    // player's panning while they inspect their counter/defense choices.
    if(model.mode!=="support-select"&&!String(model.mode).startsWith("enemy-"))return;
    focusedEngagementKey=key;
    renderer.camera.focusEngagement?.([model.player,model.enemy].filter(Boolean));
  }

  function observeSnapshot(){
    const snap=runtime.getBattleSnapshot(),prev=lastObservedSnapshot;
    if(prev&&(prev.map?.id!==snap.map?.id||Number(snap.round||0)<Number(prev.round||0)))globalThis.UnitAnimationEngine?.clear?.();
    globalThis.UnitAnimationEngine?.observe?.(snap);
    const events=globalThis.UnitAnimationEngine?.drain?.()||[];
    if(events.length)pendingAnimationEvents.push(...events);
    pendingSnapshot=snap;
    lastObservedSnapshot=snap;
    return snap;
  }

  function flushSync(){
    if(!pendingSnapshot){renderer.presentationFrameSync=null;return;}
    const snap=pendingSnapshot,events=pendingAnimationEvents;
    pendingSnapshot=null;pendingAnimationEvents=[];
    // Release the on-demand callback only if no new snapshot arrived during
    // publication. That preserves reentrant runtime events without another RAF.
    try{renderer.sync(snap,events);renderer.unitHud?.presentEvents?.(events);syncEngagementFocus();battleUI.render();}
    finally{if(!pendingSnapshot)renderer.presentationFrameSync=null;}
  }

  function scheduleSync(){
    observeSnapshot();
    renderer.presentationFrameSync=flushSync;
  }

  window.addEventListener("cardtactics:battle-render",scheduleSync);
  window.addEventListener("cardtactics:state",scheduleSync);
  window.addEventListener("cardtactics:battle-screen-enter",()=>{renderer.resize();scheduleSync()});
  observeSnapshot();
  flushSync();
  // Future snapshots are consumed by the scene-render loop before its shadow
  // and colour passes, using the same DOM and geometry publication event.
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
