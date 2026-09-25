function q(id){return document.getElementById(id)}
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function phaseLabel(phase){return phase==="CARD_PHASE"?"卡牌階段":phase==="PLAYER_TURN"?"我方戰棋階段":phase==="ENEMY_TURN"?"敵方回合":phase==="MATCH_ENDED"?"戰鬥結束":phase||"—"}

export class BattleUI{
  constructor(){
    this.cardPanel=q("cardPhasePanel");this.logPanel=q("battleLog");this.inspectPanel=q("inspectionPanel");
    this.endTurn=q("endTurn");this.skillBar=q("skillBar");this.mapMeta=q("mapMeta");
    this.playerCore=q("playerCoreHp");this.enemyCore=q("enemyCoreHp");
    this.runtime=null;
  }
  bind(runtime){
    this.runtime=runtime;
    this.endTurn.onclick=()=>runtime.endPlayerTurn();
    window.addEventListener("cardtactics:battle-render",()=>this.render());
    window.addEventListener("cardtactics:state",()=>this.render());
    window.addEventListener("cardtactics:log",()=>this.renderLog());
    window.addEventListener("cardtactics:inspection",()=>this.renderInspection());
    this.render();
  }
  render(){
    if(!this.runtime)return;
    const snapshot=this.runtime.getBattleSnapshot();
    const phase=this.runtime.getPhase();
    const stage=this.runtime.getStage();
    const cores=this.runtime.getCores();
    const p=cores.find(c=>c.owner==="PLAYER"),e=cores.find(c=>c.owner==="ENEMY");
    this.playerCore.textContent=p?`${p.hp}/${p.maxHp}`:"—";
    this.enemyCore.textContent=e?`${e.hp}/${e.maxHp}`:"—";
    this.mapMeta.textContent=[
      snapshot?.map?`${snapshot.map.width}×${snapshot.map.height}`:"",
      stage?.generatedBattlefield?.seed!=null?`Seed ${stage.generatedBattlefield.seed}`:"",
      stage?.generatedBattlefield?.validation?`Validation ${stage.generatedBattlefield.validation}`:""
    ].filter(Boolean).join(" ｜ ");
    this.endTurn.disabled=phase!=="PLAYER_TURN";
    this.renderCards();
    this.renderEngagement();
    this.renderInspection();
    this.renderLog();
  }
  renderCards(){
    const phase=this.runtime.getPhase(),state=this.runtime.getCardState(),pending=this.runtime.getPendingCard();
    if(phase!=="CARD_PHASE"||!state){this.cardPanel.classList.remove("active");this.cardPanel.innerHTML="";return}
    this.cardPanel.classList.add("active");
    const hand=state.zones?.hand||[];
    const cards=hand.map(id=>globalThis.CardDatabase?.get?.(id)).filter(Boolean);
    this.cardPanel.innerHTML=`
      <div class="card-phase-head">
        <div>
          <strong>Card Phase</strong>
          <div class="card-phase-summary">💎 ${state.crystals}/${state.crystalCapacity} ｜ 手牌 ${hand.length} ｜ 牌庫 ${state.zones?.deck?.length||0}</div>
        </div>
        <div>${pending?`等待目標：${esc(pending.name)}`:"選擇卡牌"}</div>
      </div>
      <div class="hand"></div>
      <div class="card-phase-actions">
        <button data-card-action="cancel" ${pending?"":"disabled"}>取消選擇</button>
        <button data-card-action="end">結束卡牌階段</button>
      </div>`;
    const handEl=this.cardPanel.querySelector(".hand");
    for(const card of cards){
      const btn=document.createElement("button");
      btn.className="hand-card"+(pending?.id===card.id?" active":"");
      btn.disabled=!state.active||!state.zones.hand.includes(card.id)||state.crystals<Number(card.cost||0);
      btn.innerHTML=`<strong>${esc(card.name)}</strong><small>${esc(card.type)} ｜ 💎 ${Number(card.cost||0)}</small>`;
      btn.onclick=()=>this.runtime.playCard(card.id);
      handEl.appendChild(btn);
    }
    this.cardPanel.querySelector('[data-card-action="cancel"]').onclick=()=>this.runtime.cancelCard();
    this.cardPanel.querySelector('[data-card-action="end"]').onclick=()=>this.runtime.endCardPhase();
  }
  renderEngagement(){
    const model=this.runtime.getEngagementPresentation?.();
    if(!model?.actions?.length)return;
    this.skillBar.innerHTML="";
    const title=document.createElement("strong");title.textContent=model.skillName||"交戰";this.skillBar.appendChild(title);
    for(const action of model.actions){
      const btn=document.createElement("button");btn.textContent=action.label;btn.disabled=!!action.disabled;
      btn.onclick=()=>this.runtime.handleEngagementUIAction(action.id,action.payload||{});
      this.skillBar.appendChild(btn);
    }
  }
  renderInspection(){
    const unit=this.runtime.getInspectedUnitPresentation?.();
    const tile=this.runtime.getInspectedTilePresentation?.();
    if(unit){
      this.inspectPanel.textContent=[
        `${unit.name} ｜ ${unit.team}`,
        `HP ${unit.hp}/${unit.maxHp} ｜ MP ${unit.mana}/${unit.maxMana}`,
        `ATK ${unit.stats?.atk} / MATK ${unit.stats?.matk}`,
        `DEF ${unit.stats?.def} / MDEF ${unit.stats?.mdef}`,
        `MOVE ${unit.move} ｜ ${unit.actionState}`,
        tile?.summary||""
      ].filter(Boolean).join("\n");
    }else if(tile){
      this.inspectPanel.textContent=[tile.summary,...(tile.details||[])].filter(Boolean).join("\n");
    }else this.inspectPanel.textContent="點擊戰場查看資訊。";
  }
  renderLog(){
    const model=this.runtime.getBattleLog?.();if(!model)return;
    const entries=(model.entries||[]).slice(-28).reverse();
    this.logPanel.innerHTML=entries.map(entry=>`<div class="log-row ${esc(entry.type)}">${esc(entry.text)}</div>`).join("");
  }
}
