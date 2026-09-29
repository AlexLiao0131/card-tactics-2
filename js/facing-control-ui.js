const FACING_LABEL=Object.freeze({N:"北",E:"東",S:"南",W:"西"});

function ensureStyle(){
  if(document.getElementById("unit-facing-control-style"))return;
  const style=document.createElement("style");
  style.id="unit-facing-control-style";
  style.textContent=`
    .unit-facing-control{
      position:absolute;
      left:12px;
      bottom:calc(138px + env(safe-area-inset-bottom,0px));
      z-index:48;
      display:flex;
      align-items:center;
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
    .unit-facing-control[hidden]{display:none!important}
    .unit-facing-control button{
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
    .unit-facing-control button:active{transform:scale(.96)}
    .unit-facing-control span{
      min-width:74px;
      text-align:center;
      font-size:12px;
      line-height:1.25;
      white-space:nowrap;
    }
    .unit-facing-control strong{
      display:block;
      margin-top:2px;
      font-size:14px;
      font-weight:800;
      color:#fff3cf;
    }
    @media (max-width:700px){
      .unit-facing-control{
        left:8px;
        bottom:calc(126px + env(safe-area-inset-bottom,0px));
        gap:4px;
        padding:6px;
      }
      .unit-facing-control button{min-width:38px;min-height:36px;padding:0 9px}
      .unit-facing-control span{min-width:64px}
    }
  `;
  document.head.appendChild(style);
}

export class FacingControlUI{
  constructor(){
    ensureStyle();
    this.runtime=null;
    this.host=document.createElement("div");
    this.host.className="unit-facing-control";
    this.host.hidden=true;
    this.left=document.createElement("button");
    this.left.type="button";
    this.left.textContent="↺";
    this.left.setAttribute("aria-label","角色向左旋轉");
    this.label=document.createElement("span");
    this.right=document.createElement("button");
    this.right.type="button";
    this.right.textContent="↻";
    this.right.setAttribute("aria-label","角色向右旋轉");
    this.host.append(this.left,this.label,this.right);
    const battleScreen=document.getElementById("battleScreen");
    if(!battleScreen)throw new Error("FacingControlUI requires #battleScreen.");
    battleScreen.appendChild(this.host);
  }

  bind(runtime){
    this.runtime=runtime;
    this.left.onclick=()=>this.rotate(-1);
    this.right.onclick=()=>this.rotate(1);
    this.onRender=()=>this.render();
    window.addEventListener("cardtactics:battle-render",this.onRender);
    window.addEventListener("cardtactics:state",this.onRender);
    window.addEventListener("cardtactics:battle-screen-enter",this.onRender);
    this.render();
  }

  selected(){
    const snapshot=this.runtime?.getBattleSnapshot?.();
    if(!snapshot||snapshot.phase!=="PLAYER_TURN")return null;
    return (snapshot.units||[]).find(unit=>unit.selected&&unit.team==="PLAYER"&&!unit.finished)||null;
  }

  rotate(steps){
    const unit=this.selected();
    if(!unit)return false;
    const facing=globalThis.UnitRuntimeEngine?.rotateFacing?.(unit.id,steps);
    if(!facing)return false;
    this.runtime?.refresh?.();
    return true;
  }

  render(){
    const unit=this.selected();
    this.host.hidden=!unit;
    if(!unit)return;
    const facing=String(unit.facing||"N").toUpperCase();
    this.label.innerHTML=`角色朝向<strong>${FACING_LABEL[facing]||facing}</strong>`;
  }
}
