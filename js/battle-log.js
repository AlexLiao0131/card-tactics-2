export const BattleLog=(()=>{
  const TYPES=["BATTLE","SYSTEM","DETAIL"],MAX_ENTRIES=240;
  function create(){return{active:"BATTLE",entries:[]};}
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
  return{TYPES,MAX_ENTRIES,create,add,list,setActive};
})();
globalThis.BattleLog=BattleLog;
