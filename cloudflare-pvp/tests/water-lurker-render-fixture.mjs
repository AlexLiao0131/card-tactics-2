import {UnitRenderer} from '../../js/unit-renderer.js';
import '../../js/visual-database.js';
export class Vec {
  constructor(x=0,y=0,z=0){this.set(x,y,z)}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
  setAll(n){return this.set(n,n,n)}
  copyFrom(v){return this.set(v.x,v.y,v.z)}
  scale(n){return new Vec(this.x*n,this.y*n,this.z*n)}
}
class Q{constructor(){this.set(0,0,0,1)}set(x,y,z,w){Object.assign(this,{x,y,z,w});return this}}
class Node{
  constructor(name){this.name=name;this.position=new Vec();this.rotation=new Vec();this.scaling=new Vec(1,1,1);this.children=[];this.enabled=true;this.disposed=false;this.isMesh=false}
  set parent(p){if(this._parent){const i=this._parent.children.indexOf(this);if(i>=0)this._parent.children.splice(i,1)}this._parent=p;if(p)p.children.push(this)}
  get parent(){return this._parent}
  getChildMeshes(){return this.children.flatMap(c=>[...(c.isMesh?[c]:[]),...c.getChildMeshes()])}
  setEnabled(on){this.enabled=on}
  dispose(){this.disposed=true;for(const c of [...this.children])c.dispose();this.children=[]}
  isDisposed(){return this.disposed}
}
class Material{constructor(name){this.name=name;this.diffuseColor=new Vec();this.emissiveColor=new Vec();this.specularColor=new Vec()}dispose(){this.disposed=true}}
let builds=0;
function primitive(name){builds++;const n=new Node(name);n.isMesh=true;n.rotationQuaternion=new Q();n.createInstance=name=>primitive(name);return n}
globalThis.BABYLON={TransformNode:Node,Vector3:Vec,Quaternion:Q,StandardMaterial:Material,Color3:Vec,
  MeshBuilder:Object.fromEntries(['CreateSphere','CreateCylinder','CreateTorus','CreateCapsule'].map(n=>[n,primitive]))};
export function fixture(){
  const scene={onDisposeObservable:{addOnce(){}}},renderer=new UnitRenderer(scene);
  renderer.createFacingMarker=()=>({root:new Node('marker'),meshes:[]});
  renderer.createAnimationBadge=()=>null;renderer.createVerticalCue=()=>null;
  const monster={id:'oct',monsterId:'water_lurker',visualId:'water_lurker_default',alive:true,x:2,y:2,z:0,footprint:{width:2,height:2},facing:'S',verticalMode:'SWIMMING'};
  const hero={id:'hero',alive:true,team:'PLAYER',x:5,y:2,z:0,renderZ:0,facing:'W',collisionHeight:1.7};
  const map={id:'lake',tiles:Array.from({length:64},(_,i)=>({x:i%8,y:Math.floor(i/8),waterSurfaceZ:3}))};
  const snapshot={map,units:[monster,hero],revision:1};
  const action={type:'UNIT_ANIMATION',sequence:10,unitId:'oct',state:'ATTACK',skillId:'water_tentacle',targetId:'hero',x:2,y:2,z:0,facing:'E',duration:800};
  const pull={type:'UNIT_ANIMATION',sequence:15,unitId:'hero',state:'WALK',kind:'FORCED_MOVE',path:[{x:5,y:2,z:0},{x:4,y:2,z:0}],duration:360};
  const sync=(events=[],units=snapshot.units)=>renderer.sync({...snapshot,units},events);
  const tick=now=>renderer.updateFrame(now);
  return {renderer,monster,hero,map,snapshot,action,pull,sync,tick,builds:()=>builds,entry:()=>renderer.entries.get('oct'),victim:()=>renderer.entries.get('hero')};
}
