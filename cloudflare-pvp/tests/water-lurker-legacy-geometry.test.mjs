import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../../js/vfx-manager.js',import.meta.url),'utf8');
const section=code.split('class WaterLurkerSurfaceModel{')[1]?.split('const factories=Object.freeze({')[0];
assert.ok(section);
class Vec{constructor(x=0,y=0,z=0){this.set(x,y,z)}set(x,y,z){this.x=x;this.y=y;this.z=z}setAll(v){this.set(v,v,v)}}
class Node{
 constructor(name){this.name=name;this.position=new Vec();this.rotation=new Vec();this.scaling=new Vec(1,1,1);this.children=[];this.enabled=true;this.disposed=false}
 set parent(next){this._parent?.children.splice(this._parent.children.indexOf(this),1);this._parent=next;if(next)next.children.push(this)}
 get parent(){return this._parent}
 getChildMeshes(){return this.children.flatMap(ch=>[...(ch.isMesh?[ch]:[]),...ch.getChildMeshes()])}
 setEnabled(value){this.enabled=value}
 dispose(){this.disposed=true;for(const child of [...this.children])child.dispose();this.children=[]}
}
class Material{dispose(){this.disposed=true}}
const BABYLON={TransformNode:Node,StandardMaterial:Material,Color3:class{constructor(...x){this.rgb=x}},MeshBuilder:Object.fromEntries(['CreateSphere','CreateCylinder','CreateTorus'].map(n=>[n,(name)=>{const mesh=new Node(name);mesh.isMesh=true;return mesh}]))};
const Klass=vm.runInNewContext('class WaterLurkerSurfaceModel{'+section+';WaterLurkerSurfaceModel',{BABYLON,TILE_SIZE:2,ELEVATION_HEIGHT:1,performance:{now:()=>1000},Map,Set,Math,Number,String});
function fixture(){const scene={onDisposeObservable:{addOnce:()=>{}}};const visual=new Klass(scene);
 const unit={id:'n-water',visualId:'water_lurker_default',alive:true,x:2,y:3,footprint:{width:2,height:2},z:0};
 const map={id:'lake',tiles:Array.from({length:16},(_,i)=>({x:2+i%4,y:3+Math.floor(i/4),waterSurfaceZ:4}))};
 return{visual,unit,map};}
test('legacy surface monster: 5 actual five-jointed tentacles with suckers, head and 2x2 anchoring',()=>{
 const {visual,unit,map}=fixture();visual.sync({map,units:[unit]});const fx=visual.entries.get(unit.id);
 assert.ok(fx);assert.equal(fx.arms.length,5);assert.ok(fx.arms.every(arm=>arm.pivots.length===5));
 assert.ok(fx.head.position.y<0);assert.equal(fx.root.position.y,4);assert.equal(fx.root.position.x,5);assert.equal(fx.root.position.z,7);
 assert.equal(fx.root.getChildMeshes().filter(m=>m.name.includes('lurker-tentacle')).length,25);
 assert.ok(fx.root.getChildMeshes().filter(m=>m.name.includes('lurker-sucker')).length>=15);
 visual.dispose();assert.ok(fx.root.disposed);
});
test('legacy up/down and water level are authoritative, rendering updates in same VfxManager frame',()=>{
 const {visual,unit,map}=fixture();visual.sync({map,units:[unit]});const fx=visual.entries.get(unit.id),before=fx.arms[0].joint.rotation.z;
 visual.updateFrame(1200);assert.notEqual(fx.arms[0].joint.rotation.z,before);
 map.tiles.forEach(tile=>tile.waterSurfaceZ=6);visual.sync({map,units:[unit]});assert.equal(fx.root.position.y,6);
 visual.sync({map,units:[unit]},[{type:'UNIT_ANIMATION',unitId:unit.id,state:'ATTACK'}]);assert.ok(fx.lastAttackTime!=null);
 visual.sync({map,units:[{...unit,verticalMode:'DIVING'}]});visual.updateFrame(1400);assert.equal(fx.targetDive,1);
 visual.dispose();
});
test('legacy disposal: dead and unseen monsters immediately release all tentacle meshes',()=>{
 const {visual,unit,map}=fixture();visual.sync({map,units:[unit]});const fx=visual.entries.get(unit.id);
 visual.sync({map,units:[unit]});assert.equal(visual.entries.size,1);
 visual.sync({map,units:[{...unit,alive:false}]});assert.equal(visual.entries.size,0);assert.ok(fx.root.disposed);
 visual.dispose();
});
