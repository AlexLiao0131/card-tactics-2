import { BabylonRenderer } from "./babylon-renderer.js";
import { BattleUI } from "./battle-ui.js";

const CORE_LOAD_ORDER=[
  "terrain-database.js","map-database.js","hydrology-engine.js","climate-engine.js","environment-resolver.js",
  "map-generator.js","conductivity-engine.js","environment-engine.js","stage-database.js","visual-database.js",
  "skill-database.js","equipment-database.js","character-database.js","card-database.js","monster-database.js",
  "monster-content.js","ophi-content.js","church-content.js","seraphina-content.js","pack-database.js","pack-engine.js",
  "deck-engine.js","deployment-engine.js","card-phase-engine.js","battle-log.js","battle-engine.js","effect-engine.js",
  "tactical-engine.js","unit-runtime-engine.js","battle-setup-engine.js","battle-presentation-controller.js",
  "tile-inspection-presentation.js","displacement-engine.js","collision-engine.js","fall-engine.js","trajectory-engine.js",
  "post-engagement-engine.js","battle-resolution.js","stage-engine.js","objective-engine.js",
  "battle-objective-controller.js","battle-core-capture-controller.js","battle-environment-controller.js",
  "encounter-reward-engine.js","death-lifecycle-engine.js","tactical-action-controller.js",
  "tactical-enemy-controller.js","card-phase-controller.js"
];

const screens=[...document.querySelectorAll(".game-screen")];
const show=id=>screens.forEach(screen=>screen.classList.toggle("active",screen.id===id));
const bootStatus=document.getElementById("bootStatus");
const canvas=document.getElementById("battleCanvas");

globalThis.turnStatus=document.getElementById("turnStatus");
globalThis.skillBar=document.getElementById("skillBar");
globalThis.resetMap=document.getElementById("resetMap");
globalThis.CardTacticsBattleSetup={stageId:"versus_core_battle",mapSize:"MEDIUM"};

async function loadCore(){
  for(let i=0;i<CORE_LOAD_ORDER.length;i++){
    const file=CORE_LOAD_ORDER[i];
    bootStatus.textContent=`載入戰鬥核心 ${i+1}/${CORE_LOAD_ORDER.length}｜${file}`;
    await import(`./${file}`);
  }
  bootStatus.textContent="啟動 1.0 Runtime orchestration...";
  await import("./tactical-game.js");
}

function bindShell(renderer,ui){
  document.getElementById("pressStart").onclick=()=>show("menuScreen");
  document.getElementById("menuVersus").onclick=()=>show("versusScreen");
  document.querySelectorAll("[data-back]").forEach(btn=>btn.onclick=()=>show(btn.dataset.back));
  document.getElementById("battleBack").onclick=()=>show("menuScreen");
  document.getElementById("rotateLeft").onclick=()=>{renderer.cameraQuarterTurns=((renderer.cameraQuarterTurns??0)-1+4)%4;syncRenderer(renderer)};
  document.getElementById("rotateRight").onclick=()=>{renderer.cameraQuarterTurns=((renderer.cameraQuarterTurns??0)+1)%4;syncRenderer(renderer)};
  document.getElementById("versusStart").onclick=()=>{
    const size=document.getElementById("versusMapSize").value;
    const raw=document.getElementById("versusSeed").value.trim();
    const seed=raw===""?undefined:(Number(raw)>>>0);
    globalThis.CardTacticsBattleSetup={stageId:"versus_core_battle",mapSize:size,...(seed==null?{}:{seed})};
    globalThis.CardTacticsRuntime.resetBattle();
    renderer.cameraQuarterTurns=0;
    show("battleScreen");
    requestAnimationFrame(()=>{renderer.engine.resize();syncRenderer(renderer);ui.render()});
  };
}

function syncRenderer(renderer){
  const snapshot=globalThis.CardTacticsRuntime?.getBattleSnapshot?.();if(!snapshot)return;
  snapshot.cameraQuarterTurns=renderer.cameraQuarterTurns??0;
  renderer.sync(snapshot);
  document.getElementById("versusMeta").textContent=snapshot?.map?`目前 Runtime：${snapshot.map.width}×${snapshot.map.height}`:"";
}

await loadCore();
const runtime=globalThis.CardTacticsRuntime;
if(!runtime)throw new Error("CardTacticsRuntime failed to initialize.");

const initial=runtime.getBattleSnapshot();
const renderer=new BabylonRenderer(canvas,{...initial,cameraQuarterTurns:0},{onTilePicked(x,y){
  runtime.clickBattleTile(x,y);
}});
renderer.cameraQuarterTurns=0;
const ui=new BattleUI();
ui.bind(runtime);

window.addEventListener("cardtactics:battle-render",()=>syncRenderer(renderer));
window.addEventListener("cardtactics:state",()=>syncRenderer(renderer));

bindShell(renderer,ui);
syncRenderer(renderer);
show("titleScreen");
