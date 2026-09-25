(()=>{
"use strict";
const battle=document.getElementById("battleScreen");
if(!battle)return;
let box=null,projectionButton=null;
function api(){return window.CardTacticsBattleView||null}
function sync(){
  const state=api()?.getViewState?.();
  if(projectionButton&&state)projectionButton.textContent=state.projection==="ISO"?"正視圖":"45°視角";
}
function ensure(){
  if(box)return box;
  box=document.getElementById("battleViewControls");
  if(!box){
    box=document.createElement("div");
    box.id="battleViewControls";
    box.className="battle-view-controls";
    battle.querySelector("main")?.appendChild(box);
  }
  const back=document.getElementById("battleBack");
  if(back&&back.parentElement!==box){back.textContent="← 主選單";box.appendChild(back)}
  const left=document.createElement("button"),right=document.createElement("button");
  projectionButton=document.createElement("button");
  left.type=right.type=projectionButton.type="button";
  left.textContent="↺";right.textContent="↻";projectionButton.id="projectionToggle";
  left.addEventListener("click",()=>api()?.rotate?.(-1));
  right.addEventListener("click",()=>api()?.rotate?.(1));
  projectionButton.addEventListener("click",()=>{
    const state=api()?.getViewState?.();if(!state)return;
    api().setProjection?.(state.projection==="ISO"?"TOP":"ISO");
  });
  box.append(left,projectionButton,right);sync();return box;
}
window.addEventListener("cardtactics:view-change",sync);
new MutationObserver(()=>{if(battle.classList.contains("active")){ensure();sync();}}).observe(battle,{attributes:true,attributeFilter:["class"]});
ensure();
})();
