export const BattleLog=(()=>{
  const TYPES=["BATTLE","SYSTEM","DETAIL"],MAX_ENTRIES=240;
  function create(){return{active:"BATTLE",entries:[]};}
  // Disclosure is evaluated at event time. Never recover suppressed text when
  // a hidden unit subsequently becomes visible (or dies). IDs, not names,
  // distinguish identical heroes on opposing teams.
  function mayPublish(world,viewerTeam,scope,tactical=globalThis.TacticalEngine){
    if(!scope||!world)return false;
    if(scope.viewerTeam!=null&&scope.viewerTeam!==viewerTeam)return false;
    const actors=scope.units||[],cells=scope.cells||[];
    if(scope.public===true&&!actors.length&&!cells.length)return true; // authored public phase/weather facts
    if(!actors.length&&!cells.length)return scope.viewerTeam===viewerTeam;
    const visible=actor=>{
      if(!actor?.id||!actor.team)return false;
      if(actor.team===viewerTeam)return true;
      // Death logs use the last contact location, not a dead unit's absent mesh.
      return tactical?.teamCanIdentifyUnit?.(world,viewerTeam,actor.alive===false?{...actor,alive:true}:actor,world.environmentState)===true;
    };
    try{return actors.every(visible)&&cells.every(cell=>tactical?.teamCanSee?.(world.map,world.units,viewerTeam,cell,world.environmentState,world)===true);}catch(_){return false;}
  }
  function add(state,type,text){
    const t=TYPES.includes(type)?type:"SYSTEM";
    state.entries.push({type:t,text:String(text)});
    if(state.entries.length>MAX_ENTRIES)state.entries.splice(0,state.entries.length-MAX_ENTRIES);
  }
  function list(state,type=state.active,limit=40){
    const out=[];
    for(let i=state.entries.length-1;i>=0&&out.length<limit;i--)if(state.entries[i].type===type)out.push(state.entries[i]);
    return out.reverse();
  }
  function setActive(state,type){if(TYPES.includes(type))state.active=type;}
  return{TYPES,MAX_ENTRIES,create,add,list,setActive,mayPublish};
})();
globalThis.BattleLog=BattleLog;
