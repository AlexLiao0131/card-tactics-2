/**
 * PvP browser I/O only. Never derives authoritative movement, damage, card cost,
 * visibility or reaction legality. All commands are proposed to the server.
 * The production Worker does not enable this incomplete battle contract.
 */
import { CardDatabase } from './card-database.js';

const GAME_PHASES=new Set(['BATTLEFIELD_READY','PLAYER_CARD_PHASE','PLAYER_TACTICAL_PHASE',
  'ENEMY_CARD_PHASE','ENEMY_TACTICAL_PHASE','PVP_REACTION_PENDING','MATCH_ENDED']);
const UNIT_TEAM=['P','E'];
const text=(id,value)=>{if(id)id.textContent=value;};
function option(parent,value,label){const element=document.createElement('option');element.value=value;element.textContent=label;parent.append(element);}
function skillChoices(unit,followup=null){
  const skills=Array.isArray(unit?.attackSkills)?unit.attackSkills:[];
  return followup?.unitId===unit?.id
    ?skills.filter(skill=>skill.weaponSlot===followup.weaponSlot):skills;
}

export class PvpTacticalUI{
  constructor({root,canvas,seat,sendCommand,isConnected=()=>true,
    createBridge,ensureBabylon,onRendered=()=>{}}={}){
    if(!root||!canvas||![0,1].includes(seat)||typeof sendCommand!=='function'||
       typeof createBridge!=='function'||typeof ensureBabylon!=='function')
      throw Error('PVP_TACTICAL_UI_CONFIGURATION_REQUIRED');
    this.root=root;this.canvas=canvas;this.seat=seat;this.sendCommand=sendCommand;
    this.createBridge=createBridge;this.ensureBabylon=ensureBabylon;this.isConnected=isConnected;this.onRendered=onRendered;
    this.match=null;this.bridge=null;this.closed=false;this.selectedUnitId=null;this.presented=true;
    this.mode='SELECT';this.renderToken=0;this.newestRender=null;
    this.status=root.querySelector('[data-pvp-battle-status]');
    this.units=root.querySelector('[data-pvp-units]');
    this.cards=root.querySelector('[data-pvp-cards]');
    this.skills=root.querySelector('[data-pvp-skills]');
    this.effectSkills=root.querySelector('[data-pvp-effect-skills]');
    this.enchantments=root.querySelector('[data-pvp-enchantments]');
    this.enchantedAttacks=root.querySelector('[data-pvp-enchanted-attacks]');
    this.bloodShadow=root.querySelector('[data-pvp-blood-shadow]');
    this.bloodBurst=root.querySelector('[data-pvp-blood-burst]');
    this.areaFields=root.querySelector('[data-pvp-area-fields]');
    this.mapSkills=root.querySelector('[data-pvp-map-skills]');
    this.transports=root.querySelector('[data-pvp-transports]');
    this.perceptionSkills=root.querySelector('[data-pvp-perception-skills]');
    this.bloodMemory=root.querySelector('[data-pvp-blood-memory]');
    this.instantCards=root.querySelector('[data-pvp-instant-cards]');
    this.targetCards=root.querySelector('[data-pvp-target-cards]');
    this.reactions=root.querySelector('[data-pvp-reactions]');
    this.buttons=Object.fromEntries([...root.querySelectorAll('[data-pvp-action]')]
      .map(b=>[b.dataset.pvpAction,b]));
    for(const [name,button] of Object.entries(this.buttons)){
      button.addEventListener('click',()=>this.handleAction(name));
    }
  }
  isActive(){return GAME_PHASES.has(this.match?.view?.phase);}
  // Game shell alone owns screen visibility. Incoming socket states never
  // display PvP controls above offline games or deck preparation screens.
  setPresented(value){
    this.presented=!!value;
    this.root.hidden=!(this.presented&&this.isActive());
    if(this.presented&&this.isActive())this.update();
  }
  myTurn(){return this.match?.view?.activeSeat===this.seat;}
  isCardPhase(){return this.match?.view?.phase===['PLAYER_CARD_PHASE','ENEMY_CARD_PHASE'][this.seat];}
  isTacticalPhase(){return this.match?.view?.phase===['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'][this.seat];}
  selectedUnit(){return this.match?.view?.units?.find(u=>u.id===this.selectedUnitId)||null;}
  receiveMatch(match){
    if(this.closed||match?.view?.seat!==this.seat||!Number.isSafeInteger(match.revision))return false;
    if(this.match && match.revision<this.match.revision)return false;
    this.match=match;this.root.hidden=!(this.presented&&this.isActive());
    this.update();return true;
  }
  update(){
    const v=this.match?.view;
    if(!this.isActive())return;
    // All selectors are authoritative choices. Redrawing the current server
    // view may invalidate an option, but must never silently replace a still-
    // legal player choice with the first weapon, card, reaction or target.
    const selectors=[this.cards,this.skills,this.effectSkills,this.enchantments,
      this.enchantedAttacks,this.bloodShadow,this.bloodBurst,this.areaFields,
      this.mapSkills,this.transports,this.perceptionSkills,this.bloodMemory,
      this.instantCards,this.targetCards,this.reactions].filter(Boolean);
    const selectedChoices=new Map(selectors.map(select=>[select,select.value]));
    const canAct=this.myTurn()&&this.isConnected();
    const unit=this.selectedUnit(),mine=unit?.team===UNIT_TEAM[this.seat];
    const isReaction=v.phase==='PVP_REACTION_PENDING'&&canAct;
    const cardPhase=this.isCardPhase()&&canAct,tactical=this.isTacticalPhase()&&canAct;
    const ready=v.phase==='BATTLEFIELD_READY'&&this.seat===0&&this.isConnected();
    const followup=v.enchantmentFollowup||null;
    const memoryChoice=v.bloodMemoryChoice||null;
    const ownFollowup=followup?.unitId===unit?.id;
    const normalTurn=tactical&&!followup&&!memoryChoice;
    const currentActor=tactical&&!memoryChoice&&(!followup||ownFollowup);
    const hand=v.own?.hand||[];
    this.cards.replaceChildren();
    for(const [index,card] of hand.entries())if(CardDatabase.isCharacter(CardDatabase.get(card.id))){
      option(this.cards,String(index),`${card.name}（${card.cost??'?'} 水晶）`);
    }
    if(this.instantCards){
      this.instantCards.replaceChildren();
      for(const [index,entry] of hand.entries()){
        const card=CardDatabase.get(entry.id);
        if(CardDatabase.isSpell(card)&&['WEATHER','STEAL_HAND'].includes(card.effect?.type))
          option(this.instantCards,String(index),`${entry.name}（${entry.cost??'?'} 水晶）`);
      }
    }
    if(this.targetCards){
      this.targetCards.replaceChildren();
      for(const [index,entry] of hand.entries()){
        const card=CardDatabase.get(entry.id);
        if(CardDatabase.isSpell(card)&&['AREA_HEAL','AREA_BUFF','DISPEL',
           'AREA_RELATION','HYDROLOGY_FLOOD','WHIRLPOOL','AREA_FIRE','AREA_PUSH','AREA_DAMAGE']
           .includes(card.effect?.type))
          option(this.targetCards,String(index),`${entry.name}（${entry.cost??'?'} 水晶）`);
      }
    }
    this.skills.replaceChildren();
    for(const skill of skillChoices(unit,followup))option(this.skills,skill.id,skill.name);
    if(this.effectSkills){
      this.effectSkills.replaceChildren();
      for(const skill of unit?.effectSkills||[])option(this.effectSkills,skill.id,skill.name);
    }
    if(this.enchantments){
      this.enchantments.replaceChildren();
      if(!followup)for(const entry of unit?.enchantmentOptions||[]){
        const choice={skillId:entry.skillId,variantId:entry.variantId,
          targetId:entry.targetId,weaponSlot:entry.weaponSlot};
        option(this.enchantments,JSON.stringify(choice),
          `${entry.skillName}｜${entry.targetName}｜${entry.weaponName}`);
      }
    }
    if(this.enchantedAttacks){
      this.enchantedAttacks.replaceChildren();
      for(const skill of unit?.enchantedTerrainSkills||[]){
        if(followup&&!ownFollowup)continue;
        if(ownFollowup&&skill.weaponSlot!==followup.weaponSlot)continue;
        option(this.enchantedAttacks,skill.id,skill.name);
      }
    }
    if(this.bloodShadow){
      this.bloodShadow.replaceChildren();
      if(!memoryChoice&&!followup)for(const entry of unit?.bloodShadowOptions||[]){
        option(this.bloodShadow,JSON.stringify({skillId:entry.skillId,targetId:entry.targetId}),
          `${entry.skillName} → ${entry.targetName}`);
      }
    }
    if(this.bloodBurst){
      this.bloodBurst.replaceChildren();
      if(!memoryChoice&&!followup)for(const skill of unit?.bloodBurstSkills||[])
        option(this.bloodBurst,skill.id,skill.name);
    }
    if(this.mapSkills){
      this.mapSkills.replaceChildren();
      if(!memoryChoice&&!followup)for(const skill of unit?.mapSkills||[])
        option(this.mapSkills,skill.id,skill.name);
    }
    if(this.transports){
      this.transports.replaceChildren();
      if(!memoryChoice&&!followup)for(const entry of unit?.transportOptions||[]){
        option(this.transports,JSON.stringify({skillId:entry.skillId,targetId:entry.targetId}),
          `${entry.skillName} → ${entry.targetName}`);
      }
    }
    if(this.perceptionSkills){
      this.perceptionSkills.replaceChildren();
      if(!memoryChoice&&!followup)for(const skill of unit?.perceptionSkills||[])
        option(this.perceptionSkills,skill.id,skill.name);
    }
    if(this.areaFields){
      this.areaFields.replaceChildren();
      if(!memoryChoice&&!followup)for(const skill of unit?.areaFieldSkills||[])
        option(this.areaFields,skill.id,skill.name);
    }
    if(this.bloodMemory){
      this.bloodMemory.replaceChildren();
      if(memoryChoice){
        option(this.bloodMemory,'','略過本次血液記憶');
        for(const entry of memoryChoice.options||[])option(this.bloodMemory,entry.id,entry.name);
      }
    }
    this.reactions.replaceChildren();
    const opts=v.reactionOptions;
    if(isReaction&&opts){
      for(const value of opts.choices||[]){
        if(value==='ACCEPT'||value==='EVADE')option(this.reactions,value,value==='ACCEPT'?'接受攻擊':'迴避');
      }
      for(const x of opts.defenses||[])option(this.reactions,`DEFENSE|${x.id}`,`防禦：${x.name}`);
      for(const x of opts.counters||[])option(this.reactions,`COUNTER|${x.id}`,`反擊：${x.name}`);
      for(const g of opts.guardians||[])for(const x of g.methods||[]){
        option(this.reactions,`GUARD|${g.guardianId}|${x.id}`,`援護：${g.guardianId}／${x.name}`);
      }
    }
    for(const [name,button] of Object.entries(this.buttons)){
      let enabled=false;
      if(name==='BEGIN')enabled=ready;
      else if(name==='DEPLOY')enabled=cardPhase&&this.cards.options.length>0;
      else if(name==='INSTANT')enabled=cardPhase&&!!this.instantCards?.options.length;
      else if(name==='TARGET_CARD')enabled=cardPhase&&!!this.targetCards?.options.length;
      else if(name==='END_CARD')enabled=cardPhase;
      else if(name==='MOVE')enabled=normalTurn&&mine&&!unit.acted&&!unit.moved;
      else if(name==='ATTACK')enabled=currentActor&&mine&&!unit.acted&&this.skills.options.length>0;
      else if(name==='EFFECT')enabled=normalTurn&&mine&&!unit.acted&&
        !!this.effectSkills?.options.length;
      else if(name==='CORE')enabled=currentActor&&mine&&!unit.acted&&this.skills.options.length>0;
      else if(name==='ENCHANT')enabled=normalTurn&&mine&&!unit.acted&&!!this.enchantments?.options.length;
      else if(name==='TERRAIN')enabled=currentActor&&mine&&!unit.acted&&!!this.enchantedAttacks?.options.length;
      else if(name==='FINISH_ENCHANT')enabled=currentActor&&mine&&ownFollowup;
      else if(name==='BLOOD_SHADOW')enabled=normalTurn&&mine&&!unit.acted&&!!this.bloodShadow?.options.length;
      else if(name==='BLOOD_BURST')enabled=normalTurn&&mine&&!unit.acted&&!!this.bloodBurst?.options.length;
      else if(name==='AREA_FIELD')enabled=normalTurn&&mine&&!unit.acted&&!!this.areaFields?.options.length;
      else if(name==='MAP_SKILL')enabled=normalTurn&&mine&&!unit.acted&&!!this.mapSkills?.options.length;
      else if(name==='TRANSPORT')enabled=normalTurn&&mine&&!unit.acted&&!!this.transports?.options.length;
      else if(name==='PERCEPTION')enabled=normalTurn&&mine&&!unit.acted&&!!this.perceptionSkills?.options.length;
      else if(name==='BLOOD_MEMORY')enabled=tactical&&!!memoryChoice&&!!this.bloodMemory?.options.length;
      else if(name==='CAPTURE'||name==='WAIT')enabled=normalTurn&&mine&&!unit.acted;
      else if(name==='END_TACTICAL')enabled=normalTurn;
      else if(name==='REACT')enabled=isReaction&&this.reactions.options.length>0;
      button.disabled=!enabled;
    }
    for(const [select,previous] of selectedChoices){
      if(Array.from(select.options).some(option=>option.value===previous))select.value=previous;
    }
    const unitName=unit?.characterId||unit?.id||'未選取角色';
    text(this.status,`Round ${v.round??1}｜${v.phase}｜${canAct?'輪到你操作':'等待對手'}｜`+
      `水晶 ${v.own?.crystals??'?'}｜${unitName}｜模式 ${this.mode}`);
  }
  request(action){
    if(!this.isConnected())return false;
    if(!this.myTurn() && !(action?.type==='BEGIN_BATTLE' &&
      this.match?.view?.phase==='BATTLEFIELD_READY' && this.seat===0))return false;
    return this.sendCommand(action);
  }
  handleAction(name){
    const unit=this.selectedUnit();
    if(name==='BEGIN')this.request({type:'BEGIN_BATTLE'});
    else if(name==='END_CARD')this.request({type:'END_CARD_PHASE'});
    else if(name==='INSTANT'){
      const card=this.match?.view?.own?.hand?.[Number(this.instantCards?.value)];
      if(card?.id)this.request({type:'PLAY_INSTANT_CARD',cardId:card.id});
    }
    else if(name==='END_TACTICAL')this.request({type:'END_TACTICAL_PHASE'});
    else if(name==='CAPTURE'&&unit)this.request({type:'CAPTURE_POINT',unitId:unit.id});
    else if(name==='WAIT'&&unit)this.request({type:'WAIT_UNIT',unitId:unit.id});
    else if(name==='ENCHANT'&&unit&&this.enchantments?.value){
      const choice=JSON.parse(this.enchantments.value);
      this.request({type:'CAST_ENCHANTMENT',unitId:unit.id,...choice});
    }
    else if(name==='BLOOD_SHADOW'&&unit&&this.bloodShadow?.value){
      const choice=JSON.parse(this.bloodShadow.value);
      this.request({type:'CAST_BLOOD_SHADOW',unitId:unit.id,...choice});
    }
    else if(name==='BLOOD_BURST'&&unit&&this.bloodBurst?.value)
      this.request({type:'CAST_BLOOD_BURST',unitId:unit.id,skillId:this.bloodBurst.value});
    else if(name==='AREA_FIELD'&&unit&&this.areaFields?.value)
      this.request({type:'CAST_AREA_FIELD',unitId:unit.id,skillId:this.areaFields.value});
    else if(name==='BLOOD_MEMORY'&&this.match?.view?.bloodMemoryChoice){
      this.request({type:'CHOOSE_BLOOD_MEMORY',
        unitId:this.match.view.bloodMemoryChoice.unitId,skillId:this.bloodMemory?.value||null});
    }
    else if(name==='FINISH_ENCHANT'&&unit)
      this.request({type:'END_ENCHANT_FOLLOWUP',unitId:unit.id});
    else if(name==='REACT'){
      const [reaction,first,second]=String(this.reactions.value||'').split('|');
      if(reaction==='ACCEPT'||reaction==='EVADE')this.request({type:'REACT_ATTACK',reaction});
      else if(reaction==='COUNTER')this.request({type:'REACT_ATTACK',reaction,skillId:first});
      else if(reaction==='DEFENSE')this.request({type:'REACT_ATTACK',reaction,methodId:first});
      else if(reaction==='GUARD')this.request({type:'REACT_ATTACK',reaction,guardianId:first,methodId:second});
    }else if(['MOVE','ATTACK','DEPLOY','CORE','EFFECT','TARGET_CARD','TERRAIN','MAP_SKILL','TRANSPORT','PERCEPTION'].includes(name)){
      this.mode=name;this.update();
    }
  }
  tilePicked({seat,x,y}={}){
    const v=this.match?.view;
    if(seat!==this.seat||!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||!this.myTurn())return;
    const unit=v.units?.find(u=>u.x===x&&u.y===y&&u.alive!==false);
    if(this.isCardPhase()&&this.mode==='DEPLOY'){
      const card=v.own.hand[Number(this.cards.value)];
      if(card?.id)this.request({type:'DEPLOY_CARD',cardId:card.id,x,y});
    }else if(this.isCardPhase()&&this.mode==='TARGET_CARD'){
      const card=v.own.hand[Number(this.targetCards?.value)];
      if(card?.id)this.request({type:'PLAY_TARGET_CARD',cardId:card.id,x,y});
      this.mode='SELECT';
    }else if(this.isTacticalPhase()&&this.mode==='MOVE'&&this.selectedUnitId){
      this.request({type:'MOVE_UNIT',unitId:this.selectedUnitId,x,y});this.mode='SELECT';
    }else if(this.isTacticalPhase()&&this.mode==='ATTACK'&&this.selectedUnitId&&unit){
      if(unit.team!==UNIT_TEAM[this.seat])
        this.request({type:'DECLARE_ATTACK',attackerId:this.selectedUnitId,
          targetId:unit.id,skillId:this.skills.value});
      this.mode='SELECT';
    }else if(this.isTacticalPhase()&&this.mode==='EFFECT'&&this.selectedUnitId&&unit){
      if(unit.team===UNIT_TEAM[this.seat])
        this.request({type:'CAST_EFFECT_SKILL',unitId:this.selectedUnitId,
          targetId:unit.id,skillId:this.effectSkills?.value});
      this.mode='SELECT';
    }else if(this.isTacticalPhase()&&this.mode==='MAP_SKILL'&&this.selectedUnitId){
      if(this.mapSkills?.value)
        this.request({type:'CAST_MAP_SKILL',unitId:this.selectedUnitId,
          skillId:this.mapSkills.value,x,y});
      this.mode='SELECT';
    }else if(this.isTacticalPhase()&&this.mode==='PERCEPTION'&&this.selectedUnitId&&unit){
      if(unit.team!==UNIT_TEAM[this.seat]&&this.perceptionSkills?.value)
        this.request({type:'CAST_PERCEPTION',unitId:this.selectedUnitId,
          targetId:unit.id,skillId:this.perceptionSkills.value});
      this.mode='SELECT';
    }else if(this.isTacticalPhase()&&this.mode==='TRANSPORT'&&this.selectedUnitId){
      if(this.transports?.value){
        const choice=JSON.parse(this.transports.value);
        this.request({type:'CAST_TRANSPORT',unitId:this.selectedUnitId,...choice,x,y});
      }
      this.mode='SELECT';
    }else if(this.isTacticalPhase()&&this.mode==='TERRAIN'&&this.selectedUnitId){
      if(this.enchantedAttacks?.value)
        this.request({type:'ATTACK_ENCHANTED_TERRAIN',unitId:this.selectedUnitId,
          skillId:this.enchantedAttacks.value,x,y});
      this.mode='SELECT';
    }else if(this.isTacticalPhase()&&this.mode==='CORE'&&this.selectedUnitId){
      const core=v.battlefield?.cores?.find(c=>c.x===x&&c.y===y);
      if(core)this.request({type:'ATTACK_CORE',unitId:this.selectedUnitId,
        skillId:this.skills.value,coreOwner:core.owner});
      this.mode='SELECT';
    }else if(!v.bloodMemoryChoice&&unit&&unit.team===UNIT_TEAM[this.seat]&&
      (!v.enchantmentFollowup||v.enchantmentFollowup.unitId===unit.id)){
      this.selectedUnitId=unit.id;this.mode='SELECT';
    }
    this.update();
  }
  async receiveRender(packet){
    if(this.closed||!this.match||packet?.seat!==this.seat||
       !Number.isSafeInteger(packet.revision)||packet.revision<this.match.revision)
      return false;
    this.newestRender=packet;
    const token=++this.renderToken;
    try{
      await this.ensureBabylon();
      if(this.closed||token!==this.renderToken||packet!==this.newestRender)return false;
      if(!this.bridge)this.bridge=await this.createBridge({
        canvas:this.canvas,seat:this.seat,onTilePicked:p=>this.tilePicked(p)
      });
      if(this.closed||token!==this.renderToken)return false;
      const updated=this.bridge.accept(packet);
      if(updated)this.onRendered(packet.snapshot);
      return updated;
    }catch(error){
      text(this.status,`3D 畫面尚無法建立：${error.message}`);
      return false;
    }
  }
  close(){
    if(this.closed)return;
    this.closed=true;this.renderToken++;
    this.bridge?.close();this.bridge=null;this.root.hidden=true;
  }
}
