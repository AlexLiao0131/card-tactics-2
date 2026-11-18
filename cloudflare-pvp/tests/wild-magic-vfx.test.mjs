import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

class Vector3{
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  setAll(n){this.x=this.y=this.z=n;return this;}
  copyFrom(v){return this.set(v.x,v.y,v.z)}
  clone(){return new Vector3(this.x,this.y,this.z)}
  add(v){return new Vector3(this.x+v.x,this.y+v.y,this.z+v.z)}
  subtract(v){return new Vector3(this.x-v.x,this.y-v.y,this.z-v.z)}
  scale(v){return new Vector3(this.x*v,this.y*v,this.z*v)}
  normalize(){const n=Math.hypot(this.x,this.y,this.z)||1;return this.scale(1/n)}
  static Lerp(a,b,t){return a.add(b.subtract(a).scale(t))}
}
class TransformNode{
  constructor(name,scene){this.name=name;this.scene=scene;this.position=new Vector3();this.rotation=new Vector3();this.scaling=new Vector3(1,1,1);this.visibility=1;this.enabled=true;this.disposed=false;scene.nodes.push(this);}
  setEnabled(x){this.enabled=x}
  dispose(){this.disposed=true}
  isDisposed(){return this.disposed}
  getAbsolutePosition(){return this.position.clone()}
}
class StandardMaterial{
  constructor(name,scene){this.name=name;scene.materials.push(this)}
  dispose(){this.disposed=true}
}
class Color3{constructor(r,g,b){this.r=r;this.g=g;this.b=b}}
const scene=()=>({nodes:[],materials:[],onDisposeObservable:{addOnce:()=>{}}});
const Shape=Object.fromEntries(['CreateTorus','CreateSphere','CreateBox','CreateCylinder','CreateTube'].map(name=>[name,(label,options,s)=>{
  const m=new TransformNode(label,s);m.geometry=name;m.parameters=options;return m;
}]));
globalThis.BABYLON={Vector3,StandardMaterial,Color3,TransformNode,MeshBuilder:Shape,Engine:{ALPHA_ADD:1}};
globalThis.CardDatabase={get:id=>id==='starfall_card'?{effect:{presentation:{type:'METEOR_STRIKE',fallDuration:650,impactDuration:700}}}:null};
globalThis.SkillDatabase={get:id=>id==='avreshi_starfall'?{radius:2}:null};
const {VfxDatabase}=await import('../../js/vfx-database.js');
const {WildMagicVfx}=await import('../../js/wild-magic-vfx.js');
const unit={id:'av',characterId:'avreshi',alive:true,x:1,y:1,renderZ:0,effects:[]};
const enemy={id:'enemy',alive:true,x:3,y:2,renderZ:0,effects:[]};
const ally={id:'ally',alive:true,x:3,y:2,renderZ:0,effects:[]};
const snap=(units=[unit,enemy])=>({map:{id:'test',tiles:[{x:1,y:1,elevation:0},{x:3,y:2,elevation:0}]},round:1,units});
let seq=100;
const event=(skillId,{targetId='enemy',targetX=3,targetY=2}={})=>({type:'UNIT_ANIMATION',sequence:++seq,unitId:'av',characterId:'avreshi',skillId,x:1,y:1,targetId,targetX,targetY,targetKind:targetId==null?'MAP':'UNIT'});
const draw=skillId=>{const s=scene(),v=new WildMagicVfx(s);const e=event(skillId);v.sync(snap(),[e]);assert.ok(v.active.length,'expected visual playback receipt');v.updateFrame(v.active[0].started+380);return{s,v,fx:v.active[0]};};

test('four distinct offensive VFX do not route through Ophi nature WRATH or Nereia trident',()=>{
 const old=['nature-growth','aquatic-magic','blade-stealth'];
 for(const id of ['avreshi_moonfire','avreshi_wrath','avreshi_starfall','avreshi_lightning','avreshi_claw','avreshi_bite','avreshi_shred','avreshi_pounce','avreshi_hide','avreshi_rejuvenation','avreshi_spear_throw']){
   const routes=VfxDatabase.routeSkill(id);
   assert.deepEqual(routes,['wild-magic'],`${id} routed as ${routes}`);
   assert.ok(!routes.some(x=>old.includes(x)));
 }
 for(const id of ['avreshi_whirlpool','avreshi_press'])assert.ok(VfxDatabase.routeSkill(id).includes('aquatic-magic'));
});

test('moonfire really uses a sky-to-ground vertical beam, not a natural projectile',()=>{
 const {v,fx,s}=draw('avreshi_moonfire');
 assert.equal(fx.kind,'MOONBEAM');
 assert.equal(fx.root.position.x,6);assert.equal(fx.root.position.z,4);
 assert.ok(fx.beamShell.name.includes('sky-column'));
 assert.equal(fx.skyRing.position.y,8.2);
 const now=fx.started;
 v.updateFrame(now+75);const small=fx.beamShell.scaling.y;
 v.updateFrame(now+400);const full=fx.beamShell.scaling.y;
 assert.ok(full>small,`beam descends from sky: ${small} to ${full}`);
 assert.ok(fx.beamShell.position.y+full/2>=8.19,'top remains fixed at the sky opening');
 assert.ok(s.nodes.some(x=>x.name.includes('moonfire-ground-impact')));
});

test('wrath, moonbloom rejuvenation, spear and feline marks use different geometry',()=>{
 assert.equal(draw('avreshi_wrath').fx.thorns.length,9);
 assert.equal(draw('avreshi_wrath').fx.roots.length,6);
 assert.equal(draw('avreshi_wrath').fx.fissures.length,5);
 assert.equal(draw('avreshi_claw').fx.slashes.length,3);
 assert.equal(draw('avreshi_shred').fx.slashes.length,7);
 assert.equal(draw('avreshi_bite').fx.fangs.length,4);
 assert.equal(draw('avreshi_bite').fx.jaws.length,2);
 assert.equal(draw('avreshi_pounce').fx.jaws.length,2);
 assert.ok(draw('avreshi_pounce').fx.pounceRing);
 assert.equal(draw('avreshi_rejuvenation').fx.petals.length,8);
 assert.equal(draw('avreshi_rejuvenation').fx.stems.length,3);
 assert.ok(draw('avreshi_spear_throw').fx.shaft);
 assert.ok(draw('avreshi_spear_thrust').fx.thrust);
 assert.equal(draw('avreshi_hide').fx.hidePaws.length,3);
 assert.equal(draw('avreshi_hide').fx.hideToes.length,9);
});

test('Ophi forest-song geometry cannot masquerade as Druid moonbloom, wrath or feline stealth',()=>{
 const wrath=draw('avreshi_wrath');
 assert.ok(wrath.s.nodes.some(n=>n.name.includes('wrath-earth-fissure')));
 assert.ok(wrath.s.nodes.some(n=>n.name.includes('wrath-rising-root')));
 assert.ok(!wrath.s.nodes.some(n=>/forest-wrath-missile|wrath-force-core|wrath-nature-front/.test(n.name)));
 const healing=draw('avreshi_rejuvenation');
 assert.ok(healing.s.nodes.some(n=>n.name.includes('moonbloom-petal')));
 assert.ok(healing.s.nodes.some(n=>n.name.includes('moonbloom-healing-vine')));
 assert.ok(!healing.s.nodes.some(n=>/song-note|healing-song|rejuvenation-sylvan-circle|rejuvenation-life-spark/.test(n.name)));
 const feline=draw('avreshi_hide');
 assert.ok(feline.s.nodes.some(n=>n.name.includes('feline-stealth-footprint')));
 assert.ok(!feline.s.nodes.some(n=>/feline-silent-leaf|feline-camouflage-leaf-vortex/.test(n.name)));
});

test('rejuvenation status creates a live-following aura and is removed on cleanse/expiry',()=>{
 const s=scene(),v=new WildMagicVfx(s);const heal={...ally,effects:[{id:'AVRESHI_REJUVENATION',type:'HEAL_OVER_TIME'}]};
 v.sync(snap([unit,heal]),[]);
 assert.equal(v.auras.size,1);
 assert.ok(v.auras.has('REJUVENATION:ally'));
 v.updateFrame(performance.now()+50);
 v.sync(snap([unit,enemy]),[]);
 assert.equal(v.auras.size,0);
});

test('environment-owned meteor and lightning produce no second geometry',()=>{
 const s=scene(),v=new WildMagicVfx(s);
 v.sync(snap(),[event('avreshi_starfall',{targetId:null}),event('avreshi_lightning')]);
 assert.equal(v.active.length,2);
 assert.ok(v.active.every(e=>!e.root));
 assert.ok(v.active.some(e=>e.kind==='METEOR'&&e.duration===1350));
 assert.ok(v.active.some(e=>e.kind==='LIGHTNING'&&e.duration===620));
 v.updateFrame(performance.now()+2000);assert.equal(v.active.length,0);
 const initial=s.nodes.length;
 v.sync(snap(),[event('avreshi_tornado',{targetId:null})]);
 assert.equal(s.nodes.length,initial,'tornado is drawn by official EnvironmentRenderer');
});

// Exercise the REAL current EnvironmentRenderer class method in isolation.
// This confirms the new spell bridge invokes precisely the existing geometry
// methods, without asking the skill VFX module to emulate an environment.
function classMethod(source,name){
 const marker=`  ${name}(events,state){`,start=source.indexOf(marker);
 assert.ok(start>=0,`method ${name} missing`);
 let depth=0,end=-1;const brace=source.indexOf('{',start);
 for(let i=brace;i<source.length;i++){
  if(source[i]==='{')depth++;
  else if(source[i]==='}'&&--depth===0){end=i;break}
 }
 assert.ok(end>start);
 return new Function('events','state',source.slice(brace+1,end));
}
test('existing environment Lightning / Meteor renderer is called once at the target, not duplicated',()=>{
 const src=readFileSync(new URL('../../js/environment-renderer.js',import.meta.url),'utf8');
 const dispatch=classMethod(src,'syncPresentationEvents');
 const calls=[],environment={seenPresentationSequences:new Set(),lastLightningToken:'',
  createMeteorStrike:(e,s)=>calls.push(['meteor',e,s]),createLightningBurst:(e,s)=>calls.push(['lightning',e,s])};
 const events=[event('avreshi_starfall',{targetId:null}),event('avreshi_lightning'),event('avreshi_tornado',{targetId:null})];
 const state=snap();dispatch.call(environment,events,state);dispatch.call(environment,events,state);
 assert.deepEqual(calls.map(c=>c[0]),['meteor','lightning']);
 const m=calls[0][1];assert.equal(m.x,3);assert.equal(m.y,2);assert.equal(m.lunar,true);
 assert.equal(m.fallDuration,650);assert.equal(m.impactDuration,700);
 assert.equal(calls[1][1].x,3);
});

test('canonical falling meteor creates the original geometry with a moon-white palette',()=>{
 const src=readFileSync(new URL('../../js/environment-renderer.js',import.meta.url),'utf8');
 const marker='  createMeteorStrike(event,state){',start=src.indexOf(marker);
 assert.ok(start>=0);let depth=0,end=-1,brace=src.indexOf('{',start);
 for(let i=brace;i<src.length;i++){
   if(src[i]==='{')depth++;
   else if(src[i]==='}'&&--depth===0){end=i;break}
 }
 const create=new Function('event','state','hash01','TILE_SIZE','BABYLON',src.slice(brace+1,end));
 const s=scene(),mats=Object.fromEntries(['meteorRock','meteorHot','meteorBlast','shockwave','meteorDust','fragments'].map(k=>[k,new StandardMaterial(k,s)]));
 const gl={scene:s,materials:mats,meteorBursts:[],
   mat:(id,color,alpha)=>{const m=new StandardMaterial(id,s);m.color=color;m.alpha=alpha;return m},
   root:name=>new TransformNode(name,s),
   addMesh:(root,mesh,mat)=>{mesh.parent=root;mesh.material=mat;return mesh},
   meteorTargetY:()=>0};
 BABYLON.MeshBuilder.CreatePolyhedron=Shape.CreateBox;
 BABYLON.PointLight=class{constructor(name,position,scene){this.name=name;this.position=position;scene.nodes.push(this)}dispose(){this.disposed=true}};
 const ev={x:3,y:2,sequence:301,lunar:true,fallDuration:650,impactDuration:700,innerRadius:2,shockwaveRadius:2};
 create.call(gl,ev,snap(),()=>.31,2,BABYLON);
 assert.equal(gl.meteorBursts.length,1);
 const result=gl.meteorBursts[0];
 assert.equal(result.body.material,gl.materials.lunarMeteorRock);
 assert.ok(result.moonHalo,'lunar meteor orbits the original falling rock');
 assert.ok(result.moonImpactRing,'moon impact is visible independently of ordinary fiery starfall');
 assert.equal(result.blast.material,gl.materials.lunarMeteorBlast);
 assert.equal(result.tails.length,4);
 assert.equal(result.debris.length,8);
 assert.equal(result.fallDuration,.65);
 assert.equal(result.impactDuration,.7);
 assert.ok(result.flash.diffuse.b>result.flash.diffuse.r);
 // Ordinary starfall continues using its ORIGINAL fiery materials.
 create.call(gl,{...ev,lunar:false,sequence:302},snap(),()=>.31,2,BABYLON);
 assert.equal(gl.meteorBursts[1].body.material,gl.materials.meteorRock);
 assert.equal(gl.meteorBursts[1].moonHalo,null);
 assert.equal(gl.meteorBursts[1].moonImpactRing,null);
});

test('fresh Babylon module graph loads the new Moonmark VFX, not cached legacy hero effects',()=>{
 const main=readFileSync(new URL('../../js/babylon-renderer.js',import.meta.url),'utf8');
 const manager=readFileSync(new URL('../../js/vfx-manager.js',import.meta.url),'utf8');
 const druid=readFileSync(new URL('../../js/wild-magic-vfx.js',import.meta.url),'utf8');
 const rev='20261118-avreshi-vfx-2';
 assert.ok(main.includes(`./vfx-manager.js?rev=${rev}`));
 assert.ok(main.includes(`./environment-renderer.js?rev=${rev}`));
 assert.ok(manager.includes(`./wild-magic-vfx.js?rev=${rev}`));
 assert.ok(manager.includes(`./vfx-database.js?rev=${rev}`));
 assert.ok(druid.includes(`./vfx-database.js?rev=${rev}`));
});

test('real existing lightning geometry builds a persistent, visible spell strike with ground contact',()=>{
 const src=readFileSync(new URL('../../js/environment-renderer.js',import.meta.url),'utf8');
 const method=(name,args)=>{
   const marker=`  ${name}(${args}){`,start=src.indexOf(marker);
   assert.ok(start>=0,`${name} found`);
   const brace=src.indexOf('{',start);let depth=0,end=-1;
   for(let i=brace;i<src.length;i++){
     if(src[i]==='{')depth++;
     else if(src[i]==='}'&&--depth===0){end=i;break;}
   }
   assert.ok(end>brace);return src.slice(brace+1,end);
 };
 const create=new Function('event','state','BABYLON','TILE_SIZE','hash01',method('createLightningBurst','event,state'));
 const update=new Function('dt','clamp',method('updateLightning','dt'));
 const s=scene();BABYLON.Mesh={CAP_ALL:1};
 const lines=(name,opts,s)=>{const shape=new TransformNode(name,s);shape.geometry='LINES';return shape;};
 BABYLON.MeshBuilder.CreateLines=lines;
 const holder={scene:s,lightningBursts:[],lightningFlash:{intensity:0},
   materials:{lightningBolt:new StandardMaterial('lightning-bolt',s)},lightningTargetY:()=>0};
 create.call(holder,{x:3,y:2,sequence:711,skillId:'avreshi_lightning'},snap(),BABYLON,2,()=>.44);
 assert.equal(holder.lightningBursts.length,1);
 const burst=holder.lightningBursts[0];
 assert.equal(burst.duration,1.22);
 assert.equal(burst.spell,true);
 assert.ok(burst.impact);
 assert.ok(burst.meshes.some(m=>m.name.includes('lightning-body')));
 assert.ok(burst.meshes.some(m=>m.name.includes('ground-fan')));
 update.call(holder,.42,(v,lo,hi)=>Math.max(lo,Math.min(hi,v)));
 assert.ok(burst.impact.visibility>.1,'spell ground strike must remain visible after first flash');
 update.call(holder,.85,(v,lo,hi)=>Math.max(lo,Math.min(hi,v)));
 assert.equal(holder.lightningBursts.length,0);
 assert.ok(burst.meshes.every(m=>m.disposed),'all lightning geometry must be cleaned up');
});

test('starfall and lightning dispatch from authentic unit-animation-shaped events exactly once',()=>{
 const src=readFileSync(new URL('../../js/environment-renderer.js',import.meta.url),'utf8');
 const dispatch=classMethod(src,'syncPresentationEvents');
 const calls=[],environment={seenPresentationSequences:new Set(),lastLightningToken:'',
   createMeteorStrike:(e,s)=>calls.push({kind:'meteor',event:e}),
   createLightningBurst:(e,s)=>calls.push({kind:'lightning',event:e})};
 const skill=(id,seq)=>({type:'UNIT_ANIMATION',sequence:seq,
   state:'CAST',duration:520,unitId:'av',visualId:'avreshi_human',
   characterId:'avreshi',x:1,y:1,z:0,
   skillId:id,targetId:id==='avreshi_starfall'?null:'enemy',targetX:3,targetY:2});
 const events=[skill('avreshi_starfall',311),skill('avreshi_lightning',312)];
 dispatch.call(environment,events,snap());dispatch.call(environment,events,snap());
 assert.deepEqual(calls.map(c=>c.kind),['meteor','lightning']);
 assert.equal(calls[0].event.lunar,true);
 assert.equal(calls[1].event.skillId,'avreshi_lightning');
});
