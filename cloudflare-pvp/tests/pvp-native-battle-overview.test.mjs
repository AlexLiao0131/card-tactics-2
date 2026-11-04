import test from 'node:test';
import assert from 'node:assert/strict';
import {presentBattleOverview} from '../../js/battle-ui.js';

const testDOM=()=>{
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id)){
      const classes=new Set();
      nodes.set(id,{id,disabled:false,title:'',textContent:'',style:{},
        classList:{toggle:(k,active)=>active?classes.add(k):classes.delete(k),contains:k=>classes.has(k)},
        setAttribute(key,value){this[key]=value}});
    }
    return nodes.get(id);
  };
  const old=globalThis.document;
  globalThis.document={getElementById:node};
  return {node,restore:()=>globalThis.document=old};
};
const snapshot={map:{width:14,height:10},units:[{id:'actor',team:'PLAYER',finished:false}],
  cores:[{owner:'PLAYER',hp:600,maxHp:600},{owner:'ENEMY',hp:500,maxHp:600}],
  presentation:{deploymentPoints:[]}};

test('online original BattleUI scoreboard must not disable the legal Next Unit control',()=>{
  const f=testDOM();try{
    f.node('nextUnit').disabled=false;
    presentBattleOverview({snapshot,stage:{ruleset:'CORE_CAPTURE',mode:'VERSUS',deploymentPoints:[]},
      phase:'PLAYER_TACTICAL_PHASE',seat:0,online:true});
    assert.equal(f.node('nextUnit').disabled,false,'PvpTacticalUI owns online Next Unit authorization');
    assert.equal(f.node('playerCoreHp').textContent,'600/600');
    assert.equal(f.node('enemyCoreHp').textContent,'500/600');
  }finally{f.restore()}
});

test('same original BattleUI still updates Next Unit legality in local/Gemini mode',()=>{
  const f=testDOM();try{
    presentBattleOverview({snapshot,phase:'PLAYER_TURN',seat:0,online:false});
    assert.equal(f.node('nextUnit').disabled,false);
    presentBattleOverview({snapshot,phase:'ENEMY_TURN',seat:0,online:false});
    assert.equal(f.node('nextUnit').disabled,true);
  }finally{f.restore()}
});
