import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../../js/vfx-manager.js',import.meta.url),'utf8');
const section=source.split('class WaterLurkerSurfaceModel{')[1]?.split('const factories=Object.freeze({')[0];
assert.ok(section,'The existing VfxManager must retain the monster and its grab rig');
class Vec {
  constructor(x=0,y=0,z=0){this.set(x,y,z)}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
  setAll(v){return this.set(v,v,v)}
  copyFrom(other){return this.set(other.x,other.y,other.z)}
}
class Q {constructor(){this.set(0,0,0,1)}set(x,y,z,w){Object.assign(this,{x,y,z,w});return this}}
class Node {
  constructor(name){this.name=name;this.position=new Vec();this.rotation=new Vec();this.scaling=new Vec(1,1,1);this.children=[];this.enabled=true;this.disposed=false;this.mesh=false;}
  set parent(parent){if(this._parent){const i=this._parent.children.indexOf(this);if(i>=0)this._parent.children.splice(i,1)}this._parent=parent;if(parent)parent.children.push(this)}
  get parent(){return this._parent}
  setEnabled(value){this.enabled=value}
  getChildMeshes(){return this.children.flatMap(child=>[...(child.mesh?[child]:[]),...child.getChildMeshes()])}
  dispose(){this.disposed=true;for(const child of [...this.children])child.dispose();this.children=[]}
  isDisposed(){return this.disposed}
}
let builds=0;
class Material {constructor(){this.disposed=false}dispose(){this.disposed=true}}
function primitive(id){builds++;const node=new Node(id);node.mesh=true;node.rotationQuaternion=new Q();node.createInstance=name=>{const instance=new Node(name);instance.mesh=true;instance.rotationQuaternion=new Q();return instance};return node}
const BABYLON={TransformNode:Node,Quaternion:Q,StandardMaterial:Material,Color3:class Color3{constructor(...c){this.rgb=c}},MeshBuilder:Object.fromEntries(['CreateSphere','CreateCylinder','CreateTorus'].map(name=>[name,primitive]))};
const Klass=vm.runInNewContext('class WaterLurkerSurfaceModel{'+section+';WaterLurkerSurfaceModel',
  {BABYLON,TILE_SIZE:2,ELEVATION_HEIGHT:1,performance:{now:()=>1000},Map,Set,Math,Number,String});
const create=()=>{
 const scene={onDisposeObservable:{addOnce:()=>{}}},heroRoot=new Node('hero-root');
 heroRoot.position.set(8,0,6);
 const hero={kind:'FIGURE',root:heroRoot,height:1.7,width:.65};
 const units={entries:new Map([['hero',hero]]),activeAnimations:new Map()};
 const visual=new Klass(scene,{units});
 const monster={id:'kraken',monsterId:'water_lurker',visualId:'water_lurker_default',alive:true,x:2,y:3,footprint:{width:2,height:2}};
 const victim={id:'hero',visualId:'hero_default',alive:true,x:3,y:3};
 const map={id:'lake',tiles:Array.from({length:25},(_,i)=>({x:1+i%5,y:2+Math.floor(i/5),waterSurfaceZ:4}))};
 const snapshot={map,units:[monster,victim]};
 const action={type:'UNIT_ANIMATION',sequence:10,unitId:'kraken',state:'ATTACK',skillId:'water_tentacle',targetId:'hero'};
 const pull={type:'UNIT_ANIMATION',sequence:15,unitId:'hero',state:'WALK',kind:'FORCED_MOVE',path:[{x:4,y:3,z:0},{x:3,y:3,z:0}]};
 const tick=time=>{heroRoot.position.set(8,0,6);heroRoot.rotation.set(0,0,0);visual.updateFrame(time)};
 return {visual,units,monster,victim,heroRoot,snapshot,action,pull,tick};
};
test('existing monster is one 2x2 actor, with one cached articulated grab arm, no per-frame geometry rebuild',()=>{
 const x=create();x.visual.sync(x.snapshot);
 const fx=x.visual.entries.get('kraken');
 assert.equal(fx.arms.length,5);assert.ok(fx.arms.every(a=>a.pivots.length===5));
 assert.equal(fx.gripLinks.length,22);assert.equal(fx.gripPads.length,8);
 assert.equal(fx.gripRig.enabled,false);
 const before=builds;x.tick(1000);x.tick(1250);x.tick(1550);
 assert.equal(builds,before);assert.equal(x.visual.diagnostics().grabbing,0);
 x.visual.dispose();assert.equal(fx.root.disposed,true);
});
test('MISS, single hit, resisted/blocked displacement and targets in fog do not fake a grab',()=>{
 const x=create();x.visual.sync(x.snapshot,[x.action]);
 assert.equal(x.visual.entries.get('kraken').pendingGrabs.length,0,'the attack animation itself cannot grab');
 x.visual.sync(x.snapshot,[x.action,{...x.pull,kind:'DODGE'}]);
 assert.equal(x.visual.entries.get('kraken').pendingGrabs.length,0);
 x.visual.sync(x.snapshot,[x.action,{...x.pull,path:[{x:4,y:3},{x:4,y:3}]}]);
 assert.equal(x.visual.entries.get('kraken').pendingGrabs.length,0,'no traveled cell');
 x.visual.sync({...x.snapshot,units:[x.monster]},[x.action,x.pull]);
 assert.equal(x.visual.entries.get('kraken').pendingGrabs.length,0,'target must be visible');
 x.visual.dispose();
});
test('real post-engagement PULL attaches a 3D winding arm to the actually rendered target root, lifts and releases',()=>{
 const x=create();x.visual.sync(x.snapshot,[x.action,x.pull]);
 const fx=x.visual.entries.get('kraken');
 assert.equal(fx.pendingGrabs.length,1);
 assert.equal(fx.grab,null,'event receipt only, not yet playback');
 x.tick(1010);assert.equal(fx.grab,null,'do not start before official actor animation');
 x.units.activeAnimations.set('kraken',{event:x.action,startedAt:1000,duration:300});
 x.tick(1030);assert.ok(fx.grab);
 assert.equal(fx.gripRig.enabled,true);assert.equal(fx.arms[2].joint.enabled,false,'replace an existing arm rather than append a sixth');
 x.tick(1580);
 assert.ok(x.heroRoot.position.y>0.1,'victim is visually lifted by the actual grabbing arm');
 const segments=fx.gripLinks.filter(node=>node.enabled);
 assert.ok(segments.length>=15,'winding grip reaches around the torso');
 const warped=segments.slice(-7).map(n=>({x:n.position.x+fx.root.position.x,z:n.position.z+fx.root.position.z}));
 assert.ok(Math.max(...warped.map(n=>Math.hypot(n.x-x.heroRoot.position.x,n.z-x.heroRoot.position.z)))<2,'coils genuinely occupy the area surrounding the target');
 assert.ok(fx.gripPads.some(x=>x.enabled),'suction cups follow the wrapping curve');
 const once=builds;
 for(let t=1600;t<2000;t+=30)x.tick(t);
 assert.equal(builds,once,'no geometry generation in the frame loop');
 x.tick(2400);
 assert.equal(fx.gripRig.enabled,false);assert.equal(fx.arms[2].joint.enabled,true);
 assert.equal(x.victim.x,3,'gameplay x/y are never overridden by visual lift');
 assert.equal(x.victim.y,3);
 x.visual.dispose();
});
test('grip starts only for matching official target and sequence, map transitions clear stale actions',()=>{
 const x=create();x.visual.sync(x.snapshot,[x.action,{...x.pull,unitId:'other'}]);
 assert.equal(x.visual.entries.get('kraken').pendingGrabs.length,0);
 x.visual.sync(x.snapshot,[x.action,{...x.pull,sequence:2}]);
 assert.equal(x.visual.entries.get('kraken').pendingGrabs.length,0);
 x.visual.sync(x.snapshot,[x.action,x.pull]);
 assert.equal(x.visual.entries.get('kraken').pendingGrabs.length,1);
 x.visual.sync(x.snapshot,[x.action,x.pull]);
 assert.equal(x.visual.entries.get('kraken').pendingGrabs.length,1,'deduplicate repeat revision');
 x.visual.sync({...x.snapshot,map:{...x.snapshot.map,id:'another-lake'}},[]);
 assert.equal(x.visual.entries.get('kraken').pendingGrabs.length,0);
 assert.equal(x.visual.seenGrabContacts.size,0);
 x.visual.dispose();
});
test('VfxManager consumes existing UNIT_ANIMATION without inventing a separate network event',()=>{
 assert.match(source,/this\.waterLurker\.sync\(snapshot,events\)/);
 assert.match(source,/new WaterLurkerSurfaceModel\(scene,\{units:this\.units\}\)/);
 assert.match(source,/kind==='FORCED_MOVE'/);
 assert.doesNotMatch(source,/emitPresentation\(['"]WATER_LURKER_GRAB/);
});
