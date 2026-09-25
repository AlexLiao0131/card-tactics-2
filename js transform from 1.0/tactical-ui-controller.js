(()=>{
  "use strict";

  const battleScreen=document.getElementById("battleScreen");
  const main=battleScreen?.querySelector("main");
  const toolbar=battleScreen?.querySelector(".toolbar");
  if(!battleScreen||!main||!toolbar)return;

  const TAB_LABELS=Object.freeze({BATTLE:"戰鬥",SYSTEM:"系統",DETAIL:"詳細"});
  let logOpen=false;
  let inspectorOpen=false;
  let inspectorTab="UNIT";

  const toggle=document.createElement("button");
  toggle.id="battleLogToggle";
  toggle.type="button";
  toggle.className="battle-log-toggle";
  toggle.textContent="LOG";
  toggle.setAttribute("aria-expanded","false");
  toggle.setAttribute("aria-controls","battleLogDrawer");

  const infoButton=document.createElement("button");
  infoButton.id="battleInfoToggle";
  infoButton.type="button";
  infoButton.className="battle-info-toggle";
  infoButton.textContent="ⓘ";
  infoButton.title="角色／地形詳情";
  infoButton.setAttribute("aria-label","開啟角色或地形詳情");
  infoButton.setAttribute("aria-expanded","false");
  infoButton.setAttribute("aria-controls","battleContextInspector");

  const drawer=document.createElement("aside");
  drawer.id="battleLogDrawer";
  drawer.className="battle-log-drawer";
  drawer.setAttribute("aria-hidden","true");
  drawer.innerHTML=`
    <div class="battle-log-head">
      <strong>戰鬥紀錄</strong>
      <button class="battle-log-close" type="button" aria-label="收合戰鬥紀錄">×</button>
    </div>
    <div class="battle-log-tabs" role="tablist"></div>
    <div class="battle-log-content" role="log" aria-live="polite"></div>`;

  const actionDock=document.createElement("div");
  actionDock.className="battle-action-dock";
  const endTurnButton=document.createElement("button");
  endTurnButton.type="button";
  endTurnButton.className="battle-end-turn";
  endTurnButton.textContent="結束回合";
  endTurnButton.onclick=()=>window.CardTacticsRuntime?.endPlayerTurn?.();
  actionDock.append(infoButton,toggle,endTurnButton);
  main.append(actionDock,drawer);

  const inspectorBackdrop=document.createElement("div");
  inspectorBackdrop.className="battle-context-backdrop";
  inspectorBackdrop.setAttribute("aria-hidden","true");

  const inspector=document.createElement("aside");
  inspector.id="battleContextInspector";
  inspector.className="battle-context-inspector";
  inspector.setAttribute("aria-hidden","true");
  inspector.innerHTML=`
    <div class="battle-context-handle" aria-hidden="true"><i></i></div>
    <div class="battle-context-head">
      <strong>戰場詳情</strong>
      <button class="battle-context-close" type="button" aria-label="關閉詳情">×</button>
    </div>
    <div class="battle-context-tabs" role="tablist">
      <button type="button" data-context-tab="UNIT">角色</button>
      <button type="button" data-context-tab="TILE">地形</button>
    </div>
    <div class="battle-context-body">
      <section class="battle-context-unit" data-context-panel="UNIT">
        <div class="battle-context-unit-head">
          <div class="battle-context-portrait"><span>?</span><img alt=""></div>
          <div>
            <strong class="battle-context-unit-name"></strong>
            <div class="battle-context-hp"><i></i></div>
            <small class="battle-context-hp-text"></small>
          </div>
        </div>
        <div class="battle-context-stats"></div>
        <div class="battle-context-preview"></div>
        <div class="battle-context-status"></div>
        <div class="battle-context-position"></div>
      </section>
      <section class="battle-context-tile" data-context-panel="TILE">
        <strong class="battle-context-tile-title"></strong>
        <div class="battle-context-tile-meta"></div>
        <div class="battle-context-tile-status"></div>
        <pre class="battle-context-tile-details"></pre>
      </section>
    </div>`;

  main.append(inspectorBackdrop,inspector);

  const tabs=drawer.querySelector(".battle-log-tabs");
  const content=drawer.querySelector(".battle-log-content");
  const close=drawer.querySelector(".battle-log-close");

  Object.entries(TAB_LABELS).forEach(([type,label])=>{
    const button=document.createElement("button");
    button.type="button";
    button.dataset.logType=type;
    button.textContent=label;
    button.onclick=()=>window.CardTacticsRuntime?.setBattleLogTab?.(type);
    tabs.appendChild(button);
  });

  function setLogOpen(value){
    logOpen=!!value;
    drawer.classList.toggle("open",logOpen);
    drawer.setAttribute("aria-hidden",String(!logOpen));
    toggle.setAttribute("aria-expanded",String(logOpen));
  }

  function inspectorData(){
    return {
      unit:window.CardTacticsRuntime?.getInspectedUnitPresentation?.()||null,
      tile:window.CardTacticsRuntime?.getInspectedTilePresentation?.()||null
    };
  }

  function chooseAvailableTab(data,preferred=inspectorTab){
    if(preferred==="UNIT"&&data.unit)return"UNIT";
    if(preferred==="TILE"&&data.tile)return"TILE";
    if(data.unit)return"UNIT";
    return"TILE";
  }

  function setInspectorOpen(value,preferredTab=null){
    const data=inspectorData();
    if(value&&!data.unit&&!data.tile)return false;
    inspectorOpen=!!value;
    if(inspectorOpen)inspectorTab=chooseAvailableTab(data,preferredTab||inspectorTab);
    inspector.classList.toggle("open",inspectorOpen);
    inspectorBackdrop.classList.toggle("open",inspectorOpen);
    inspector.setAttribute("aria-hidden",String(!inspectorOpen));
    inspectorBackdrop.setAttribute("aria-hidden",String(!inspectorOpen));
    infoButton.setAttribute("aria-expanded",String(inspectorOpen));
    renderInspector();
    return inspectorOpen;
  }

  function renderUnitPanel(data){
    const panel=inspector.querySelector('[data-context-panel="UNIT"]');
    panel.hidden=!data;
    if(!data)return;

    panel.querySelector(".battle-context-unit-name").textContent=data.name;
    panel.querySelector(".battle-context-hp-text").textContent=`HP ${data.hp}/${data.maxHp}｜MP ${data.mana??0}/${data.maxMana??0}｜MOVE ${data.move}`;
    panel.querySelector(".battle-context-hp i").style.width=`${Math.max(0,Math.min(100,data.hp/Math.max(1,data.maxHp)*100))}%`;

    const s=data.stats||{};
    panel.querySelector(".battle-context-stats").textContent=
      `ATK ${s.atk??"-"}　DEF ${s.def??"-"}　MATK ${s.matk??"-"}　MDEF ${s.mdef??"-"}\n`+
      `HIT ${s.hit??"-"}%　EVA ${s.eva??"-"}　CRIT ${s.crit??"-"}%　SPD ${s.spd??"-"}`;

    panel.querySelector(".battle-context-preview").textContent=data.preview
      ?`${data.preview.skillName} → 命中 ${data.preview.hit}%｜暴擊 ${data.preview.crit}%`
      :"";
    panel.querySelector(".battle-context-status").textContent=`狀態：${data.actionState}`;
    panel.querySelector(".battle-context-position").textContent=`所在位置：(${data.x},${data.y})｜${data.terrain}｜高度 ${data.elevation}`;

    const img=panel.querySelector("img");
    const fallback=panel.querySelector(".battle-context-portrait span");
    const src=data.visualId?window.VisualDatabase?.asset?.("characters",data.visualId,"portrait")||null:null;
    if(src){
      img.src=src;
      img.style.display="block";
      fallback.style.display="none";
      img.onerror=()=>{img.style.display="none";fallback.style.display="grid";};
    }else{
      img.removeAttribute("src");
      img.style.display="none";
      fallback.style.display="grid";
      fallback.textContent=(data.name||"?").slice(0,1);
    }
  }

  function renderTilePanel(data){
    const panel=inspector.querySelector('[data-context-panel="TILE"]');
    panel.hidden=!data;
    if(!data)return;
    panel.querySelector(".battle-context-tile-title").textContent=data.summary?.title||"地形";
    panel.querySelector(".battle-context-tile-meta").textContent=data.summary?.meta||"";
    panel.querySelector(".battle-context-tile-status").textContent=data.summary?.status||"";
    panel.querySelector(".battle-context-tile-details").textContent=data.details||"";
  }

  function renderInspector(){
    const data=inspectorData();
    infoButton.disabled=!data.unit&&!data.tile;

    if(!inspectorOpen)return;
    if(!data.unit&&!data.tile){
      setInspectorOpen(false);
      return;
    }

    inspectorTab=chooseAvailableTab(data,inspectorTab);
    renderUnitPanel(data.unit);
    renderTilePanel(data.tile);

    inspector.querySelectorAll("[data-context-tab]").forEach(button=>{
      const tab=button.dataset.contextTab;
      const available=tab==="UNIT"?!!data.unit:!!data.tile;
      button.disabled=!available;
      const active=available&&tab===inspectorTab;
      button.classList.toggle("active",active);
      button.setAttribute("aria-selected",String(active));
    });

    inspector.querySelectorAll("[data-context-panel]").forEach(panel=>{
      panel.classList.toggle("active",panel.dataset.contextPanel===inspectorTab);
    });
  }

  inspector.querySelectorAll("[data-context-tab]").forEach(button=>{
    button.onclick=()=>{
      const next=button.dataset.contextTab;
      const data=inspectorData();
      if(next==="UNIT"&&!data.unit)return;
      if(next==="TILE"&&!data.tile)return;
      inspectorTab=next;
      renderInspector();
    };
  });

  infoButton.onclick=()=>setInspectorOpen(!inspectorOpen);
  inspector.querySelector(".battle-context-close").onclick=()=>setInspectorOpen(false);
  inspectorBackdrop.onclick=()=>setInspectorOpen(false);

  let touchStartY=null;
  inspector.addEventListener("touchstart",event=>{
    if(event.touches.length===1)touchStartY=event.touches[0].clientY;
  },{passive:true});
  inspector.addEventListener("touchend",event=>{
    if(touchStartY==null)return;
    const y=event.changedTouches?.[0]?.clientY;
    if(Number.isFinite(y)&&y-touchStartY>70)setInspectorOpen(false);
    touchStartY=null;
  },{passive:true});

  const skillBar=document.getElementById("skillBar");

  function engagementUnit(data,side){
    const card=document.createElement("div");
    card.className=`engagement-unit engagement-${side}`;
    if(!data){
      card.innerHTML=`<div class="engagement-figure"><span>?</span></div><strong>未知</strong>`;
      return card;
    }
    card.innerHTML=
      `<div class="engagement-figure"><span>${data.shortName}</span></div>`+
      `<strong>${data.name}</strong>`+
      `<div class="engagement-hp"><i style="width:${data.hpPct}%"></i></div>`+
      `<small>HP ${data.hp} / ${data.maxHp}</small>`+
      (data.oddsLabel?`<small><b>${data.oddsLabel}</b></small>`:"");
    return card;
  }

  function engagementButton(action){
    const button=document.createElement("button");
    button.type="button";
    button.className="action-button";
    button.textContent=action.label;
    button.disabled=!!action.disabled;
    button.onclick=()=>window.CardTacticsRuntime?.handleEngagementUIAction?.(action.id,action.payload||{});
    return button;
  }

  function renderEngagement(){
    if(!skillBar)return;
    const data=window.CardTacticsRuntime?.getEngagementPresentation?.();
    if(!data)return;
    skillBar.classList.add("engagement-overlay");
    const stage=document.createElement("div");
    stage.className="engagement-stage";
    stage.appendChild(engagementUnit(data.player,"player"));
    const center=document.createElement("div");
    center.className="engagement-versus";
    center.innerHTML=`<b>VS</b><span>${data.skillName}</span>`;
    stage.appendChild(center);
    stage.appendChild(engagementUnit(data.enemy,"enemy"));
    skillBar.appendChild(stage);

    for(const group of data.groups||[]){
      const row=document.createElement("div");
      row.className="support-choice";
      const title=document.createElement("div");
      title.textContent=group.title;
      row.appendChild(title);
      (group.actions||[]).forEach(action=>row.appendChild(engagementButton(action)));
      skillBar.appendChild(row);
    }
    (data.actions||[]).forEach(action=>skillBar.appendChild(engagementButton(action)));
  }

  function render(){
    const phase=window.CardTacticsRuntime?.getPhase?.();
    endTurnButton.disabled=phase!=="PLAYER_TURN";
    renderInspector();

    const log=window.CardTacticsRuntime?.getBattleLog?.();
    if(!log)return;
    tabs.querySelectorAll("[data-log-type]").forEach(button=>{
      const active=button.dataset.logType===log.active;
      button.classList.toggle("active",active);
      button.setAttribute("aria-selected",String(active));
    });
    content.textContent=log.entries.length
      ?log.entries.map(entry=>entry.text).join("\n")
      :"（目前沒有紀錄）";
    if(logOpen)content.scrollTop=content.scrollHeight;
  }

  toggle.onclick=()=>{setLogOpen(!logOpen);render();};
  close.onclick=()=>setLogOpen(false);

  window.TacticalUIController=Object.freeze({
    renderEngagement,
    openInspector:(tab=null)=>setInspectorOpen(true,tab),
    closeInspector:()=>setInspectorOpen(false),
    toggleInspector:()=>setInspectorOpen(!inspectorOpen)
  });

  /* Inspection now only updates context. It never opens a HUD automatically. */
  window.addEventListener("cardtactics:inspection",render);
  window.addEventListener("cardtactics:log",render);
  window.addEventListener("cardtactics:state",render);
  window.addEventListener("cardtactics:battle-render",render);

  setLogOpen(false);
  setInspectorOpen(false);
  render();
})();
