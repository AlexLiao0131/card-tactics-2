/**
 * The ONE tactical command menu presenter for local, Gemini, and online PvP.
 * It owns DOM nodes/classes only. The source of action choices and their
 * execution is injected by the game runtime (offline) or canonical server
 * projection (online); it never infers legality, range, or combat outcomes.
 */
/**
 * Canonical menu structure shared by the original local tactical runtime and
 * the online input adapter. This module contains UI structure, never rules.
 * Actions already have legality/availability determined by the caller's
 * official engine or server projection; never invent options on the client.
 */
export function battleCommandEntries({capture=null,canAttack=true,
  hasItems=true,hasDialogue=true,hasSpecial=true}={}) {
  const entries=[];
  if(capture)entries.push({id:'CAPTURE',label:`佔領｜${capture.name}`});
  if(canAttack)entries.push({id:'ATTACK',label:'攻擊'});
  entries.push({id:'STATUS',label:'狀態'});
  if(hasItems)entries.push({id:'ITEMS',label:'道具'});
  if(hasDialogue)entries.push({id:'DIALOGUE',label:'對話'});
  if(hasSpecial)entries.push({id:'SPECIAL',label:'魔法／特殊技能'});
  entries.push({id:'WAIT',label:'待機'});
  return entries;
}

/** One original item-menu hierarchy for offline, Gemini, and PvP.
 * All availability booleans are certified by the caller's official rule engine;
 * this function never checks resources, adjacency or inventory itself.
 */
export function battleItemMenuEntries({mode='item-menu',items=[],ground=[],allies=[],interactionAvailable=false}={}){
  const result=[];
  if(mode==='item-menu'){
    if(!items.length&&!ground.length)result.push({id:'EMPTY',label:'沒有可用道具',disabled:true});
    for(const item of items)result.push({id:'USE',payloadId:item.payloadId,
      label:`使用｜${item.name}`,disabled:item.usable!==true});
    for(const entry of ground)result.push({id:'PICKUP',groundId:entry.groundId,
      label:`拾取｜${entry.name}`,disabled:entry.usable!==true});
    if(items.length)result.push({id:'OPEN_MANAGE',label:'放下／轉交',disabled:!interactionAvailable});
  }else if(mode==='item-manage'){
    for(const item of items){
      result.push({id:'DROP',payloadId:item.payloadId,
        label:`放下｜${item.name}`,disabled:!interactionAvailable});
      for(const ally of allies)result.push({id:'TRANSFER',payloadId:item.payloadId,targetUnitId:ally.unitId,
        label:`交給 ${ally.name}｜${item.name}`,disabled:!interactionAvailable||ally.canReceive===false});
    }
  }
  return result;
}

/** The SkillDatabase category is the only classification source. */
export function battleSkillCategory(skill) {
  if(!skill || !['ATTACK','MAGIC','SPECIAL'].includes(skill.category))return null;
  return skill.category==='ATTACK'?'attack':'special';
}

export function battleSkillsForMenu(skills,{mode='attack-menu',memoryIds=new Set()}={}) {
  if(!Array.isArray(skills))return [];
  if(mode==='blood-memory-menu')return skills.filter(s=>memoryIds.has(s.id));
  const category=mode==='attack-menu'?'attack':mode==='special-menu'?'special':null;
  if(!category)return [];
  return skills.filter(s=>!memoryIds.has(s.id) && battleSkillCategory(s)===category);
}

/** Format exactly the same skill label in local and online menus.
 * PvP obtains range/resource text from the canonical server projection.
 */
export function battleSkillButtonLabel(skill,range=null,resourceLabel=null){
  if(!skill?.name)return '';
  if(!range||!Number.isFinite(range.min)||!Number.isFinite(range.max)||
     typeof resourceLabel!=='string'||!resourceLabel)return skill.name;
  return `${skill.name}｜射程 ${range.min}-${range.max}｜${resourceLabel}`;
}


// One roster-order identity/recipient grouping model for local and PvP weapon enchanting.
// Presentation only: the server or TacticalActionController certifies all choices.
export const ENCHANT_RECIPIENT_DIGITS=Object.freeze(["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩","⑪","⑫","⑬","⑭","⑮","⑯","⑰","⑱","⑲","⑳"]);
export function enchantmentRecipientGroups(candidates=[],toTarget=entry=>entry.target,toWeapon=entry=>entry.weapon){
  const groups=new Map();
  for(const entry of candidates){
    const target=toTarget(entry),weapon=toWeapon(entry);
    if(!target?.id||!weapon)continue;
    if(!groups.has(target.id))groups.set(target.id,{target,weapons:[]});
    groups.get(target.id).weapons.push(weapon);
  }
  return [...groups.values()];
}
export function enchantRecipientMark(ordinal){return ENCHANT_RECIPIENT_DIGITS[ordinal-1]||`#${ordinal}`;}
export const enchantWeaponIcon=kind=>({BOW:"🏹",POLEARM:"🔱",TRIDENT:"🔱",HAMMER:"🔨",KNIFE:"🗡",RAPIER:"🗡",GREATSWORD:"⚔",SWORD:"⚔"}[String(kind||'').toUpperCase()]||"⚔");

/** Same native numbered map marker used by local TacticalGame and PvP.
 * Pure DOM presentation. No new scene, renderer, calculation or game state. */
export function createEnchantmentRecipientMarker({self=false,identity=null,onSelect=()=>{}}={}){
  const marker=document.createElement('button');marker.type='button';
  marker.className='enchant-recipient-marker';
  marker.textContent=self?'自己':identity?.mark||'?';
  marker.title=`${self?'自己':`${identity?.name||'角色'} ${identity?.mark||''}`}｜點選查看附魔武器`;
  marker.setAttribute('aria-label',marker.title);
  marker.style.cssText='position:fixed;transform:translate(-50%,-100%);min-width:30px;height:30px;z-index:120;border:2px solid #6f9bb8;border-radius:50%;color:#fff3ca;background:#10283ce8;font:bold 14px system-ui;pointer-events:auto;touch-action:manipulation;padding:2px 5px;white-space:nowrap;';
  marker.addEventListener('pointerdown',event=>event.stopPropagation());
  marker.addEventListener('click',event=>{event.stopPropagation();onSelect();});
  return marker;
}

export class BattleCommandMenuUI {
  // The original TacticalGame long-press inspector watches this one registry.
  // Both its local buttons and PvP buttons register official SkillDatabase
  // descriptions here. There is no parallel online tooltip implementation.
  static skillRegistry=new WeakMap();
  registerSkill(button,skill){
    if(button&&skill)BattleCommandMenuUI.skillRegistry.set(button,skill);
    return button;
  }
  constructor(root) {
    if (!root || typeof root.appendChild !== 'function')
      throw Error('BATTLE_COMMAND_MENU_ROOT_REQUIRED');
    this.root=root;
  }
  clear({reaction=false}={}){
    this.root.replaceChildren();
    this.root.classList.remove('enemy-reaction-panel','command-panel-collapsed','engagement-overlay');
    if(reaction)this.root.classList.add('enemy-reaction-panel');
  }
  button(label,onClick,{disabled=false,inspectable=false}={}){
    const button=document.createElement('button');
    button.type='button';button.textContent=String(label);
    button.className='action-button';
    if(inspectable){
      button.style.webkitTouchCallout='none';
      button.style.webkitUserSelect='none';button.style.userSelect='none';
      if(disabled){button.setAttribute('aria-disabled','true');button.style.opacity='.55';}
      button.onclick=()=>{if(!disabled)onClick();};
    }else{
      button.disabled=!!disabled;
      button.onclick=()=>{if(!disabled)onClick();};
    }
    this.root.appendChild(button);
    return button;
  }
  heading(text){
    const heading=document.createElement('strong');
    heading.textContent=String(text);this.root.appendChild(heading);
    return heading;
  }
  // The SAME engagement panel used by solo/Gemini and the remote authority.
  // The caller supplies official actions and, when available, official preview.
  renderEngagementModel(model,{forecast=null,onAction=()=>{}}={}){
    this.clear({reaction:model?.mode!=='support-select'});
    this.root.classList.add('engagement-overlay');
    this.heading(model?.mode==='support-select'?'我方交戰準備':'敵方攻擊・選擇應對');
    const incoming=document.createElement('div');incoming.className='engagement-threat';
    const actor=document.createElement('strong');
    actor.textContent=`${model?.attackerName||'未知'} → ${model?.defenderName||'未知'}`;
    const skill=document.createElement('span');
    skill.textContent=`使用技能：${model?.skillName||'未知技能'}${model?.attackType?`｜${model.attackType}`:''}`;
    incoming.appendChild(actor);incoming.appendChild(skill);this.root.appendChild(incoming);
    if(forecast)this.root.appendChild(forecast);
    const actionButton=action=>{
      const button=document.createElement('button');
      button.type='button';button.textContent=action.label;button.disabled=!!action.disabled;
      button.onclick=()=>{if(!button.disabled)onAction(action.id,action.payload||{});};
      return button;
    };
    for(const group of model?.groups||[]){
      const wrap=document.createElement('div');wrap.className='support-choice';
      const label=document.createElement('div');label.textContent=group.title;wrap.appendChild(label);
      for(const action of group.actions||[])wrap.appendChild(actionButton(action));
      this.root.appendChild(wrap);
    }
    for(const action of model?.actions||[])this.root.appendChild(actionButton(action));
  }
  close(onClick){
    const button=document.createElement('button');
    button.type='button';button.className='battle-command-close';
    button.textContent='×';button.setAttribute('aria-label','關閉作戰選單');
    button.onclick=onClick;this.root.appendChild(button);return button;
  }
}
