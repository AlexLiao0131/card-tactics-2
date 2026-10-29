function q(id){return document.getElementById(id)}
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
const OWNER_LABEL={PLAYER:"我方",ENEMY:"敵方",NEUTRAL:"中立"};
const WEATHER_LABEL=Object.freeze({
  CLEAR:["☀","晴朗"],
  FOG:["🌫","霧"],
  RAIN:["🌧","雨"],
  HEAVY_RAIN:["🌧","豪大雨"],
  THUNDERSTORM:["⛈","雷雨"],
  TYPHOON:["🌀","颱風"],
  SNOW:["🌨","降雪"],
  SCORCHING_SUN:["🌞","烈日"],
  BLIZZARD:["❄","暴風雪"]
});

export class BattleUI{
  constructor(){
    this.runtime=null;this.renderer=null;this.contextTab="UNIT";
    this.heldInspection=null; // Read-only snapshot of explicitly long-pressed tile.
    this.inspectorHome=q("battleScreen");
    this.inspectorHudNode=null;
    this.context=q("battleContextInspector");this.mapShell=q("mapInfoShell");this.logShell=q("battleLogShell");
    this.logPanel=q("battleLog");this.logTabs=q("battleLogTabs");this.endTurn=q("endTurn");
    this.statusUnitId=null;
    this.statusMarkup="";
    this.statusRoot=document.createElement("div");
    this.statusRoot.className="battle-unit-status-root";
    this.statusReturnFocus=null;
     this.logRenderQueued=false;this.logRenderedTail=null;this.logRenderedLength=-1;this.logRenderedTab=null;
  }

  bind(runtime,renderer){
    this.runtime=runtime;this.renderer=renderer;
    this.endTurn.onclick=()=>runtime.endPlayerTurn();
    q("nextUnit").onclick=()=>runtime.selectNextAvailableUnit?.();
    q("rotateLeft").onclick=()=>renderer.rotate(-1);
    q("rotateRight").onclick=()=>renderer.rotate(1);
    q("projectionToggle").onclick=()=>renderer.toggleProjection();
    q("resetView").onclick=()=>renderer.resetView();

    // The on-map long hold is the only inspector entry point. Remove obsolete
    // right-side toggles; the existing canonical inspector remains the view.
    q("infoToggle")?.remove();
    q("hudToggle")?.remove();
    q("contextClose").onclick=()=>this.setContextOpen(false);
    q("contextUnitTab").onclick=()=>this.setContextTab("UNIT");
    q("contextTileTab").onclick=()=>this.setContextTab("TILE");
    // The existing UnitHudOverlay is the visual owner of portrait/HP/MP.
    // Reparent the canonical inspector beneath that SAME HUD only while
    // inspecting a visible unit; empty tiles use the original standalone panel.
    if(!document.getElementById("unit-hud-inspection-layout")){
      const style=document.createElement("style");style.id="unit-hud-inspection-layout";
      style.textContent=`
        .unit-hud-layer:has(.battle-context-inspector.open){overflow:visible;z-index:105}
        .unit-hud.inspection-open{opacity:1!important;z-index:3}
        .unit-hud .battle-context-inspector{
          display:none;position:absolute;z-index:4;
          left:calc(50% + var(--inspector-shift-x,0px));
          right:auto;top:calc(100% + 6px);bottom:auto;
          transform:translateX(-50%);
          width:min(342px,calc(100vw - 20px));
          max-height:min(46vh,350px);pointer-events:auto;
          text-align:left;color:#e6eaf1;
          border-color:rgba(214,184,120,.7)
        }
        .unit-hud .battle-context-inspector.open{display:block}
        .unit-hud .battle-context-inspector.inspection-above{top:auto;bottom:calc(100% + 6px)}
        .unit-hud .battle-context-inspector button{pointer-events:auto;touch-action:manipulation}
        .unit-hud .battle-context-inspector .context-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
        @media(max-width:700px){
          .unit-hud .battle-context-inspector{max-height:42vh}
          .unit-hud .battle-context-inspector .context-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
        }`;
      document.head.appendChild(style);
    }

    q("mapToggle").onclick=()=>this.togglePanel(this.mapShell,"open");
    q("mapClose").onclick=()=>this.mapShell.classList.remove("open");


    this.logTabs?.querySelectorAll("[data-log-type]").forEach(button=>{
      button.onclick=()=>{
        this.runtime?.setBattleLogTab?.(button.dataset.logType);
        this.renderLog();
      };
    });

    q("logToggle").onclick=()=>{this.togglePanel(this.logShell,"active");this.renderLog();};
    q("logClose").onclick=()=>this.logShell.classList.remove("active");

    // BattleUI owns every battlefield inspector, including the shared
    // character-card detail view.  UnitControlUI only owns facing and altitude.
    q("battleScreen").appendChild(this.statusRoot);
    this.statusRoot.addEventListener("click",event=>{
      const close=event.target.closest?.("[data-close-hero-info]");
      if(!close)return;
      if(close.dataset.closeHeroInfo==="backdrop"&&event.target!==close)return;
      this.closeStatus();
    });
    window.addEventListener("keydown",event=>{
      if(event.key==="Escape"&&this.statusUnitId)this.closeStatus();
    });

    window.TacticalUIController=Object.freeze({
      renderEngagement:()=>this.renderEngagement(),
      openInspector:(tab=null)=>{this.heldInspection=null;if(tab)this.contextTab=tab;this.setContextOpen(true)},
      openStatus:unitId=>this.openStatus(unitId),
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
    window.addEventListener("cardtactics:log",()=>this.queueLogRender());
    window.addEventListener("cardtactics:inspection",()=>{
      // Selecting a tile normally never changes which held tile is shown.
      if(!this.heldInspection)this.renderContext();
    });
    window.addEventListener("cardtactics:battle-inspect-hold",event=>{
      const pos=event.detail;
      if(!Number.isInteger(pos?.x)||!Number.isInteger(pos?.y))return;
      this.inspectHeldTile(pos.x,pos.y);
    });
    window.addEventListener("cardtactics:battle-inspection-dismiss",()=>{
      if(this.heldInspection)this.setContextOpen(false);
    });

    this.render();
  }

  // A command-menu action opens the already-existing hero card detail
  // presenter. The unit ID and current values belong to UnitRuntimeEngine.
  openStatus(unitId){
    const selected=this.runtime?.getBattleSnapshot?.()?.units?.find(
      unit=>unit.id===unitId&&unit.team==="PLAYER"&&unit.selected
    );
    const live=globalThis.UnitRuntimeEngine?.getLiveUnit?.(unitId);
    if(!selected||!live?.alive||live.team!=="P")return false;
    if(!globalThis.CardTacticsHeroCard?.detail)return false;
    this.statusReturnFocus=document.activeElement;
    this.statusUnitId=unitId;
    this.statusMarkup="";
    this.renderStatus();
    this.statusRoot.querySelector(".hero-info-header button")?.focus();
    return true;
  }

  closeStatus({restoreFocus=true}={}){
    this.statusUnitId=null;
    this.statusMarkup="";
    this.statusRoot.replaceChildren();
    if(restoreFocus&&this.statusReturnFocus?.isConnected)this.statusReturnFocus.focus();
    this.statusReturnFocus=null;
  }

  renderStatus(snapshot=this.runtime?.getBattleSnapshot?.()){
    if(!this.statusUnitId)return;
    const unit=globalThis.UnitRuntimeEngine?.getLiveUnit?.(this.statusUnitId);
    const selected=snapshot?.units?.some(
      candidate=>candidate.id===this.statusUnitId&&candidate.team==="PLAYER"&&candidate.selected
    );
    if(!unit?.alive||unit.team!=="P"||!selected){this.closeStatus({restoreFocus:false});return;}
    const card=Object.values(globalThis.CARDS||{}).find(
      item=>item.type==="CHARACTER"&&item.characterId===unit.character?.id
    )||{name:unit.character?.name||"角色",characterId:unit.character?.id||null,cost:null};
    const markup=globalThis.CardTacticsHeroCard?.detail?.(card,{unit})||"";
    if(!markup||markup===this.statusMarkup)return;
    const scroll=this.statusRoot.querySelector(".hero-info-content")?.scrollTop||0;
    const expanded=[...this.statusRoot.querySelectorAll(".hero-info-skill details")]
      .map((node,index)=>node.open?index:-1).filter(index=>index>=0);
    this.statusRoot.innerHTML=markup;
    this.statusMarkup=markup;
    this.statusRoot.querySelectorAll(".hero-info-skill details")
      .forEach((node,index)=>{node.open=expanded.includes(index)});
    const content=this.statusRoot.querySelector(".hero-info-content");
    if(content)content.scrollTop=scroll;
  }

  togglePanel(panel,cls){
    const open=panel.classList.toggle(cls);
    if(open){
      if(panel!==this.context)this.setContextOpen(false);
      if(panel!==this.mapShell)this.mapShell.classList.remove("open");
      if(panel!==this.logShell)this.logShell.classList.remove("active");
      // Core / capture status remains available without a toggle button.
    }
  }

  render(){
    if(!this.runtime)return;
    const snapshot=this.runtime.getBattleSnapshot(),stage=this.runtime.getStage(),cores=this.runtime.getCores(),phase=this.runtime.getPhase();
    if(this.inspectorHudNode&&!this.inspectorHudNode.isConnected)
      this.setContextOpen(false); // Defeated/removed unit: restore inspector DOM owner.
    const player=cores.find(c=>c.owner==="PLAYER"),enemy=cores.find(c=>c.owner==="ENEMY");
    const next=q("nextUnit"),eligible=(snapshot?.units||[]).filter(unit=>unit.team==="PLAYER"&&!unit.finished);
    next.disabled=phase!=="PLAYER_TURN"||eligible.length===0;
    next.title=eligible.length?`選取下一位未完成行動角色（剩 ${eligible.length} 位）`:"目前沒有可行動角色";
    const coreHud=q("versusCoreHud"),hasCores=!!player||!!enemy;
    coreHud.classList.toggle("available",hasCores);
    coreHud.setAttribute("aria-hidden",String(!hasCores));
    // The core + capture HUD is the one authoritative persistent scoreboard.
    coreHud.classList.toggle("open",hasCores);
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
    this.renderWeather(snapshot);this.renderView();this.renderContext();this.renderStatus(snapshot);this.renderLog();
  }

  renderWeather(snapshot){
    const node=q("weatherIndicator");if(!node)return;
    const env=snapshot?.presentation?.environment||{};
    const weather=String(env.weather||"CLEAR").toUpperCase();
    const [icon,label]=WEATHER_LABEL[weather]||["◌",weather];
    const remaining=env.weatherTurnsRemaining;
    const suffix=weather==="CLEAR"||remaining==null?"":Number(remaining)>0?` ${Number(remaining)}T`:" 即將結束";
    node.textContent=`${icon} ${label}${suffix}`;
    node.title=`目前天氣：${label}${weather==="CLEAR"||remaining==null?"":Number(remaining)>0?`｜剩餘 ${Number(remaining)} 回合`:"｜即將結束"}${env.timeOfDay==="NIGHT"?"｜夜間":""}`;
    node.setAttribute("aria-label",node.title);
    node.style.pointerEvents="none";
    node.style.cursor="default";
  }

  renderView(){
    const state=this.renderer?.getViewState?.();if(!state)return;
    q("projectionToggle").textContent=state.projection==="ISO"?"正視圖":"45°視角";
  }

  // The official game owns all data. Long press reads it without selecting a
  // unit, changing the action mode or firing a tactical tile click.
  inspectHeldTile(x,y){
    const snapshot=this.runtime?.getBattleSnapshot?.();
    const published=snapshot?.map?.tiles?.find(tile=>tile.x===x&&tile.y===y);
    const map=this.runtime?.getBattleMap?.();
    const tile=globalThis.TacticalEngine?.tile?.(map,x,y);
    if(!published||!tile)return false;
    let tileData=globalThis.TileInspectionPresentation?.create?.({map,environmentState:null,tile})||null;
    if(tileData){
      // The runtime owns tactical visibility. Use the already-published effect
      // presentation without creating a second state or revealing hidden units.
      const effects=(published.effectDetails||[]).map(effect=>
        `${effect.type}${effect.duration==null?'':` ${effect.duration} 回合`}`);
      const climate=snapshot.presentation?.environment||{};
      const weather=WEATHER_LABEL[climate.weather]?.[1]||climate.weather||'—';
      // The tile-only source does not carry the private environmentState; remove
      // its baseline "晴朗"/"效果：無" rather than misleading with stale values.
      const lines=(tileData.details||'').split('\n')
        .filter(line=>!line.startsWith('效果：'))
        .map(line=>line.startsWith('環境材質：')?line.replace(/｜氣候：.*/,`｜氣候：${weather}`):line);
      tileData={...tileData,summary:{...tileData.summary,
        status:effects.length?effects.join('、'):'無'},
        details:[...lines,`目前效果：${effects.length?effects.join('、'):'無'}`].join('\n')};
    }
    const seen=(snapshot.units||[]).find(unit=>unit.x===x&&unit.y===y);
    const live=seen?globalThis.UnitRuntimeEngine?.getLiveUnit?.(seen.id):null;
    let unitData=null;
    if(seen&&live?.alive){
      const combat=live.character?.combat||{};
      const ids=globalThis.EffectEngine?.skillIds?.(live)||live.character?.skills||[];
      unitData={id:seen.id,name:seen.name,team:seen.team,
        hp:seen.hp,maxHp:seen.maxHp,mana:seen.mana,maxMana:seen.maxMana,
        move:Number(combat.move||0),x,y,
        terrain:globalThis.TERRAINS?.[tile.terrain]?.name||tile.terrain,
        elevation:Number(tile.elevation||0),
        actionState:live.waited?'已待機':seen.acted?'已完成行動':seen.moved?'已移動':'可行動',
        stats:{atk:Number(combat.atk||0),def:Number(combat.def||0),
          matk:Number(combat.matk||0),mdef:Number(combat.mdef||0),
          hit:globalThis.BATTLE_RULES?.combatParams?Math.max(BATTLE_RULES.combatParams.minHit,Math.min(BATTLE_RULES.combatParams.maxHit,BATTLE_RULES.combatParams.baseHit+BattleEngine.accuracy(live.character,{}))):null,
          // EVA in BattleEngine is a MODIFIER, not a raw dodge probability.
          // Display both the modifier and an explicitly conditional reference:
          // equal attacker/defender AGI, no skill/terrain/accuracy changes.
          eva:globalThis.BattleEngine?.evasion?.(live.character),
          baseDodge:(()=>{
            const p=globalThis.BATTLE_RULES?.combatParams;
            const bonus=globalThis.BattleEngine?.evasion?.(live.character);
            if(!p||!Number.isFinite(bonus))return null;
            return 100-Math.max(p.minHit,Math.min(p.maxHit,p.baseHit-bonus));
          })(),
          crit:globalThis.BattleEngine?.critChance?.(live.character,{}),
          spd:globalThis.BattleEngine?.actionSpeed?.(live.character,{})},
        skills:(globalThis.SkillDatabase?.list?.(ids)||[]).map(skill=>({
          name:skill.name,category:skill.category,
          range:{min:skill.range?.min,max:skill.range?.max},
          resource:globalThis.UnitRuntimeEngine?.resourceLabel?.(live,skill)||'',
          variants:Array.isArray(skill.variants)?skill.variants:[]
        }))};
    }
    this.heldInspection={x,y,unit:unitData,tile:tileData};
    // The original portrait/HP/MP HUD persists after release. Acted/waited
    // units are valid: snapshot.units includes them (finished is NOT filtered).
    window.dispatchEvent(new CustomEvent("cardtactics:unit-hud-hold",{
      detail:unitData?{x,y}:null
    }));
    this.contextTab=unitData?'UNIT':'TILE';
    this.setContextOpen(true);
    return true;
  }

  contextData(){
    if(this.heldInspection)return{unit:this.heldInspection.unit,tile:this.heldInspection.tile};
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

  // Reuse the one canonical inspector DOM. The original UnitHudOverlay keeps
  // owning and updating its portrait, HP/MP bars, effects and screen projection.
  mountInspector(unitId=null){
    if(this.inspectorHudNode){
      this.inspectorHudNode.classList.remove("inspection-open");
      this.inspectorHudNode.style.removeProperty("--inspector-shift-x");
      this.inspectorHudNode=null;
    }
    this.context.classList.remove("inspection-above");
    if(this.context.parentElement!==this.inspectorHome)this.inspectorHome.appendChild(this.context);
    const hud=unitId?this.renderer?.unitHud?.nodes?.get(unitId)?.node:null;
    if(!hud||!hud.isConnected)return;
    this.inspectorHudNode=hud;
    hud.classList.add("inspection-open");
    hud.appendChild(this.context);
    // One layout read only on long-hold (never on every render frame).
    const rect=hud.getBoundingClientRect(),bounds=this.inspectorHome.getBoundingClientRect();
    const width=Math.min(342,Math.max(0,bounds.width-20));
    const center=rect.left+rect.width/2;
    const safeCenter=Math.min(bounds.right-width/2-10,Math.max(bounds.left+width/2+10,center));
    hud.style.setProperty("--inspector-shift-x",`${Math.round(safeCenter-center)}px`);
    const below=bounds.bottom-rect.bottom,above=rect.top-bounds.top;
    this.context.classList.toggle("inspection-above",below<Math.min(bounds.height*.42,260)&&above>below);
  }

  setContextOpen(open){
    const data=this.contextData();
    if(open&&!data.unit&&!data.tile)return false;
    if(open)this.contextTab=this.chooseContextTab(data,this.contextTab);
    if(open){
      this.mountInspector(this.heldInspection?.unit?.id||null);
    }else{
      this.mountInspector(null);
      this.heldInspection=null;
      window.dispatchEvent(new CustomEvent("cardtactics:unit-hud-hold",{detail:null}));
    }
    this.context.classList.toggle("open",!!open);
    this.context.setAttribute("aria-hidden",String(!open));
    if(open){
      this.mapShell.classList.remove("open");this.logShell.classList.remove("active");
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
        ["HIT",`${s.hit??"-"}%`],
        ["基準閃避",s.baseDodge==null?"—":`${s.baseDodge}%`],
        ["EVA修正",s.eva==null?"—":`${s.eva>=0?"+":""}${s.eva}`],
        ["CRIT",`${s.crit??"-"}%`],["SPD",s.spd]
      ];
      q("contextUnitStats").innerHTML=stats.map(([name,value])=>`<div class="context-stat"><b>${name}</b><span>${esc(value??"-")}</span></div>`).join("");
      q("contextUnitPosition").textContent=`狀態：${u.actionState}｜位置 (${u.x},${u.y})｜${u.terrain}｜高度 ${u.elevation}｜基準閃避僅以同 AGI、零命中加成為比較條件，實戰由雙方屬性及技能決定。`;
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

  queueLogRender(){
    if(!this.logShell?.classList.contains("active")||this.logRenderQueued)return;
    this.logRenderQueued=true;
    requestAnimationFrame(()=>{this.logRenderQueued=false;this.renderLog();});
  }
  renderLog(){
    if(!this.logShell?.classList.contains("active"))return;
    const model=this.runtime?.getBattleLog?.();if(!model)return;
    const entries=model.entries||[],tail=entries[entries.length-1]||null;
    if(this.logRenderedTail===tail&&this.logRenderedLength===entries.length&&this.logRenderedTab===model.active)return;
    this.logRenderedTail=tail;this.logRenderedLength=entries.length;this.logRenderedTab=model.active;
    this.logTabs?.querySelectorAll("[data-log-type]").forEach(button=>{
      const active=button.dataset.logType===model.active;
      button.classList.toggle("active",active);
      button.setAttribute("aria-selected",String(active));
    });
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
    title.textContent=model.mode==="support-select"?"我方交戰準備":"敵方攻擊・選擇應對";bar.appendChild(title);
    const incoming=document.createElement("div");incoming.className="engagement-threat";
    const actor=document.createElement("strong");actor.textContent=`${model.attackerName||"未知"} → ${model.defenderName||"未知"}`;
    const skill=document.createElement("span");
    skill.textContent=`使用技能：${model.skillName||"未知技能"}${model.attackType?`｜${model.attackType}`:""}`;
    incoming.append(actor,skill);bar.appendChild(incoming);

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
