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
    this.contextHudSlot=q("contextHudSlot");
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
    // Inspector layout lives in index.html and css/unit-inspector.css.
    // UnitHudOverlay provides the ONE portrait/bars/equipment/effects node.
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
    window.addEventListener("cardtactics:presentation-published",event=>this.render(event.detail?.snapshot));
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

  render(publishedSnapshot=null){
    if(!this.runtime)return;
    const snapshot=publishedSnapshot||this.runtime.getBattleSnapshot(),stage=this.runtime.getStage(),cores=this.runtime.getCores(),phase=this.runtime.getPhase();
    // An inspected unit can die or disappear under visibility rules.
    // Never keep its last-known portrait/HP on screen after it leaves the snapshot.
    if(this.heldInspection?.unit&&!snapshot.units.some(u=>u.id===this.heldInspection.unit.id))
      this.setContextOpen(false);
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
    // Do not open a separate floating HUD; the official unit tab owns it.
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

  setContextOpen(open){
    const data=this.contextData();
    if(open&&!data.unit&&!data.tile)return false;
    const unitHud=this.renderer?.unitHud;
    if(open){
      this.contextTab=this.chooseContextTab(data,this.contextTab);
      unitHud?.mountInInspector?.(data.unit?.id||null,this.contextHudSlot);
      this.mapShell.classList.remove("open");
      this.logShell.classList.remove("active");
    }else{
      unitHud?.releaseInspectorHud?.();
      this.heldInspection=null;
    }
    this.context.classList.toggle("open",!!open);
    this.context.setAttribute("aria-hidden",String(!open));
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
      const stats=[
        ["ATK",s.atk],["DEF",s.def],["MATK",s.matk],["MDEF",s.mdef],
        ["HIT",s.hit==null?"—":`${s.hit}%`],
        ["EVA修正",s.eva==null?"—":`${s.eva>=0?"+":""}${s.eva}`],
        ["CRIT",s.crit==null?"—":`${s.crit}%`],["SPD",s.spd],["MOVE",u.move]
      ];
      q("contextUnitStats").innerHTML=stats.map(([name,value])=>`<div class="context-stat"><b>${name}</b><span>${esc(value??"—")}</span></div>`).join("");
      q("contextUnitPosition").textContent=[u.actionState,`(${u.x},${u.y})`,u.terrain].filter(Boolean).join(" · ");
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

  // One shared preview card for offensive confirmation and enemy reactions.
  // This is presentation only: it cannot spend a turn, roll dice or change HP.
  renderCombatForecast(forecast,{isEnemyTurn=false,selection=null}={}){
    if(!forecast)return null;
    const card=document.createElement('section');card.className='combat-forecast';
    const heading=document.createElement('div');heading.className='combat-forecast-heading';
    heading.textContent=isEnemyTurn?'敵方攻擊預測':'我方主動攻擊預測';card.appendChild(heading);
    const stats=document.createElement('div');stats.className='combat-forecast-numbers';
    stats.textContent=`命中 ${forecast.hit}%　暴擊 ${forecast.crit}%　一般傷害 ${forecast.normalDamage}　暴擊傷害 ${forecast.criticalDamage}`;
    card.appendChild(stats);
    const title=document.createElement('div');title.className='combat-forecast-label';
    title.textContent=`目標 HP ${forecast.hp}/${forecast.maxHp}　→　${forecast.hpAfterNormal}/${forecast.maxHp}（命中時）`;
    card.appendChild(title);
    const track=document.createElement('div');track.className='combat-forecast-track';
    const current=document.createElement('div');current.className='combat-forecast-current';
    const loss=document.createElement('div');loss.className='combat-forecast-loss';
    current.style.width=`${100*forecast.hpAfterNormal/forecast.maxHp}%`;
    loss.style.width=`${100*(forecast.hp-forecast.hpAfterNormal)/forecast.maxHp}%`;
    track.append(current,loss);card.appendChild(track);
    if(isEnemyTurn){
      const choices=document.createElement('div');choices.className='combat-forecast-choices';
      const normal=document.createElement('div');normal.textContent=`反擊／不防禦：敵方命中 ${forecast.hit}%`;
      choices.appendChild(normal);
      const dodge=document.createElement('div');
      dodge.textContent=`主動迴避：全中 ${forecast.evade.full}%／擦傷 ${forecast.evade.graze}%／閃避 ${forecast.evade.miss}%（擦傷傷害 ${forecast.evade.grazeDamage}）`;
      choices.appendChild(dodge);
      for(const defense of forecast.defenseMethods||[]){
        const el=document.createElement('div');
        el.textContent=defense.valid
          ?`${defense.label}：防禦成功 ${defense.successRate}%（命中時），成功承傷 ${defense.damageIfBlocked}，失敗承傷 ${defense.damageIfFailed}`
          :`${defense.label}：${defense.bypassed?'攻擊無視此防禦':'對此攻擊類型無效'}`;
        choices.appendChild(el);
      }
      card.appendChild(choices);
    }
    const foot=document.createElement('small');foot.className='combat-forecast-note';
    foot.textContent=forecast.note;card.appendChild(foot);
    return card;
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
    const forecast=this.renderCombatForecast(model.forecast,{isEnemyTurn:model.mode!=="support-select"});
    if(forecast)bar.appendChild(forecast);


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
