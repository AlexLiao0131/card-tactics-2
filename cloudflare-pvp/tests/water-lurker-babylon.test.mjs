import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const code=readFileSync(new URL('../../js/vfx-manager.js',import.meta.url),'utf8');
const section=code.split('class WaterLurkerSurfaceModel{')[1]?.split('const factories=Object.freeze({')[0];
assert.ok(section,'The existing VfxManager must own the water monster geometry');

class Vec{
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  setAll(v){return this.set(v,v,v);}
}
class Node{
  constructor(name){this.name=name;this.position=new Vec();this.rotation=new Vec();this.scaling=new Vec(1,1,1);this.children=[];this.enabled=true;this.disposed=false;}
  set parent(next){this._parent?.children.splice(this._parent.children.indexOf(this),1);
    this._parent=next;if(next)next.children.push(this);}
  get parent(){return this._parent;}
  getChildMeshes(){return this.children.flatMap(ch=>[...(ch.isMesh?[ch]:[]),...ch.getChildMeshes()]);}
  setEnabled(value){this.enabled=value;}
  dispose(){this.disposed=true;for(const child of [...this.children])child.dispose();this.children=[];}
}
class Material{constructor(name){this.name=name;this.disposed=false;}dispose(){this.disposed=true;}}
const BABYLON={TransformNode:Node,StandardMaterial:Material,Color3:class Color3{constructor(...rgb){this.rgb=rgb}},MeshBuilder:Object.fromEntries(
  ['CreateSphere','CreateCylinder','CreateTorus'].map(name=>[name,(id)=>{
    const mesh=new Node(id);mesh.isMesh=true;return mesh;
  }]))};
const Klass=vm.runInNewContext('class WaterLurkerSurfaceModel{'+section+';WaterLurkerSurfaceModel',
  {BABYLON,TILE_SIZE:2,ELEVATION_HEIGHT:1,performance:{now:()=>1000},Map,Set,Math,Number,String});
function fixture(){const scene={onDisposeObservable:{addOnce:()=>{}}};const visual=new Klass(scene);
  const unit={id:'n-water',visualId:'water_lurker_default',alive:true,x:2,y:3,
    footprint:{width:2,height:2},z:0};
  const map={id:'lake',tiles:Array.from({length:16},(_,i)=>({x:2+i%4,y:3+Math.floor(i/4),waterSurfaceZ:4}))};
  return {visual,unit,map};}
test('真 Babylon 本體在水面下，五根由五節與吸盤構成的觸手可動',()=>{
  const {visual,unit,map}=fixture();visual.sync({map,units:[unit]});
  const fx=visual.entries.get('n-water');assert.ok(fx);
  assert.equal(fx.arms.length,5);
  assert.ok(fx.arms.every(arm=>arm.pivots.length===5));
  assert.equal(fx.head.position.y<0,true,'Mantle remains submerged');
  assert.equal(fx.root.position.y,4,'Use existing actual waterSurfaceZ rather than a fixed elevation');
  assert.equal(fx.root.position.x,5);assert.equal(fx.root.position.z,7);
  assert.ok(fx.root.getChildMeshes().filter(mesh=>mesh.name.includes('lurker-tentacle')).length===25);
  assert.ok(fx.root.getChildMeshes().filter(mesh=>mesh.name.includes('lurker-sucker')).length>=15);
  visual.dispose();assert.ok(fx.root.disposed);
});
test('實際水位改變、觸手動作／打擊事件依同一個 VfxManager frame 更新',()=>{
  const {visual,unit,map}=fixture();visual.sync({map,units:[unit]});
  const fx=visual.entries.get(unit.id),before=fx.arms[0].joint.rotation.z;
  visual.updateFrame(1200);assert.notEqual(fx.arms[0].joint.rotation.z,before);
  map.tiles.forEach(tile=>tile.waterSurfaceZ=6);
  visual.sync({map,units:[unit]});assert.equal(fx.root.position.y,6);
  visual.sync({map,units:[unit]},[{type:'UNIT_ANIMATION',unitId:unit.id,state:'ATTACK'}]);
  assert.ok(fx.lastAttackTime!=null);visual.updateFrame(1330);
  visual.dispose();
});
test('單位死亡或離開視野即清除所有觸手 Mesh，其他怪物不重複生成',()=>{
  const {visual,unit,map}=fixture();visual.sync({map,units:[unit]});
  const fx=visual.entries.get(unit.id);
  visual.sync({map,units:[unit]});assert.equal(visual.entries.size,1);
  visual.sync({map,units:[{...unit,alive:false}]});assert.equal(visual.entries.size,0);
  assert.ok(fx.root.disposed);
  visual.dispose();
});
