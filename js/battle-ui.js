function q(id){return document.getElementById(id)}
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
const OWNER_LABEL={PLAYER:"我方",ENEMY:"敵方",NEUTRAL:"中立"};

export class BattleUI{
  constructor(){
    this.runtime=null;this.renderer=null;this.contextTab="UNIT";
    this.context=q("battleContextInspector");this.mapShell=q("mapInfoShell");this.logShell=q("battleLogShell");
    this.logPanel=q("battleLog");this.logTabs=q("battleLogTabs");this.endTurn=q("endTurn");
  }

  bind(runtime,renderer){
    this.runtime=runtime;this.renderer=renderer;
    this.endTurn.onclick=()=>runtime.endPlayerTurn();
    q("rotateLeft").onclick=()=>renderer.rotate(-1);
    q("rotateRight").onclick=()=>renderer.rotate(1);
    q("projectionToggle").onclick=()=>renderer.toggleProjection();
    q("resetView").onclick=()=>renderer.resetView();

    q("infoToggle").onclick=()=>this.toggleContext();
    q("contextClose").onclick=()=>this.setContextOpen(false);
    q("contextUnitTab").onclick=()=>this.setContextTab("UNIT");
    q("contextTileTab").onclick=()=>this.setContextTab("TILE");

    q("mapToggle").onclick=()=>this.togglePanel(this.mapShell,"open");
    q("mapClose").onclick=()=>this.mapShell.classList.remove("open");

    q("hudToggle").onclick=()=>{
      const hud=q("versusCoreHud");
      if(!hud.classList.contains("available"))return;
      const open=hud.classList.toggle("open");
      q("hudToggle").classList.toggle("active",open);
    };

    this.logTabs?.querySelectorAll("[data-log-type]").forEach(button=>{
      button.onclick=()=>{
        this.runtime?.setBattleLogTab?.(button.dataset.logType);
        this.renderLog();
      };
    });

    q("logToggle").onclick=()=>{this.togglePanel(this.logShell,"active");this.renderLog();};
    q("logClose").onclick=()=>this.logShell.classList.remove("active");

    window.TacticalUIController=Object.freeze({
      renderEngagement:()=>this.renderEngagement(),
      openInspector:(tab=null)=>{if(tab)this.contextTab=tab;this.setContextOpen(true)},
      closeInspector:()=>this.setContextOpen(false),
      toggleInspector:()=>this.toggleContext()
    });
    window.TileInspectionUI=Object.freeze({
      open:()=>window.TacticalUIController.openInspector("TILE"),
      close:()=>window.TacticalUIController.closeInspector()
    });

    window.addEventListener("cardtactics:view-change",()=>this.renderView());
    window.addEventListener("cardtactics:battle-render",()=>this.render());
    window.addEventListener("cardtactics:state",()=>this.render());
    window.addEventListener("cardtactics:log",()=>this.renderLog());
    window.addEventListener("cardtactics:inspection",()=>this.renderContext());

    this.render();
  }

  togglePanel(panel,cls){
    const open=panel.classList.toggle(cls);
    if(open){
      if(panel!==this.context)this.context.classList.remove("open");
      if(panel!==this.mapShell)this.mapShell.classList.remove("open");
      if(panel!==this.logShell)this.logShell.classList.remove("active");
      q("versusCoreHud")?.classList.remove("open");
      q("hudToggle")?.classList.remove("active");
    }
  }

  render(){
    if(!this.runtime)return;
    const snapshot=this.runtime.getBattleSnapshot(),stage=this.runtime.getStage(),cores=this.runtime.getCores(),phase=this.runtime.getPhase();
    const player=cores.find(c=>c.owner==="PLAYER"),enemy=cores.find(c=>c.owner==="ENEMY");
    const coreHud=q("versusCoreHud"),hasCores=!!player||!!enemy;
    coreHud.classList.toggle("available",hasCores);
    coreHud.setAttribute("aria-hidden",String(!hasCores));
    q("hudToggle").disabled=!hasCores;
    if(!hasCores){coreHud.classList.remove("open");q("hudToggle").classList.remove("active");}
    q("playerCoreHp").textContent=player?`${player.hp}/${player.maxHp}`:"—";
    q("enemyCoreHp").textContent=enemy?`${enemy.hp}/${enemy.maxHp}`:"—";
    q("playerCoreBar").style.width=player?`${Math.max(0,Math.min(100,player.hp/Math.max(1,player.maxHp)*100))}%`:"0%";
    q("enemyCoreBar").style.width=enemy?`${Math.max(0,Math.min(100,enemy.hp/Math.max(1,enemy.maxHp)*100))}%`:"0%";

    const points=(stage?.deploymentPoints||[]).filter(point=>point.capturable!==false);
    q("captureSummary").textContent=points.map(point=>`${point.owner==="PLAYER"?"◆":point.owner==="ENEMY"?"◇":"○"}${point.name}`).join("　");

    q("mapMeta").textContent=[
      snapshot?.map?`地圖：${snapshot.map.width} × ${snapshot.map.height}`:"",
      stage?.generatedBattlefield?.size?`尺寸：${stage.generatedBattlefield.size}`:"",
      stage?.generatedBattlefield?.seed!=null?`Seed：${stage.generatedBattlefield.seed}`:"固定關卡地圖"
    ].filter(Boolean).join("\n");

    q("mapStageInfo").textContent=[
      `模式：${stage?.mode==="VERSUS"?"對戰":"戰役／關卡"}`,
      stage?.name?`關卡：${stage.name}`:"",
      points.length?`據點：${points.map(point=>`${point.name}（${OWNER_LABEL[point.owner]||point.owner}）`).join("、")}`:"",
      stage?.ruleset==="CORE_CAPTURE"?"勝利條件：摧毀敵方 Core；中立據點可作為出生點。":""
    ].filter(Boolean).join("\n");

    this.endTurn.disabled=phase!=="PLAYER_TURN";
    this.renderView();this.renderContext();this.renderLog();
  }

  renderView(){
    const state=this.renderer?.getViewState?.();if(!state)return;
    q("projectionToggle").textContent=state.projection==="ISO"?"正視圖":"45°視角";
  }

  contextData(){
    return{
      unit:this.runtime?.getInspectedUnitPresentation?.()||null,
      tile:this.runtime?.getInspectedTilePresentation?.()||null
    };
  }

  chooseContextTab(data,preferred=this.contextTab){
    if(preferred==="UNIT"&&data.unit)return"UNIT";
    if(preferred==="TILE"&&data.tile)return"TILE";
    return data.unit?"UNIT":"TILE";
  }

  setContextOpen(open){
    const data=this.contextData();
    if(open&&!data.unit&&!data.tile)return false;
    if(open)this.contextTab=this.chooseContextTab(data,this.contextTab);
    this.context.classList.toggle("open",!!open);
    this.context.setAttribute("aria-hidden",String(!open));
    q("infoToggle").classList.toggle("active",!!open);
    if(open){
      this.mapShell.classList.remove("open");this.logShell.classList.remove("active");
      q("versusCoreHud")?.classList.remove("open");q("hudToggle")?.classList.remove("active");
    }
    this.renderContext();
    return !!open;
  }

  toggleContext(){return this.setContextOpen(!this.context.classList.contains("open"))}

  setContextTab(tab){
    const data=this.contextData();
    if(tab==="UNIT"&&!data.unit)return;
    if(tab==="TILE"&&!data.tile)return;
    this.contextTab=tab;this.renderContext();
  }

  renderContext(){
    const data=this.contextData();
    q("infoToggle").disabled=!data.unit&&!data.tile;
    if(!data.unit&&!data.tile){this.context.classList.remove("open");return}

    this.contextTab=this.chooseContextTab(data,this.contextTab);
    const unitTab=q("contextUnitTab"),tileTab=q("contextTileTab");
    unitTab.disabled=!data.unit;tileTab.disabled=!data.tile;
    unitTab.classList.toggle("active",this.contextTab==="UNIT"&&!!data.unit);
    tileTab.classList.toggle("active",this.contextTab==="TILE"&&!!data.tile);
    q("contextUnitPanel").classList.toggle("active",this.contextTab==="UNIT"&&!!data.unit);
    q("contextTilePanel").classList.toggle("active",this.contextTab==="TILE"&&!!data.tile);

    if(data.unit){
      const u=data.unit,s=u.stats||{};
      q("contextUnitName").textContent=`${u.name}｜${u.team}`;
      q("contextUnitVitals").textContent=`HP ${u.hp}/${u.maxHp}　MP ${u.mana}/${u.maxMana}　MOVE ${u.move}`;
      const stats=[
        ["ATK",s.atk],["DEF",s.def],["MATK",s.matk],["MDEF",s.mdef],
        ["HIT",`${s.hit??"-"}%`],["EVA",s.eva],["CRIT",`${s.crit??"-"}%`],["SPD",s.spd]
      ];
      q("contextUnitStats").innerHTML=stats.map(([name,value])=>`<div class="context-stat"><b>${name}</b><span>${esc(value??"-")}</span></div>`).join("");
      q("contextUnitPosition").textContent=`狀態：${u.actionState}｜位置 (${u.x},${u.y})｜${u.terrain}｜高度 ${u.elevation}`;
      q("contextUnitSkills").innerHTML=(u.skills||[]).length
        ?u.skills.map(skill=>`<div class="context-skill"><strong>${esc(skill.name)}</strong><small>${esc(skill.category)}｜射程 ${skill.range?.min??"-"}-${skill.range?.max??"-"}｜${esc(skill.resource||"")}${skill.variants?.length?`｜變化：${skill.variants.map(v=>esc(v.name)).join("／")}`:""}</small></div>`).join("")
        :`<div class="context-line">沒有可用技能資料。</div>`;
    }

    if(data.tile){
      q("contextTileTitle").textContent=data.tile.summary?.title||"地形";
      q("contextTileMeta").textContent=data.tile.summary?.meta||"";
      q("contextTileStatus").textContent=data.tile.summary?.status||"";
      q("contextTileDetails").textContent=data.tile.details||"";
    }
  }

  renderLog(){
    const model=this.runtime?.getBattleLog?.();if(!model)return;
    this.logTabs?.querySelectorAll("[data-log-type]").forEach(button=>{
      const active=button.dataset.logType===model.active;
      button.classList.toggle("active",active);
      button.setAttribute("aria-selected",String(active));
    });
    const entries=model.entries||[];
    this.logPanel.innerHTML=entries.length
      ?entries.map(entry=>`<div class="log-row ${esc(entry.type)}">${esc(entry.text)}</div>`).join("")
      :`<div class="log-empty">（目前沒有${model.active==="BATTLE"?"戰鬥":model.active==="SYSTEM"?"系統":"詳細"}紀錄）</div>`;
    if(this.logShell.classList.contains("active"))this.logPanel.scrollTop=this.logPanel.scrollHeight;
  }

  renderEngagement(){
    const model=this.runtime?.getEngagementPresentation?.();if(!model)return;
    const bar=q("skillBar");
    bar.innerHTML="";
    bar.classList.add("engagement-overlay");
    const title=document.createElement("strong");
    title.textContent=model.skillName||"交戰";bar.appendChild(title);

    for(const group of model.groups||[]){
      const wrap=document.createElement("div");wrap.className="support-choice";
      const label=document.createElement("div");label.textContent=group.title;wrap.appendChild(label);
      for(const action of group.actions||[])wrap.appendChild(this.engagementButton(action));
      bar.appendChild(wrap);
    }
    for(const action of model.actions||[])bar.appendChild(this.engagementButton(action));
  }

  engagementButton(action){
    const button=document.createElement("button");
    button.type="button";button.textContent=action.label;button.disabled=!!action.disabled;
    button.onclick=()=>this.runtime.handleEngagementUIAction(action.id,action.payload||{});
    return button;
  }
}
