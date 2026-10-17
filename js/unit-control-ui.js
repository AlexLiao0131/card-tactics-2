const FACING_LABEL=Object.freeze({N:"北",E:"東",S:"南",W:"西"});

function ensureStyle(){
  if(document.getElementById("unit-control-style"))return;
  const style=document.createElement("style");
  style.id="unit-control-style";
  style.textContent=`
    .unit-control{
      position:absolute;
      left:12px;
      bottom:calc(138px + env(safe-area-inset-bottom,0px));
      z-index:48;
      display:flex;
      flex-direction:column;
      gap:6px;
      padding:7px 8px;
      border:1px solid rgba(214,184,120,.72);
      border-radius:12px;
      background:rgba(7,14,22,.90);
      box-shadow:0 8px 24px rgba(0,0,0,.28);
      backdrop-filter:blur(8px);
      -webkit-backdrop-filter:blur(8px);
      color:#f3ead7;
      pointer-events:auto;
      user-select:none;
      -webkit-user-select:none;
    }
    .unit-control[hidden]{display:none!important}
    .unit-control-row{display:flex;align-items:center;gap:6px}
    .unit-control button{
      min-width:40px;
      min-height:38px;
      padding:0 10px;
      border:1px solid rgba(214,184,120,.55);
      border-radius:9px;
      background:rgba(26,39,52,.96);
      color:#fff;
      font-size:20px;
      line-height:1;
      touch-action:manipulation;
    }
    .unit-control button:disabled{opacity:.34}
    .unit-control button:active:not(:disabled){transform:scale(.96)}
    .unit-control-label{
      min-width:86px;
      text-align:center;
      font-size:12px;
      line-height:1.25;
      white-space:nowrap;
    }
    .unit-control-label strong{
      display:block;
      margin-top:2px;
      font-size:14px;
      font-weight:800;
      color:#fff3cf;
    }
    .unit-altitude-row[hidden]{display:none!important}
    @media (max-width:700px){
      .unit-control{left:8px;bottom:calc(126px + env(safe-area-inset-bottom,0px));gap:4px;padding:6px}
      .unit-control button{min-width:38px;min-height:36px;padding:0 9px}
      .unit-control-label{min-width:72px}
    }
  `;
  document.head.appendChild(style);
}

function button(label,aria){
  const node=document.createElement("button");
  node.type="button";node.textContent=label;node.setAttribute("aria-label",aria);return node;
}

export class UnitControlUI{
  constructor(){
    ensureStyle();
    this.runtime=null;
    this.host=document.createElement("div");this.host.className="unit-control";this.host.hidden=true;

    this.facingRow=document.createElement("div");this.facingRow.className="unit-control-row";
    this.left=button("↺","角色向左旋轉");
    this.facingLabel=document.createElement("span");this.facingLabel.className="unit-control-label";
    this.right=button("↻","角色向右旋轉");
    this.facingRow.append(this.left,this.facingLabel,this.right);

    this.altitudeRow=document.createElement("div");this.altitudeRow.className="unit-control-row unit-altitude-row";this.altitudeRow.hidden=true;
    this.down=button("↓","降低飛行高度");
    this.altitudeLabel=document.createElement("span");this.altitudeLabel.className="unit-control-label";
    this.up=button("↑","提高飛行高度");
    this.altitudeRow.append(this.down,this.altitudeLabel,this.up);

    this.host.append(this.facingRow,this.altitudeRow);
    this.statusButton=button("狀態","開啟我方角色詳細資訊");
    this.statusButton.className="unit-status-toggle";
    this.statusButton.hidden=true;
    const rail=document.querySelector("#battleScreen .battle-right-rail");
    if(!rail)throw new Error("UnitControlUI requires .battle-right-rail.");
    rail.insertBefore(this.statusButton,rail.querySelector("#infoToggle"));
    this.statusRoot=document.createElement("div");
    this.statusRoot.className="unit-status-modal-root";
    this.statusUnitId=null;
    this.statusMarkup="";
    const battleScreen=document.getElementById("battleScreen");
    if(!battleScreen)throw new Error("UnitControlUI requires #battleScreen.");
    battleScreen.append(this.host,this.statusRoot);
    this.statusRoot.addEventListener("click",event=>{
      const close=event.target.closest?.("[data-close-hero-info]");
      if(!close)return;
      if(close.dataset.closeHeroInfo==="backdrop"&&event.target!==close)return;
      this.closeStatus();
    });
  }

  bind(runtime){
    this.runtime=runtime;
    this.left.onclick=()=>this.rotate(-1);this.right.onclick=()=>this.rotate(1);
    this.down.onclick=()=>this.changeAltitude(-1);this.up.onclick=()=>this.changeAltitude(1);
    this.statusButton.onclick=()=>this.openStatus();
    this.onRender=()=>this.render();
    window.addEventListener("cardtactics:battle-render",this.onRender);
    window.addEventListener("cardtactics:state",this.onRender);
    window.addEventListener("cardtactics:inspection",this.onRender);
    window.addEventListener("cardtactics:battle-screen-enter",this.onRender);
    window.addEventListener("keydown",event=>{if(event.key==="Escape"&&this.statusUnitId)this.closeStatus();});
    this.render();
  }

  selected(snapshot=this.runtime?.getBattleSnapshot?.()){
    if(!snapshot||snapshot.phase!=="PLAYER_TURN")return null;
    return(snapshot.units||[]).find(unit=>unit.selected&&unit.team==="PLAYER"&&!unit.finished)||null;
  }

  rotate(steps){
    const unit=this.selected();if(!unit)return false;
    const facing=globalThis.UnitRuntimeEngine?.rotateFacing?.(unit.id,steps);if(!facing)return false;
    this.runtime?.refresh?.();return true;
  }

  changeAltitude(steps){
    const unit=this.selected();if(!unit)return false;
    const state=globalThis.UnitRuntimeEngine?.adjustFlightAltitude?.(unit.id,steps);if(!state)return false;
    this.runtime?.refresh?.();return true;
  }

  // Pick the inspected friendly unit when present; otherwise use the selected
  // friendly unit. All data comes from the existing runtime snapshot/roster.
  statusUnit(snapshot=this.runtime?.getBattleSnapshot?.()){
    if(!snapshot)return null;
    const tile=snapshot.map?.tiles?.find(tile=>tile.inspected);
    const inspected=tile?(snapshot.units||[]).find(u=>u.team==="PLAYER"&&u.x===tile.x&&u.y===tile.y):null;
    const chosen=inspected||(snapshot.units||[]).find(u=>u.team==="PLAYER"&&u.selected)||null;
    return chosen?globalThis.UnitRuntimeEngine?.getLiveUnit?.(chosen.id)||null:null;
  }

  openStatus(){
    const unit=this.statusUnit();
    if(!unit||unit.team!=="PLAYER")return;
    this.statusUnitId=unit.id;
    this.renderStatus();
    this.statusRoot.querySelector(".hero-info-header button")?.focus();
  }

  closeStatus(){
    this.statusUnitId=null;
    this.statusMarkup="";
    this.statusRoot.replaceChildren();
    this.statusButton.focus();
  }

  renderStatus(){
    if(!this.statusUnitId)return;
    const unit=globalThis.UnitRuntimeEngine?.getLiveUnit?.(this.statusUnitId);
    if(!unit?.alive||unit.team!=="PLAYER"){this.closeStatus();return;}
    const card=Object.values(globalThis.CARDS||{}).find(c=>c.type==="CHARACTER"&&c.characterId===unit.character?.id)
      ||{name:unit.character?.name||"角色",characterId:unit.character?.id||null,cost:null};
    const markup=globalThis.CardTacticsHeroCard?.detail?.(card,{unit})||"";
    if(!markup||markup===this.statusMarkup)return;
    const scroll=this.statusRoot.querySelector(".hero-info-content")?.scrollTop||0;
    const opened=[...this.statusRoot.querySelectorAll(".hero-info-skill details")].map((node,i)=>node.open?i:-1).filter(i=>i>=0);
    this.statusRoot.innerHTML=markup;
    this.statusMarkup=markup;
    this.statusRoot.querySelectorAll(".hero-info-skill details").forEach((node,i)=>{node.open=opened.includes(i);});
    const content=this.statusRoot.querySelector(".hero-info-content");
    if(content)content.scrollTop=scroll;
  }

  render(){
    const snapshot=this.runtime?.getBattleSnapshot?.();
    const unit=this.selected(snapshot);
    this.host.hidden=!unit;
    const status=this.statusUnit(snapshot);
    this.statusButton.hidden=!status;
    this.statusButton.disabled=!status;
    this.renderStatus();
    if(!unit)return;
    const facing=String(unit.facing||"N").toUpperCase();
    this.facingLabel.innerHTML=`角色朝向<strong>${FACING_LABEL[facing]||facing}</strong>`;

    const flight=globalThis.UnitRuntimeEngine?.flightControl?.(unit.id)||null;
    this.altitudeRow.hidden=!flight;
    if(!flight)return;
    const altitude=Number(flight.altitude||0),min=Number(flight.min||0),max=Number(flight.max||0);
    this.altitudeLabel.innerHTML=`飛行高度<strong>H${altitude}</strong>`;
    this.down.disabled=altitude<=min+1e-9;
    this.up.disabled=altitude>=max-1e-9;
  }
}
