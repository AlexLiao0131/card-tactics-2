/**
 * The ONE tactical command menu presenter for local, Gemini, and online PvP.
 * It owns DOM nodes/classes only. The source of action choices and their
 * execution is injected by the game runtime (offline) or canonical server
 * projection (online); it never infers legality, range, or combat outcomes.
 */
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
