export const STAGE_SCRIPTS={
  prototype_script:{
    id:"prototype_script",
    events:[
      {
        id:"round3_reinforcement_demo",
        trigger:{type:"ROUND_START",round:3,team:"PLAYER"},
        once:true,
        actions:[
          {type:"LOG",text:"【事件框架測試】遠方傳來增援的腳步聲。"}
        ]
      }
    ]
  }
};

export const StageEngine=(()=>{
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  function create(scriptId,initialObjectives=null){
    return {
      scriptId,
      fired:new Set(),
      flags:{},
      objectives:{
        victory:clone(initialObjectives?.victory??null),
        defeat:clone(initialObjectives?.defeat??null)
      },
      encounterState:null
    };
  }
  function scriptFor(state){
    return STAGE_SCRIPTS[state?.scriptId]||null;
  }
  function objectives(state,fallback=null){
    return {
      victory:state?.objectives?.victory??fallback?.victory??null,
      defeat:state?.objectives?.defeat??fallback?.defeat??null
    };
  }
  function setObjective(state,action){
    if(!state||!action)return null;
    if(action.objectives){
      if(Object.prototype.hasOwnProperty.call(action.objectives,"victory"))state.objectives.victory=clone(action.objectives.victory);
      if(Object.prototype.hasOwnProperty.call(action.objectives,"defeat"))state.objectives.defeat=clone(action.objectives.defeat);
      return objectives(state);
    }
    const target=String(action.target||"").toUpperCase();
    if(target!=="VICTORY"&&target!=="DEFEAT")return null;
    if(!Object.prototype.hasOwnProperty.call(action,"objective"))return null;
    state.objectives[target.toLowerCase()]=clone(action.objective);
    return objectives(state);
  }
  function pendingActions(state,predicate){
    const script=scriptFor(state);
    if(!script)return [];
    const actions=[];
    for(const item of script.events||[]){
      if(item.once&&state?.fired?.has(item.id))continue;
      for(const action of item.actions||[]){
        if(!predicate||predicate(action,item))actions.push(action);
      }
    }
    return actions;
  }
  function hasPendingSpawn(state,team){
    return pendingActions(state,action=>action.type==="SPAWN"&&(!team||action.team===team)).length>0;
  }
  function matches(trigger,event){
    if(!trigger||trigger.type!==event.type)return false;
    for(const [key,value] of Object.entries(trigger)){
      if(key==="type")continue;
      if(event[key]!==value)return false;
    }
    return true;
  }
  function encounterEventType(type){
    if(type==="ROUND_START")return window.EncounterEngine?.TRIGGER?.ROUND_START||"ROUND_START";
    if(type==="ENTER_TILE")return window.EncounterEngine?.TRIGGER?.TILE_ENTER||"TILE_ENTER";
    return null;
  }
  function triggerEncounter(state,event,context){
    if(!state?.encounterState||!window.EncounterEngine?.trigger)return[];
    return EncounterEngine.trigger(state.encounterState,event,{pushLog:context?.log});
  }
  function run(state,event,context){
    if(!state)return[];
    const script=scriptFor(state),executed=[];
    if(script){
      for(const item of script.events||[]){
        if(item.once&&state.fired.has(item.id))continue;
        if(!matches(item.trigger,event))continue;
        let ok=true;
        for(const condition of item.conditions||[]){
          if(condition.type==="UNIT_HP_BELOW"){
            const unit=context.units.find(u=>u.id===condition.unitId||u.character.id===condition.characterId);
            if(!unit||unit.hp/unit.character.combat.hp*100>=condition.percent)ok=false;
          }else if(condition.type==="FLAG"){
            if(state.flags[condition.key]!==condition.value)ok=false;
          }
        }
        if(!ok)continue;
        for(const action of item.actions||[]){
          if(action.type==="LOG"||action.type==="DIALOGUE"){
            context.log(action.type==="DIALOGUE"?`${action.speaker||""}：${action.text}`:action.text);
          }else if(action.type==="SPAWN"){
            context.spawn(action);
          }else if(action.type==="SET_FLAG"){
            state.flags[action.key]=action.value;
          }else if(action.type==="SET_OBJECTIVE"){
            const active=setObjective(state,action);
            if(active)context.onObjectiveChanged?.(active,action);
          }
        }
        if(item.once)state.fired.add(item.id);
        executed.push(item.id);
        triggerEncounter(state,{
          type:window.EncounterEngine?.TRIGGER?.SCRIPT||"SCRIPT",
          scriptEventId:item.id,
          sourceEventType:event?.type||null,
          round:event?.round,
          team:event?.team,
          flags:state.flags
        },context);
      }
    }
    const encounterType=encounterEventType(event?.type);
    if(encounterType){
      triggerEncounter(state,{...event,type:encounterType,flags:state.flags},context);
    }
    return executed;
  }
  return Object.freeze({create,run,objectives,setObjective,pendingActions,hasPendingSpawn});
})();
globalThis.STAGE_SCRIPTS=STAGE_SCRIPTS;
globalThis.StageEngine=StageEngine;
