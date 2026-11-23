import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const source=readFileSync(fileURLToPath(new URL('../../js/unit-hud-overlay.js',import.meta.url)),'utf8');

function fixture(){
  let time=1000;
  const visual={units:{activeAnimations:new Map(),animationQueues:new Map(),entries:new Map()},
    visualPending(event){
      const same=e=>e?.sequence===event.sequence&&String(e.unitId)===String(event.unitId);
      return [...this.units.activeAnimations.values()].some(a=>same(a.event))||
        [...this.units.animationQueues.values()].some(q=>q.some(same));
    }};
  function node(tag){return {tag,hidden:false,style:{},children:[],isConnected:true,
    className:'',appendChild(child){this.children.push(child);child.isConnected=true;return child},
    remove(){this.removed=true},setAttribute(){},getBoundingClientRect(){return {left:0,top:0,width:1000,height:700}}};}
  const doc={getElementById(id){return id==='battleScreen'?node('div'):null},createElement:node};
  const performance={now:()=>time};
  const BABYLON={Vector3:class{constructor(x,y,z){Object.assign(this,{x,y,z})}
    static Project(point){return {x:point.x+100,y:point.y+100,z:0.5}}},Matrix:{Identity(){return {}}}};
  const code=source.replace(/^import .*;\s*$/gm,'').replace('export class UnitHudOverlay','class UnitHudOverlay')+'\n;globalThis.__overlay=UnitHudOverlay';
  const context={BABYLON,performance,document:doc,globalThis:null,
    visualManagerFor:()=>visual,TILE_SIZE:1,ELEVATION_HEIGHT:1,UNIT_VISUAL_HEIGHT:2};
  context.globalThis=context;vm.runInNewContext(code,context,{filename:'unit-hud-overlay.js'});
  const hud=new context.__overlay({getTransformMatrix(){return {}}},
    {getRenderWidth(){return 1000},getRenderHeight(){return 700}},
    {getBoundingClientRect(){return {left:0,top:0,width:1000,height:700}}},
    {viewport:{toGlobal(){return {}}}});
  hud.units=[{id:'target',x:1,y:1}];
  return {hud,visual,advance:ms=>{time+=ms}};
}

test('sword dance shows three separate actual damage numbers as each attack enters playback',()=>{
  const {hud,visual,advance}=fixture();
  const actions=[10,20,30].map((sequence,i)=>({type:'UNIT_ANIMATION',sequence,
    skillId:'safiya_sword_dance',unitId:'safiya',state:'ATTACK',targetId:'target',danceStep:i+1}));
  const results=actions.map((action,i)=>({type:'UNIT_FLOAT_TEXT',sequence:action.sequence+1,
    unitId:'target',skillId:'safiya_sword_dance',kind:'PHYSICAL_DAMAGE',value:5+i,x:1,y:1,renderZ:0}));
  visual.units.animationQueues.set('safiya',actions.slice());
  hud.presentEvents(actions.flatMap((event,i)=>[event,results[i]]));
  assert.deepEqual(Array.from(hud.floats,x=>x.node.textContent),['-5','-6','-7']);
  assert.ok(hud.floats.every(x=>x.node.hidden));
  for(let i=0;i<3;i++){
    const playing=visual.units.animationQueues.get('safiya').shift();
    visual.units.activeAnimations.set('safiya',{event:playing,startedAt:1000+i*320,duration:320});
    hud.updateFrame();
    assert.equal(hud.floats[i].node.hidden,false,`hit ${i+1} must be visible while its slash is playing`);
    assert.ok(hud.floats[i].start!=null,`hit ${i+1} lifetime starts with playback`);
    for(let n=i+1;n<3;n++)assert.equal(hud.floats[n].node.hidden,true);
    advance(320);
  }
  visual.units.activeAnimations.clear();
  advance(1500);hud.updateFrame();
  assert.equal(hud.floats.length,0,'all short-lived float nodes must be cleaned');
});

test('unplayed visible authoritative result falls back to showing rather than staying hidden',()=>{
  const {hud,visual}=fixture();
  const attack={type:'UNIT_ANIMATION',sequence:5,unitId:'safiya',skillId:'safiya_sword_dance',state:'ATTACK'};
  hud.presentEvents([attack,{type:'UNIT_FLOAT_TEXT',sequence:6,unitId:'target',skillId:'safiya_sword_dance',
    kind:'PHYSICAL_DAMAGE',value:12,x:1,y:1}]);
  assert.equal(hud.floats[0].node.hidden,true);
  visual.units.animationQueues.clear();hud.updateFrame();
  assert.equal(hud.floats[0].node.hidden,false);
  assert.equal(hud.floats[0].node.textContent,'-12');
});

test('no zero damage float from blocked or shield-only hits',()=>{
  const {hud}=fixture();
  hud.presentEvents([{type:'UNIT_FLOAT_TEXT',sequence:3,unitId:'target',kind:'PHYSICAL_DAMAGE',value:0,x:1,y:1}]);
  assert.equal(hud.floats.length,0);
});
