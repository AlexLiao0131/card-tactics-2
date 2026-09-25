function q(id){return document.getElementById(id)}
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

export class BattleUI{
  constructor(){
    this.runtime=null;this.renderer=null;
    this.logPanel=q("battleLog");this.logShell=q("battleLogShell");this.inspect=q("inspectionPanel");this.unitHud=q("battleUnitHud");
    this.endTurn=q("endTurn");this.mapMeta=q("mapMeta");
  }
  bind(runtime,renderer){
    this.runtime=runtime;this.renderer=renderer;
    this.endTurn.onclick=()=>runtime.endPlayerTurn();
    q("rotateLeft").onclick=()=>renderer.rotate(-1);q("rotateRight").onclick=()=>renderer.rotate(1);
    q("projectionToggle").onclick=()=>renderer.toggleProjection();q("resetView").onclick=()=>renderer.resetView();
    q("logToggle").onclick=()=>this.logShell.classList.toggle("active");q("logClose").onclick=()=>this.logShell.classList.remove("active");
    q("unitHudClose").onclick=()=>this.unitHud.classList.remove("visible");
    window.addEventListener("cardtactics:view-change",()=>this.renderView());
    window.addEventListener("cardtactics:battle-render",()=>this.render());
    window.addEventListener("cardtactics:state",()=>this.render());
    window.addEventListener("cardtactics:log",()=>this.renderLog());
    window.addEventListener("cardtactics:inspection",()=>this.renderInspection());
    this.render();
  }
  render(){
    if(!this.runtime)return;
    const snapshot=this.runtime.getBattleSnapshot(),stage=this.runtime.getStage(),cores=this.runtime.getCores(),phase=this.runtime.getPhase();
    const p=cores.find(c=>c.owner==="PLAYER"),e=cores.find(c=>c.owner==="ENEMY");
    q("playerCoreHp").textContent=p?`${p.hp}/${p.maxHp}`:"—";q("enemyCoreHp").textContent=e?`${e.hp}/${e.maxHp}`:"—";
    q("playerCoreBar").style.width=p?`${Math.max(0,Math.min(100,p.hp/Math.max(1,p.maxHp)*100))}%`:"0%";
    q("enemyCoreBar").style.width=e?`${Math.max(0,Math.min(100,e.hp/Math.max(1,e.maxHp)*100))}%`:"0%";
    const pts=(stage?.deploymentPoints||[]).filter(x=>x.capturable!==false);
    q("captureSummary").textContent=pts.map(x=>`${x.owner==="PLAYER"?"◆":x.owner==="ENEMY"?"◇":"○"}${x.name}`).join("　");
    this.mapMeta.textContent=[snapshot?.map?`${snapshot.map.width}×${snapshot.map.height}`:"",stage?.generatedBattlefield?.seed!=null?`Seed ${stage.generatedBattlefield.seed}`:""].filter(Boolean).join(" ｜ ");
    this.endTurn.disabled=phase!=="PLAYER_TURN";
    this.renderView();this.renderInspection();this.renderLog();this.renderEngagement();
  }
  renderView(){
    const state=this.renderer?.getViewState?.();if(!state)return;
    q("projectionToggle").textContent=state.projection==="ISO"?"正視圖":"45°視角";
  }
  renderInspection(){
    const unit=this.runtime?.getInspectedUnitPresentation?.(),tile=this.runtime?.getInspectedTilePresentation?.();
    if(!unit&&!tile)return;
    if(unit){
      this.inspect.textContent=[
        `${unit.name}｜${unit.team}`,`HP ${unit.hp}/${unit.maxHp}｜MP ${unit.mana}/${unit.maxMana}`,
        `ATK ${unit.stats?.atk}　MATK ${unit.stats?.matk}　DEF ${unit.stats?.def}　MDEF ${unit.stats?.mdef}`,
        `MOVE ${unit.move}｜${unit.actionState}`,tile?.summary||""
      ].filter(Boolean).join("\n");
    }else this.inspect.textContent=[tile?.summary,...(tile?.details||[])].filter(Boolean).join("\n");
    this.unitHud.classList.add("visible");
  }
  renderLog(){
    const model=this.runtime?.getBattleLog?.();if(!model)return;
    this.logPanel.innerHTML=(model.entries||[]).slice(-50).reverse().map(e=>`<div class="log-row ${esc(e.type)}">${esc(e.text)}</div>`).join("");
  }
  renderEngagement(){
    const model=this.runtime?.getEngagementPresentation?.();if(!model?.actions?.length)return;
    const bar=q("skillBar");bar.innerHTML="";
    const title=document.createElement("strong");title.textContent=model.skillName||"交戰";bar.appendChild(title);
    for(const action of model.actions){const b=document.createElement("button");b.textContent=action.label;b.disabled=!!action.disabled;b.onclick=()=>this.runtime.handleEngagementUIAction(action.id,action.payload||{});bar.appendChild(b)}
  }
}
