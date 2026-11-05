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
  close(onClick){
    const button=document.createElement('button');
    button.type='button';button.className='battle-command-close';
    button.textContent='×';button.setAttribute('aria-label','關閉作戰選單');
    button.onclick=onClick;this.root.appendChild(button);return button;
  }
}
