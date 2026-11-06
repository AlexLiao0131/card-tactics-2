/**
 * Network input adapter for the ORIGINAL tactical UI.
 * All modes use #battleScreen, #skillBar, the same BattleCommandMenuUI
 * button presenter and CardHandUI. Only command source differs: PvP submits
 * identifiers published by the canonical server, never local rule outcomes.
 */
import { CardDatabase } from './card-database.js';
import './terrain-database.js';
import { DeploymentEngine } from './deployment-engine.js';
import './card-phase-controller.js';
import { SkillDatabase } from './skill-database.js';
import { TILE_SIZE,ELEVATION_HEIGHT,UNIT_VISUAL_HEIGHT } from './coordinate-system.js';
import { BattleCommandMenuUI, battleCommandEntries, battleSkillCategory, battleSkillButtonLabel, battleItemMenuEntries, enchantmentRecipientGroups, enchantRecipientMark, enchantWeaponIcon, createEnchantmentRecipientMarker } from './battle-command-menu-ui.js';

const GAME_PHASES=new Set(['BATTLEFIELD_READY','PLAYER_CARD_PHASE','PLAYER_TACTICAL_PHASE',
  'ENEMY_CARD_PHASE','ENEMY_TACTICAL_PHASE','PVP_REACTION_PENDING','MATCH_ENDED']);
const UNIT_TEAM=['P','E'];
const CARD_PHASE=['PLAYER_CARD_PHASE','ENEMY_CARD_PHASE'];
const TACTICAL_PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const nameOf=unit=>unit?.name||unit?.character?.name||unit?.characterId||unit?.id||'角色';
const skillChoices=(unit,followup)=>{
  const skills=unit?.attackSkills||[];
  return followup?.unitId===unit?.id
    ?skills.filter(skill=>skill.weaponSlot===followup.weaponSlot):skills;
};
const knownSkill=id=>{try{return SkillDatabase.get(id);}catch{return null;}};
const supportedSkillsForSection=(unit,section)=>skillChoices(unit)
  .filter(entry=>battleSkillCategory(knownSkill(entry.id))===section);

export class PvpTacticalUI {
  constructor({root,canvas,seat,sendCommand,isConnected=()=>true,createBridge,ensureBabylon,
    onRendered=()=>{},onInspect=()=>{},onSelection=()=>{},onRenderFailure=()=>{}}={}){
    if(!root||root.id!=='skillBar'||!canvas||![0,1].includes(seat)||
       typeof sendCommand!=='function'||typeof createBridge!=='function'||typeof ensureBabylon!=='function')
      throw Error('NATIVE_TACTICAL_MENU_REQUIRED');
    this.root=root;this.menuUI=new BattleCommandMenuUI(root);
    this.canvas=canvas;this.seat=seat;this.sendCommand=sendCommand;
    this.isConnected=isConnected;this.createBridge=createBridge;this.ensureBabylon=ensureBabylon;
    this.onRendered=onRendered;this.onInspect=onInspect;this.onSelection=onSelection;
    this.onRenderFailure=onRenderFailure;
    this.match=null;this.bridge=null;this.closed=false;this.presented=false;
    this.selectedUnitId=null;this.mode='SELECT';this.menu='command';this.target=null;
    this.renderToken=0;this.newestRender=null;this.serverSnapshot=null;
    this.enchantIdentities=new Map();this.enchantCounters=new Map();
    this.enchantMarkers=new Map();this.enchantMarkerRoot=null;
    this.enchantMarkerScene=null;this.enchantMarkerObserver=null;this.enchantCandidates=[];
  }
  isActive(){return GAME_PHASES.has(this.match?.view?.phase);}
  myTurn(){return this.match?.view?.activeSeat===this.seat;}
  isCardPhase(){return this.match?.view?.phase===CARD_PHASE[this.seat];}
  isTacticalPhase(){return this.match?.view?.phase===TACTICAL_PHASE[this.seat];}
  selectedUnit(){return this.match?.view?.units?.find(unit=>unit.id===this.selectedUnitId)||null;}
  setPresented(value){
    this.presented=!!value;
    if(!this.presented){this.clearEnchantmentMarkers();this.menuUI.clear();this.onSelection(null,{canAct:false});return;}
    this.update();this.publishSelection();this.refreshNativePresentation();
  }
  receiveMatch(match){
    if(this.closed||match?.view?.seat!==this.seat||!Number.isSafeInteger(match.revision))return false;
    if(this.match&&match.revision<this.match.revision)return false;
    const previous=this.match?.view?.phase;
    this.match=match;
    const selected=this.selectedUnit();
    if(previous!==match.view.phase || (this.selectedUnitId&&!selected))this.cancelTarget({clearSelection:!selected});
    if(selected?.acted&&!match.view.enchantmentFollowup && this.mode!=='SELECT')this.cancelTarget();
    this.update();this.publishSelection();this.refreshNativePresentation();return true;
  }
  cancelTarget({clearSelection=false}={}){
    this.mode='SELECT';this.menu='command';this.target=null;
    if(clearSelection)this.selectedUnitId=null;
  }
  chooseCard(cardId){
    if(!this.isCardPhase()||!this.myTurn()||!this.isConnected())return false;
    const available=this.match.view.own?.hand||[];
    if(!available.some(card=>card.id===cardId))return false;
    const card=CardDatabase.get(cardId);
    if(CardDatabase.isCharacter(card)){
      this.mode='DEPLOY';this.target={cardId};this.update();
      if(!this.refreshNativePresentation()&&this.presented&&
         (!this.bridge?.renderer||!this.serverSnapshot||!this.samePublicBattlefield(this.serverSnapshot)))
        this.reportRenderFailure('PVP_DEPLOYMENT_RENDER_NOT_READY');
      return 'TARGET';
    }
    const commandKind=globalThis.CardPhaseController?.commandKind?.(card);
    if(commandKind==='INSTANT')
      return this.request({type:'PLAY_INSTANT_CARD',cardId})?'SENT':false;
    if(commandKind==='TARGETED'){
      this.mode='TARGET_CARD';this.target={cardId};this.update();return 'TARGET';
    }
    // Unknown types fail closed; the server owns its allowed card actions.
    return false;
  }
  cancelCardTarget(){this.cancelTarget();this.update();this.refreshNativePresentation();}
  /** The seat-private server projection is authoritative. Older Workers that
   * predate deployableTiles can be shown via the SAME official DeploymentEngine,
   * using only server-published map/ownership. The server still validates each
   * command, so this read-only compatibility path grants no gameplay authority.
   */
  deploymentTiles(){
    const v=this.match?.view;
    if(Array.isArray(v?.deployableTiles))return v.deployableTiles;
    const battlefield=v?.battlefield;
    const map=battlefield?.map||this.serverSnapshot?.map;
    const stage={deploymentPoints:battlefield?.deploymentPoints};
    if(!Array.isArray(map?.tiles)||!Array.isArray(stage.deploymentPoints))return null;
    const owner=this.seat===0?'PLAYER':'ENEMY';
    return DeploymentEngine.area(stage,owner).filter(tile=>
      DeploymentEngine.canDeploy({stage,map,units:v?.units||[],owner,x:tile.x,y:tile.y}));
  }

  request(action){
    if(!this.isConnected())return false;
    if(!this.myTurn()&&!(action?.type==='BEGIN_BATTLE'&&
       this.match?.view?.phase==='BATTLEFIELD_READY'&&this.seat===0))return false;
    return this.sendCommand(action);
  }
  nextUnit(){
    if(!this.isTacticalPhase()||!this.myTurn())return false;
    const units=(this.match?.view?.units||[]).filter(unit=>unit.alive!==false&&
      unit.team===UNIT_TEAM[this.seat]&&!unit.acted&&!unit.waited);
    if(!units.length)return false;
    const index=units.findIndex(unit=>unit.id===this.selectedUnitId);
    this.selectedUnitId=units[(index+1)%units.length].id;
    this.cancelTarget();this.clearEnchantmentMarkers();this.update();this.publishSelection();this.refreshNativePresentation();return true;
  }
  endPhase(){
    if(this.isTacticalPhase()&&this.myTurn())return this.request({type:'END_TACTICAL_PHASE'});
    return false; // CardHandUI owns the original card phase's end button.
  }
  selectUnit(unitId){
    const unit=this.match?.view?.units?.find(candidate=>candidate.id===unitId);
    if(!unit||unit.alive===false||unit.team!==UNIT_TEAM[this.seat])return false;
    this.selectedUnitId=unit.id;this.cancelTarget();this.update();this.publishSelection();
    // Log the server-owned action flags alongside the render revision. If
    // movement is absent, the exported diagnostics now identify whether the
    // authority locked this unit or Babylon failed to publish its overlay.
    globalThis.CardTacticsDiagnostics?.push?.('PVP_MOVE_SELECTION',{
      seat:this.seat,revision:this.match.revision,phase:this.match.view.phase,
      unitId:unit.id,moved:!!unit.moved,acted:!!unit.acted,waited:!!unit.waited,
      reachableTiles:Array.isArray(unit.reachableTiles)?unit.reachableTiles.length:null,
      renderRevision:this.serverSnapshot?.revision??null
    });
    if(!this.refreshNativePresentation()&&this.presented&&
       (!this.bridge?.renderer||!this.serverSnapshot||!this.samePublicBattlefield(this.serverSnapshot)))
      this.reportRenderFailure('PVP_SELECTION_RENDER_NOT_READY');
    return true;
  }
  reportRenderFailure(reason){
    const revision=this.match?.revision;
    if(!this.presented||!Number.isSafeInteger(revision))return false;
    globalThis.CardTacticsDiagnostics?.push?.('PVP_RENDER_REJECTED',{
      seat:this.seat,revision,reason,
      rendererStages:[...(this.bridge?.renderer?.presentationCommitHistory?.at(-1)?.failedStages||[])]
    });
    this.onRenderFailure({seat:this.seat,revision},new Error(reason));
    return true;
  }
  publishSelection(){
    const unit=this.presented&&this.isTacticalPhase()?this.selectedUnit():null;
    this.onSelection(unit,{canAct:!!(unit&&!unit.acted&&!unit.waited&&this.myTurn()&&this.isConnected())});
  }
  // The ORIGINAL HighlightRenderer and UnitHudOverlay consume the official
  // Babylon snapshot. Selection is a local view choice; reachability is
  // computed by the SERVER's own TacticalEngine and never guessed here.
  // The smaller MATCH_STATE is intentionally delivered before the expensive
  // 3D render. The existing geometry can still show the NEW authority's
  // reachable/owned cells while the corresponding full snapshot is in flight.
  samePublicBattlefield(snapshot){
    const expected=this.match?.view?.battlefield?.map,actual=snapshot?.map;
    return !!(expected&&actual&&typeof expected.id==='string'&&
      actual.id===expected.id&&actual.width===expected.width&&
      actual.height===expected.height);
  }
  refreshNativePresentation(){
    const renderer=this.bridge?.renderer,source=this.serverSnapshot;
    if(!this.presented||!renderer||!source||!this.match||
       source.revision>this.match.revision||!this.samePublicBattlefield(source))return false;
    const unit=this.isTacticalPhase()&&this.myTurn()?this.selectedUnit():null;
    const reachable=new Set(unit&&!unit.moved&&!unit.acted&&!unit.waited
      ?(unit.reachableTiles||[]).map(t=>`${t.x},${t.y}`):[]);
    const deploying=this.isCardPhase()&&this.myTurn()&&
      this.mode==='DEPLOY'&&!!this.target?.cardId;
    const deployable=new Set(deploying
      ?(this.deploymentTiles()||[]).map(t=>`${t.x},${t.y}`):[]);
    // MATCH_STATE already carries the public, server-owned sites. Reconcile
    // their current owners even if a rendered frame is one revision behind;
    // do not infer colors from seat or invent a client deployment rule.
    const areaOwner=new Map();
    for(const point of this.match.view.battlefield?.deploymentPoints||[]){
      if(!['PLAYER','ENEMY','NEUTRAL'].includes(point.owner))continue;
      for(const cell of point.area||[]){
        const key=`${cell.x},${cell.y}`;
        if(!areaOwner.has(key))areaOwner.set(key,point.owner);
      }
    }
    const tiles=source.map.tiles.map(tile=>{
      const key=`${tile.x},${tile.y}`;
      return {...tile,reachable:reachable.has(key),
        deploymentAreaOwner:areaOwner.get(key)??tile.deploymentAreaOwner??null,
        // The canonical server owns legality. Not every colored home area is
        // selectable (some cells are blocked, occupied or enemy-owned).
        deployable:deployable.has(key)};
    });
    const view={...source,map:{...source.map,tiles},units:source.units.map(u=>({
      ...u,selected:!!(unit&&u.id===unit.id)
    }))};
    // No terrain/water redraw for a local selection. Reuse the exact native
    // overlay/HUD/anchor consumers and their existing geometry/DOM nodes.
    // Delegate every interactive overlay to the SAME BabylonRenderer used by
    // local/Gemini. Do not maintain a parallel online HUD/highlight renderer.
    if(typeof renderer.syncInteractionPresentation==='function'){
      // A failed native overlay commit is NOT a successful selection. The
      // canonical renderer already knows which subsystem failed; ask the same
      // WebSocket authority for another full presentation instead of silently
      // leaving the actor with no reachable cells or deployment color.
      if(renderer.syncInteractionPresentation(view)!==true){
        this.reportRenderFailure('PVP_INTERACTION_RENDER_INCOMPLETE');
        return false;
      }
    }else{
      // Lightweight test adapters expose the native sub-renderers directly.
      renderer.highlights?.sync(view);
      renderer.unitHud?.sync(view);
      renderer.syncActionAnchor?.(view);
      renderer.lastState=view;
    }
    this.onRendered(view);
    if(this.enchantCandidates.length)this.syncEnchantmentMarkers(this.enchantCandidates,this.selectedUnit());
    return true;
  }
  enchantIdentity(target){
    if(!target?.id)return null;
    if(!this.enchantIdentities.has(target.id)){
      const type=target.characterId||target.name||target.id;
      const ordinal=(this.enchantCounters.get(type)||0)+1;
      this.enchantCounters.set(type,ordinal);
      this.enchantIdentities.set(target.id,{ordinal,mark:enchantRecipientMark(ordinal)});
    }
    return this.enchantIdentities.get(target.id);
  }
  clearEnchantmentMarkers(){
    if(this.enchantMarkerScene&&this.enchantMarkerObserver)
      this.enchantMarkerScene.onAfterRenderObservable.remove(this.enchantMarkerObserver);
    this.enchantMarkerScene=null;this.enchantMarkerObserver=null;
    this.enchantMarkers?.clear();this.enchantCandidates=[];
    this.enchantMarkerRoot?.remove();this.enchantMarkerRoot=null;
  }
  focusEnchantmentRecipient(id){
    const key=String(id);
    for(const [targetId,marker] of this.enchantMarkers){
      const active=targetId===key;
      marker.style.opacity=active?'1':'.55';
      marker.style.borderColor=active?'#fff0a0':'#6f9bb8';
      marker.setAttribute('aria-pressed',String(active));
    }
    for(const button of this.root.querySelectorAll?.('[data-enchant-recipient]')||[]){
      const active=button.dataset.enchantRecipient===key;
      button.style.borderColor=active?'#ffe197':'#42566a';
      button.style.background=active?'#304157':'#132130';
      if(active)button.scrollIntoView?.({block:'nearest',inline:'nearest'});
    }
  }
  updateEnchantmentMarkerPositions(){
    const renderer=this.bridge?.renderer;
    if(!this.presented||!renderer?.scene||!renderer?.camera?.camera||!renderer.engine)return;
    const {scene,engine,canvas}=renderer,camera=renderer.camera.camera;
    const viewport=camera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight());
    const rect=canvas.getBoundingClientRect();
    const transform=scene.getTransformMatrix();
    const sx=rect.width/Math.max(1,engine.getRenderWidth()),sy=rect.height/Math.max(1,engine.getRenderHeight());
    for(const {target} of this.enchantCandidates){
      const marker=this.enchantMarkers.get(String(target.id));if(!marker)continue;
      const source=this.serverSnapshot?.units?.find(u=>u.id===target.id)||target;
      if(!source||source.alive===false){marker.hidden=true;continue;}
      const z=Number(source.renderZ??source.z??0);
      const world=new BABYLON.Vector3(Number(source.x)*TILE_SIZE,z*ELEVATION_HEIGHT+UNIT_VISUAL_HEIGHT+.35,Number(source.y)*TILE_SIZE);
      const projected=BABYLON.Vector3.Project(world,BABYLON.Matrix.Identity(),transform,viewport);
      if(projected.z<0||projected.z>1){marker.hidden=true;continue;}
      const x=rect.left+projected.x*sx,y=rect.top+projected.y*sy;
      marker.hidden=x<rect.left-14||x>rect.right+14||y<rect.top-14||y>rect.bottom+14;
      if(!marker.hidden){marker.style.left=`${x}px`;marker.style.top=`${y}px`;}
    }
  }
  syncEnchantmentMarkers(groups,actor){
    if(!groups.length||!this.presented||typeof document.body?.appendChild!=='function'){
      this.clearEnchantmentMarkers();return;
    }
    if(!this.enchantMarkerRoot){
      const root=document.createElement('div');root.className='enchantment-recipient-markers';
      root.style.cssText='position:fixed;inset:0;z-index:119;pointer-events:none;overflow:hidden;';
      document.body.appendChild(root);this.enchantMarkerRoot=root;
    }
    this.enchantCandidates=groups;
    const desired=new Set(groups.map(group=>String(group.target.id)));
    for(const [key,marker] of this.enchantMarkers)
      if(!desired.has(key)){marker.remove();this.enchantMarkers.delete(key);}
    for(const {target} of groups){
      const key=String(target.id);if(this.enchantMarkers.has(key))continue;
      const self=target.id===actor.id,identity=this.enchantIdentity(target);
      const marker=createEnchantmentRecipientMarker({self,identity:{...identity,name:target.name},
        onSelect:()=>this.focusEnchantmentRecipient(target.id)});
      this.enchantMarkerRoot.appendChild(marker);this.enchantMarkers.set(key,marker);
    }
    const scene=this.bridge?.renderer?.scene;
    if(scene&&scene!==this.enchantMarkerScene){
      if(this.enchantMarkerScene&&this.enchantMarkerObserver)
        this.enchantMarkerScene.onAfterRenderObservable.remove(this.enchantMarkerObserver);
      this.enchantMarkerScene=scene;
      this.enchantMarkerObserver=scene.onAfterRenderObservable.add(()=>this.updateEnchantmentMarkerPositions());
    }
    this.updateEnchantmentMarkerPositions();
  }
  rotateFacing(steps){
    const unit=this.selectedUnit();
    if(!unit||!this.isTacticalPhase()||unit.acted||unit.waited||![-1,1].includes(steps))return false;
    return this.request({type:'ROTATE_UNIT',unitId:unit.id,steps});
  }
  adjustAltitude(steps){
    const unit=this.selectedUnit(),flight=unit?.flightControl;
    if(!unit||!flight||!this.isTacticalPhase()||unit.acted||unit.waited||![-1,1].includes(steps))return false;
    return this.request({type:'ADJUST_FLIGHT_ALTITUDE',unitId:unit.id,steps});
  }
  targetAction(type,payload){
    this.target={type,...payload};this.mode=type;this.update();
  }
  add(label,callback,{disabled=false,skill=null}={}){
    const button=this.menuUI.button(label,callback,{disabled,inspectable:!!skill});
    if(skill){
      let official=skill;
      try{official=SkillDatabase.get(skill.id)||skill;}catch{} // Inert unknown test/display ID
      this.menuUI.registerSkill(button,official);
    }
    return button;
  }
  menuBack(to='command'){
    this.add('返回',()=>{this.cancelTarget();this.menu=to;this.update();});
  }
  // CardHandUI already owns its original targeting bar. For tactical
  // aim the ORIGINAL battle menu only needs the cancel action: no extra
  // online-only heading, status column or disabled prompt.
  renderTargetPrompt(){
    this.add('取消施放',()=>{this.cancelTarget();this.update();});
  }
  renderReaction(options){
    const {choices=[],defenses=[],counters=[],guardians=[]}=options||{};
    const view=this.match?.view||{},pending=view.pendingAttack||{};
    const actor=view.units?.find(unit=>unit.id===options?.attackerId);
    const defender=view.units?.find(unit=>unit.id===options?.targetId);
    const model={mode:'enemy-reaction',
      attackerName:actor?nameOf(actor):'未知敵方',
      defenderName:defender?nameOf(defender):'我方角色',
      skillName:knownSkill(options?.skillId||pending.skillId)?.name||'交戰',
      actions:[]};
    const actions=model.actions;
    if(choices.includes('ACCEPT'))actions.push({id:'ACCEPT',label:'承受攻擊'});
    if(choices.includes('EVADE'))actions.push({id:'EVADE',label:'迴避'});
    for(const skill of defenses)
      actions.push({id:'DEFENSE',label:`防禦｜${skill.name}`,payload:{methodId:skill.id}});
    for(const skill of counters)
      actions.push({id:'COUNTER',label:`反擊｜${skill.name}`,payload:{skillId:skill.id}});
    for(const guard of guardians)
      for(const method of guard.methods||[])
        actions.push({id:'GUARD',label:`援護｜${guard.guardianId}｜${method.name}`,
          payload:{guardianId:guard.guardianId,methodId:method.id}});
    // The shared UI never fabricates a combat prediction: only the original
    // server-provided options may become clickable actions.
    this.menuUI.renderEngagementModel(model,{
      onAction:(reaction,payload)=>this.request({type:'REACT_ATTACK',reaction,...payload})
    });
  }
  renderSpecial(unit){
    const u=unit.id;
    const direct=(type,payload)=>()=>{
      if(this.request({type,unitId:u,...payload})){this.cancelTarget();this.update();}
    };
    const tile=(type,payload)=>()=>this.targetAction(type,{unitId:u,...payload});
    // Magic and SPECIAL enemy-target attacks stay in the official special
    // category. They are never guessed to be ordinary physical attacks.
    for(const skill of supportedSkillsForSection(unit,'special'))
      this.add(battleSkillButtonLabel(skill,skill.range,skill.resourceLabel),
        tile('DECLARE_ATTACK',{skillId:skill.id}),{skill,disabled:skill.usable===false});
    for(const skill of unit.effectSkills||[])this.add(
      battleSkillButtonLabel(skill,skill.range,skill.resourceLabel),
      skill.target==='SELF'
        ?direct('CAST_EFFECT_SKILL',{skillId:skill.id,targetId:u})
        :tile('CAST_EFFECT_SKILL',{skillId:skill.id,effectTarget:skill.target}),
      {skill,disabled:skill.usable===false});
    for(const skill of unit.selfUtilitySkills||[])this.add(
      `${skill.name}`,direct('CAST_SELF_UTILITY',
        {skillId:skill.id,variantId:skill.variantId}),
      {skill,disabled:skill.usable===false});
    // Same recipient -> weapon grouping and ①-⑳ identity as TacticalGame.
    // No independently invented attack/enchantment choices: use the server's
    // certified candidate list, only change its presentation.
    const targets=new Map((this.match?.view?.units||[]).map(other=>[other.id,other]));
    const groups=enchantmentRecipientGroups(unit.enchantmentOptions||[],
      option=>targets.get(option.targetId)||{
        id:option.targetId,name:option.targetName,characterId:null},
      option=>option);
    for(const {target,weapons} of groups){
      const self=target.id===unit.id,identity=this.enchantIdentity(target);
      const header=this.add(self?'自己':`${target.name||target.characterId||target.id} ${identity.mark}`,
        ()=>this.focusEnchantmentRecipient(target.id));
      header.dataset.enchantRecipient=String(target.id);
      header.style.cssText+=';text-align:left;border:1px solid #42566a;background:#132130;font-weight:bold;';
      const portrait=globalThis.VisualDatabase?.characterHudPortrait?.(target.characterId);
      if(portrait&&typeof header.prepend==='function'){
        const img=document.createElement('img');img.src=new URL(portrait,document.baseURI).href;
        img.alt='';img.loading='lazy';
        img.style.cssText='width:26px;height:26px;object-fit:cover;object-position:50% 17%;border-radius:5px;float:left;margin-right:7px;';
        header.prepend(img);
      }
      for(const choice of weapons){
        const character=globalThis.CharacterDatabase?.get?.(target.characterId);
        const kind=choice.weaponKind||character?.weapons?.[choice.weaponSlot]?.weaponKind||choice.weaponSlot;
        this.add(`　${enchantWeaponIcon(kind)} ${choice.weaponName}｜${choice.skillName}`,
          direct('CAST_ENCHANTMENT',{skillId:choice.skillId,variantId:choice.variantId,
            targetId:choice.targetId,weaponSlot:choice.weaponSlot}));
      }
    }
    this.syncEnchantmentMarkers(groups,unit);
    for(const entry of unit.pickpocketOptions||[])this.add(
      `${entry.skillName} → ${entry.targetName}`,
      direct('CAST_PICKPOCKET',{skillId:entry.skillId,targetId:entry.targetId}));
    for(const entry of unit.bloodShadowOptions||[])this.add(`${entry.skillName} → ${entry.targetName}`,
      direct('CAST_BLOOD_SHADOW',{skillId:entry.skillId,targetId:entry.targetId}));
    for(const skill of unit.bloodBurstSkills||[])
      this.add(skill.name,direct('CAST_BLOOD_BURST',{skillId:skill.id}),{skill});
    for(const skill of unit.areaFieldSkills||[])
      this.add(skill.name,direct('CAST_AREA_FIELD',{skillId:skill.id}),{skill});
    for(const skill of unit.mapSkills||[]){
      if(skill.category==='ATTACK')continue;
      this.add(skill.name,tile('CAST_MAP_SKILL',{skillId:skill.id}),{skill});
    }
    for(const choice of unit.chargeOptions||[]){
      if(choice.target!=='ALLY')continue;
      this.add(choice.name,tile('CAST_CHARGE',{skillId:choice.skillId,
        variantId:choice.variantId,chargeTarget:'ALLY'}));
    }
    for(const entry of unit.transportOptions||[])
      this.add(`${entry.skillName} → ${entry.targetName}`,
        tile('CAST_TRANSPORT',{skillId:entry.skillId,targetId:entry.targetId}));
    for(const skill of unit.perceptionSkills||[])
      this.add(skill.name,tile('CAST_PERCEPTION',{skillId:skill.id}),{skill});
    for(const skill of unit.enchantedTerrainSkills||[])
      this.add(`地形｜${skill.name}`,tile('ATTACK_ENCHANTED_TERRAIN',{skillId:skill.id}),{skill});
    // Native/Gemini draws the complete SkillDatabase list, including skills
    // whose target or resource condition is not met. PvP must not silently hide
    // those official loadout entries behind the current command-option filter.
    // Only server-certified action options above are clickable. This fallback
    // deliberately does NOT manufacture a new PvP execution route.
    const surfaced=new Set([
      ...supportedSkillsForSection(unit,'special').map(entry=>entry.id),
      ...(unit.effectSkills||[]).map(entry=>entry.id),
      ...(unit.selfUtilitySkills||[]).map(entry=>entry.id),
      ...(unit.enchantmentOptions||[]).map(entry=>entry.skillId),
      ...(unit.pickpocketOptions||[]).map(entry=>entry.skillId),
      ...(unit.bloodShadowOptions||[]).map(entry=>entry.skillId),
      ...(unit.bloodBurstSkills||[]).map(entry=>entry.id),
      ...(unit.areaFieldSkills||[]).map(entry=>entry.id),
      ...(unit.mapSkills||[]).filter(entry=>entry.category!=='ATTACK').map(entry=>entry.id),
      ...(unit.chargeOptions||[]).filter(entry=>entry.target==='ALLY').map(entry=>entry.skillId),
      ...(unit.transportOptions||[]).map(entry=>entry.skillId),
      ...(unit.perceptionSkills||[]).map(entry=>entry.id),
      ...(unit.enchantedTerrainSkills||[]).map(entry=>entry.id)
    ]);
    for(const skill of unit.skillCatalog||[]){
      if(battleSkillCategory(knownSkill(skill.id))!=='special'||surfaced.has(skill.id))continue;
      this.add(`${skill.name}｜${skill.usable===false?'條件不足':'目前無合法操作目標／待確認 PVP 接線'}`,
        ()=>{}, {skill,disabled:true});
    }
    this.menuBack();
  }
  renderCommand(unit){
    this.menuUI.close(()=>{this.menuUI.clear();this.menu='closed';});
    if(this.match?.view?.pendingMoveUnitId===unit.id&&unit.moved&&!unit.acted)
      this.add('取消移動',()=>this.request({type:'CANCEL_MOVE',unitId:unit.id}));
    const commands={
      CAPTURE:()=>this.request({type:'CAPTURE_POINT',unitId:unit.id}),
      ATTACK:()=>{this.menu='attack';this.update();},
      STATUS:()=>this.onInspect(unit.id),
      ITEMS:()=>{this.menu='items';this.update();},
      DIALOGUE:()=>{}, // Original game has no conversation target in this battle.
      SPECIAL:()=>{this.menu='special';this.update();},
      WAIT:()=>this.request({type:'WAIT_UNIT',unitId:unit.id})
    };
    for(const entry of battleCommandEntries({capture:unit.capturePoint,
      canAttack:unit.canAttack!==false&&(supportedSkillsForSection(unit,'attack').length>0||
        unit.mapSkills?.some(s=>s.category==='ATTACK'))}))
      this.add(entry.label,commands[entry.id],{disabled:entry.id==='DIALOGUE'});
  }
  update(){
    if(this.closed||!this.presented||!this.isActive())return;
    if(this.menu!=='special'||this.mode!=='SELECT'||!this.isTacticalPhase())
      this.clearEnchantmentMarkers();
    const v=this.match.view,canAct=this.myTurn()&&this.isConnected();
    this.menuUI.clear();
    const end=document.getElementById('endTurn'),next=document.getElementById('nextUnit');
    // Original controls belong to the actionable tactical phase only.
    // Hide rather than leave a dead PvP control column on the opponent turn.
    if(end){end.hidden=!this.isTacticalPhase()||!canAct;end.disabled=!canAct||!this.isTacticalPhase();}
    if(next){next.hidden=!this.isTacticalPhase()||!canAct;next.disabled=!canAct||!this.isTacticalPhase();}
    if(v.phase==='MATCH_ENDED')return;
    if(v.phase==='BATTLEFIELD_READY')return;
    if(v.phase==='PVP_REACTION_PENDING'){
      if(canAct)this.renderReaction(v.reactionOptions);
      return;
    }
    if(this.isCardPhase()){
      // CardHandUI already renders the ORIGINAL bottom targeting strip,
      // including cancellation. A second floating #skillBar duplicates it.
      return;
    }
    if(!this.isTacticalPhase()||!canAct)return;
    const memory=v.bloodMemoryChoice;
    if(memory){
      this.menuUI.heading('血液記憶');
      for(const skill of memory.options||[])
        this.add(skill.name,()=>this.request({type:'CHOOSE_BLOOD_MEMORY',unitId:memory.unitId,skillId:skill.id}),{skill});
      this.add('略過',()=>this.request({type:'CHOOSE_BLOOD_MEMORY',unitId:memory.unitId,skillId:null}));
      return;
    }
    const unit=this.selectedUnit();
    const followup=v.enchantmentFollowup;
    if(followup&&followup.unitId!==unit?.id){
      this.selectedUnitId=followup.unitId;this.cancelTarget();
    }
    const actor=this.selectedUnit();
    if(!actor||actor.team!==UNIT_TEAM[this.seat]||actor.acted&&!followup){
      this.selectedUnitId=null;
      return;
    }
    if(this.mode!=='SELECT'){
      this.renderTargetPrompt();return;
    }
    if(followup){
      this.menuUI.heading('元素附魔・追加攻擊');
      for(const skill of skillChoices(actor,followup))this.add(`攻擊｜${skill.name}`,
        ()=>this.targetAction('DECLARE_ATTACK',{unitId:actor.id,skillId:skill.id}),{skill,disabled:skill.usable===false});
      this.add('保留附魔並待機',()=>this.request({type:'END_ENCHANT_FOLLOWUP',unitId:actor.id}));
      return;
    }
    if(this.menu==='closed')return;
    if(this.menu==='attack'){
      this.menuUI.close(()=>{this.menuUI.clear();this.menu='closed';});
      for(const skill of supportedSkillsForSection(actor,'attack'))
        this.add(battleSkillButtonLabel(skill,skill.range,skill.resourceLabel),
          ()=>this.targetAction('DECLARE_ATTACK',{unitId:actor.id,skillId:skill.id}),{skill,disabled:skill.usable===false});
      for(const choice of actor.chargeOptions||[]){
        if(choice.target!=='ENEMY')continue;
        this.add(choice.name,()=>this.targetAction('CAST_CHARGE',
          {unitId:actor.id,skillId:choice.skillId,variantId:choice.variantId,chargeTarget:'ENEMY'}));
      }
      for(const skill of actor.mapSkills||[]){
        if(skill.category!=='ATTACK')continue;
        this.add(skill.name,()=>this.targetAction('CAST_MAP_SKILL',
          {unitId:actor.id,skillId:skill.id}),{skill});
      }
      const surfaced=new Set([
        ...supportedSkillsForSection(actor,'attack').map(entry=>entry.id),
        ...(actor.chargeOptions||[]).filter(entry=>entry.target==='ENEMY').map(entry=>entry.skillId),
        ...(actor.mapSkills||[]).filter(entry=>entry.category==='ATTACK').map(entry=>entry.id)
      ]);
      for(const skill of actor.skillCatalog||[]){
        if(skill.category!=='ATTACK'||surfaced.has(skill.id))continue;
        this.add(`${skill.name}｜${skill.usable===false?'條件不足':'目前無合法操作目標／待確認 PVP 接線'}`,
          ()=>{}, {skill,disabled:true});
      }
      this.menuBack();return;
    }
    if(this.menu==='items'||this.menu==='item-manage'){
      this.menuUI.close(()=>{this.menu='closed';this.update();});
      const items=(actor.itemChoices||[]).map(item=>({
        payloadId:item.payloadId,name:item.name,usable:item.usable===true
      }));
      const ground=(actor.groundItemChoices||[]).map(item=>({
        groundId:item.groundId,name:item.name,usable:!!actor.itemInteractionAvailable
      }));
      const allies=(actor.itemTransferTargets||[]).map(item=>({
        unitId:item.unitId,name:item.name
      }));
      for(const entry of battleItemMenuEntries({mode:this.menu==='items'?'item-menu':'item-manage',
        items,ground,allies,interactionAvailable:!!actor.itemInteractionAvailable})){
        const actions={
          USE:()=>this.request({type:'USE_BATTLE_ITEM',unitId:actor.id,payloadId:entry.payloadId}),
          PICKUP:()=>this.request({type:'PICKUP_BATTLE_ITEM',unitId:actor.id,groundId:entry.groundId}),
          OPEN_MANAGE:()=>{this.menu='item-manage';this.update();},
          DROP:()=>this.request({type:'DROP_BATTLE_ITEM',unitId:actor.id,payloadId:entry.payloadId}),
          TRANSFER:()=>this.request({type:'TRANSFER_BATTLE_ITEM',unitId:actor.id,
            payloadId:entry.payloadId,targetUnitId:entry.targetUnitId}),
          EMPTY:()=>{}
        };
        this.add(entry.label,actions[entry.id],{disabled:entry.disabled});
      }
      this.menuBack(this.menu==='item-manage'?'items':'command');return;
    }
    if(this.menu==='special'){
      this.menuUI.close(()=>{this.menuUI.clear();this.menu='closed';});
      this.renderSpecial(actor);return;
    }
    this.renderCommand(actor);
  }
  tilePicked({seat,x,y}={}){
    const v=this.match?.view;
    if(seat!==this.seat||!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||
       !this.myTurn()||!this.isConnected())return false;
    const unit=v.units?.find(candidate=>candidate.x===x&&candidate.y===y&&candidate.alive!==false);
    const type=this.mode,choice=this.target;
    let action=null;
    if(this.isCardPhase()&&type==='DEPLOY'&&choice?.cardId){
      // Reject unlit cells locally. The server will independently recompute
      // the exact same DeploymentEngine.canDeploy before spending crystals.
      const legal=this.deploymentTiles();
      if(!legal){
        const status=document.getElementById('turnStatus');
        if(status)status.textContent='PVP 部署地格資料尚未同步，請重新連線並確認 Worker 版本。';
        return false;
      }
      if(!legal.some(tile=>tile.x===x&&tile.y===y))return false;
      action={type:'DEPLOY_CARD',cardId:choice.cardId,x,y};
    }
    else if(this.isCardPhase()&&type==='TARGET_CARD'&&choice?.cardId)
      action={type:'PLAY_TARGET_CARD',cardId:choice.cardId,x,y};
    else if(this.isTacticalPhase()&&choice?.unitId){
      if(type==='MOVE_UNIT')action={type,unitId:choice.unitId,x,y};
      else if(type==='DECLARE_ATTACK'){
        if(unit&&unit.team!==UNIT_TEAM[this.seat])
          action={type,attackerId:choice.unitId,targetId:unit.id,skillId:choice.skillId};
        else {
          const core=v.battlefield?.cores?.find(c=>c.x===x&&c.y===y);
          const attacker=v.units?.find(u=>u.id===choice.unitId);
          if(core&&attacker?.coreAttackSkillIds?.includes(choice.skillId))
            action={type:'ATTACK_CORE',unitId:choice.unitId,skillId:choice.skillId,coreOwner:core.owner};
          else if(!unit&&!core&&attacker?.environmentContactSkillIds?.includes(choice.skillId))
            action={type:'CAST_ENVIRONMENT_CONTACT',unitId:choice.unitId,skillId:choice.skillId,x,y};
        }
      }else if(type==='CAST_EFFECT_SKILL'&&unit&&(
        choice.effectTarget==='ENEMY'?unit.team!==UNIT_TEAM[this.seat]:
        choice.effectTarget==='SELF'?unit.id===choice.unitId:
        choice.effectTarget==='ALLY'&&unit.team===UNIT_TEAM[this.seat]))
        action={type,unitId:choice.unitId,skillId:choice.skillId,targetId:unit.id};
      else if(type==='CAST_MAP_SKILL'||type==='ATTACK_ENCHANTED_TERRAIN')
        action={type,unitId:choice.unitId,skillId:choice.skillId,x,y};
      else if(type==='CAST_CHARGE'&&unit&&unit.id!==choice.unitId&&(
        choice.chargeTarget==='ENEMY'?unit.team!==UNIT_TEAM[this.seat]:
        choice.chargeTarget==='ALLY'&&unit.team===UNIT_TEAM[this.seat]))
        action={type,unitId:choice.unitId,skillId:choice.skillId,
          variantId:choice.variantId,targetId:unit.id};
      else if(type==='CAST_PERCEPTION'&&unit&&unit.team!==UNIT_TEAM[this.seat])
        action={type,unitId:choice.unitId,skillId:choice.skillId,targetId:unit.id};
      else if(type==='CAST_TRANSPORT')
        action={type,unitId:choice.unitId,skillId:choice.skillId,targetId:choice.targetId,x,y};
    }
    if(action){
      const sent=this.request(action);
      // Single-player resolves synchronously, but the PVP Worker does not:
      // an accepted WebSocket send is NOT an accepted gameplay command.
      // Keep card target mode on rejection so the player can retry.
      if(sent && !['DEPLOY','TARGET_CARD'].includes(type)){
        this.cancelTarget();this.update();this.refreshNativePresentation();
      }
      return sent;
    }
    if(type!=='SELECT')return false;
    if(unit?.team===UNIT_TEAM[this.seat])return this.selectUnit(unit.id);
    // Same as the original command mode: an empty reachable tile proposes
    // movement without forcing a separate Move submenu. Server checks range.
    const actor=this.selectedUnit();
    if(this.isTacticalPhase()&&actor&&!actor.acted&&!actor.moved&&!unit&&
       actor.reachableTiles?.some(tile=>tile.x===x&&tile.y===y))
      return this.request({type:'MOVE_UNIT',unitId:actor.id,x,y});
    // Same native command-panel collapse as the local game: tapping an empty
    // non-actionable tile dismisses the menu, not the actor or its movement
    // range. Re-selecting that actor opens the original command menu again.
    if(this.isTacticalPhase()&&actor&&!unit&&this.menu!=='closed'){
      this.menu='closed';this.update();return true;
    }
    return false;
  }
  // Local renderer computes the anchor position. PvP supplies only its
  // selected UNIT ID (pure display selection, never a game-state change).
  anchorMenu(){
    const renderer=this.bridge?.renderer,world=renderer?.lastState;
    if(!renderer?.syncActionAnchor||!world?.units||!this.selectedUnitId)return;
    renderer.syncActionAnchor({units:world.units.map(unit=>
      ({...unit,selected:unit.id===this.selectedUnitId}))});
  }
  async receiveRender(packet){
    if(this.closed||!this.match||packet?.seat!==this.seat||
       !Number.isSafeInteger(packet.revision)||
       (packet.revision<this.match.revision&&!this.samePublicBattlefield(packet.snapshot)))return false;
    this.newestRender=packet;
    const token=++this.renderToken;
    try{
      await this.ensureBabylon();
      if(this.closed||token!==this.renderToken||packet!==this.newestRender)return false;
      if(!this.bridge)this.bridge=await this.createBridge({
        canvas:this.canvas,seat:this.seat,onTilePicked:point=>this.tilePicked(point)
      });
      if(this.closed||token!==this.renderToken)return false;
      const updated=this.bridge.accept(packet);
      if(updated){
        this.serverSnapshot=packet.snapshot;
        this.refreshNativePresentation();
        this.publishSelection();
      }
      return updated;
    }catch(error){
      const node=document.getElementById('turnStatus');
      if(node)node.textContent=`3D 畫面無法建立：${error.message}`;
      if(!this.closed&&token===this.renderToken)
        this.onRenderFailure(packet,error);
      return false;
    }
  }
  close(){
    if(this.closed)return;
    this.closed=true;this.renderToken++;this.serverSnapshot=null;
    this.clearEnchantmentMarkers();
    this.bridge?.close();this.bridge=null;
    this.menuUI.clear();this.onSelection(null,{canAct:false});
  }
}
