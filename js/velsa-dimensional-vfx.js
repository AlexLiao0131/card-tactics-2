/**
 * Shared Babylon presentation of Velsa's five dimensional spells and backlash.
 * All meshes are visual-only. SkillDatabase / BattleResolution / EffectEngine
 * retain full authority over targets, hit rolls, damage, Sanity and MP.
 * One existing BabylonRenderer clock; no timers, additional lights or textures.
 */
import {TILE_SIZE,ELEVATION_HEIGHT} from './coordinate-system.js';

const SPELLS=Object.freeze({
  velsa_arcane_bolt:'BOLT',
  velsa_cognitive_corruption:'CORRUPTION',
  velsa_space_fold:'FOLD',
  velsa_dimension_collapse:'COLLAPSE',
  velsa_existence_breakdown:'BREAKDOWN'
});
const DURATION=Object.freeze({BOLT:1120,CORRUPTION:1160,FOLD:1050,COLLAPSE:1290,BREAKDOWN:1270,BACKLASH:900});
const clamp=t=>Math.min(1,Math.max(0,Number(t)||0));
const smooth=t=>{const x=clamp(t);return x*x*(3-2*x)};
const v=(x,y,z)=>new BABYLON.Vector3(x,y,z);
const lerp=(a,b,t)=>a+(b-a)*t;

export function isVelsaSpellPresentationEvent(event){
  return !!event&&event.type==='UNIT_ANIMATION'&&event.skillId in SPELLS&&
    Number.isFinite(event.targetX)&&Number.isFinite(event.targetY);
}
export class VelsaDimensionalVfx{
  constructor(scene){
    this.scene=scene;this.active=[];this.auras=new Map();this.recent=new Set();this.mapId=null;this.round=null;
    this.materials={
      dark:this.material('velsa-void',[.08,.025,.20],.91),
      violet:this.material('velsa-violet',[.42,.09,.94],.87),
      bright:this.material('velsa-fissure',[.82,.46,1],.93),
      haze:this.material('velsa-distortion',[.31,.10,.65],.48)
    };
    scene.onDisposeObservable?.addOnce?.(()=>this.dispose());
  }
  material(name,rgb,alpha){
    const m=new BABYLON.StandardMaterial(name,this.scene);
    m.diffuseColor=new BABYLON.Color3(...rgb);
    m.emissiveColor=new BABYLON.Color3(...rgb);
    m.alpha=alpha;m.disableLighting=true;m.backFaceCulling=false;
    if(BABYLON.Engine?.ALPHA_ADD!==undefined)m.alphaMode=BABYLON.Engine.ALPHA_ADD;
    return m;
  }
  mesh(root,name,geometry,options,material){
    const m=BABYLON.MeshBuilder[geometry](name,options,this.scene);
    m.parent=root;m.material=this.materials[material]||this.materials.violet;
    m.isPickable=false;m.receiveShadows=false;m.metadata={castShadow:false};
    return m;
  }
  torus(root,name,diameter,material='violet'){
    const m=this.mesh(root,name,'CreateTorus',
      {diameter,thickness:.075,tessellation:22},material);
    return m;
  }
  sphere(root,name,diameter,material='bright'){
    return this.mesh(root,name,'CreateSphere',{diameter,segments:9},material);
  }
  shard(root,name,index,count,radius,material='violet'){
    const m=this.mesh(root,name,'CreateBox',
      {width:.10,height:.32,depth:.08},material);
    const a=2*Math.PI*index/count;
    m.position.set(Math.cos(a)*radius,Math.sin(a*2)*.28,Math.sin(a)*radius);
    m.rotation.set(a*.48,a,.35+a);
    return m;
  }
  height(snapshot,x,y){
    const unit=(snapshot?.units||[]).find(u=>u.x===x&&u.y===y&&u.alive!==false);
    if(unit&&Number.isFinite(Number(unit.renderZ??unit.z)))
      return Number(unit.renderZ??unit.z)*ELEVATION_HEIGHT;
    const tile=(snapshot?.map?.tiles||[]).find(t=>t.x===x&&t.y===y);
    return Number(tile?.elevation||0)*ELEVATION_HEIGHT;
  }
  point(snapshot,x,y,above=1){return v(x*TILE_SIZE,this.height(snapshot,x,y)+above,y*TILE_SIZE)}
  group(kind,event,snapshot,now){
    const sourceX=Number.isFinite(event.x)?Number(event.x):Number(event.targetX);
    const sourceY=Number.isFinite(event.y)?Number(event.y):Number(event.targetY);
    const targetX=Number(event.targetX),targetY=Number(event.targetY);
    const source=this.point(snapshot,sourceX,sourceY,1.23);
    const target=this.point(snapshot,targetX,targetY,.78);
    const root=new BABYLON.TransformNode(`velsa-${kind.toLowerCase()}-source`,this.scene);
    root.position.copyFrom(source);
    const impact=new BABYLON.TransformNode(`velsa-${kind.toLowerCase()}-target`,this.scene);
    impact.position.copyFrom(target);
    const fx={kind,root,impact,source,target,started:now,parts:[],duration:DURATION[kind]||1100,skillId:event.skillId};
    const r=this.torus(root,'velsa-caster-sigil',.80,'bright');r.rotation.x=Math.PI/2;
    fx.parts.push(r);
    if(kind==='BOLT'){
      fx.orb=this.sphere(root,'velsa-arcane-projectile',.29,'dark');
      fx.orbCore=this.sphere(root,'velsa-arcane-core',.14,'bright');
      fx.trails=Array.from({length:3},(_,i)=>this.sphere(root,`velsa-trail-${i}`,.13-i*.025,'haze'));
      fx.impactRing=this.torus(impact,'velsa-bolt-impact',.78,'violet');fx.impactRing.rotation.x=Math.PI/2;
    }else if(kind==='CORRUPTION'){
      fx.targetRings=[this.torus(impact,'velsa-perception-fracture-a',1.38,'violet'),
        this.torus(impact,'velsa-perception-fracture-b',1.0,'bright')];
      fx.parts.push(...Array.from({length:6},(_,i)=>this.shard(impact,`velsa-false-memory-${i}`,i,6,.8,'haze')));
    }else if(kind==='FOLD'){
      fx.sourceRings=[this.torus(root,'velsa-wormhole-entry-a',1.65,'violet'),
        this.torus(root,'velsa-wormhole-entry-b',1.2,'bright')];
      fx.targetRings=[this.torus(impact,'velsa-wormhole-exit-a',1.65,'violet'),
        this.torus(impact,'velsa-wormhole-exit-b',1.2,'bright')];
      for(const ring of [...fx.sourceRings,...fx.targetRings])ring.rotation.y=Math.PI/2;
    }else if(kind==='COLLAPSE'){
      fx.core=this.sphere(impact,'velsa-singularity',1.1,'dark');
      fx.rings=[this.torus(impact,'velsa-collapse-rift-a',1.9,'bright'),
        this.torus(impact,'velsa-collapse-rift-b',2.45,'violet'),
        this.torus(impact,'velsa-collapse-wave',TILE_SIZE*4,'haze')];
      fx.rings[0].rotation.x=Math.PI/2;fx.rings[1].rotation.z=Math.PI/2;
      fx.rings[2].rotation.x=Math.PI/2;
      fx.shards=Array.from({length:8},(_,i)=>this.shard(impact,`velsa-collapse-shard-${i}`,i,8,1.75,i%2?'bright':'violet'));
    }else if(kind==='BREAKDOWN'){
      fx.targetRings=[this.torus(impact,'velsa-existence-slice-a',1.55,'violet'),
        this.torus(impact,'velsa-existence-slice-b',1.1,'bright')];
      fx.shards=Array.from({length:9},(_,i)=>this.shard(impact,`velsa-disintegration-${i}`,i,9,.75,i%2?'bright':'dark'));
      const beamRoot=new BABYLON.TransformNode('velsa-existence-beam-root',this.scene);
      const delta=target.subtract(source),length=delta.length();
      beamRoot.position.copyFrom(source.add(target).scale(.5));
      const beam=this.mesh(beamRoot,'velsa-existence-ray','CreateBox',
        {width:.16,height:.20,depth:Math.max(.1,length)},'bright');
      beamRoot.lookAt(target);
      fx.beamRoot=beamRoot;fx.beam=beam;
    }else if(kind==='BACKLASH'){
      // Backlash travels from the actual wounded ally / area to the caster.
      fx.orb=this.sphere(impact,'velsa-backlash-return',.27,'bright');
      fx.targetRings=[this.torus(impact,'velsa-backlash-echo',.74,'violet')];
    }
    this.active.push(fx);
    while(this.active.length>5)this.remove(this.active.shift());
    return fx;
  }
  sync(snapshot,events=[]){
    const mapId=snapshot?.map?.id??null,round=Number(snapshot?.round||0);
    if(this.mapId!==null&&(this.mapId!==mapId||round<this.round))this.clear();
    this.mapId=mapId;this.round=round;
    const visible=new Set((snapshot?.units||[]).map(u=>String(u.id)));
    const now=performance.now();
    for(const e of events||[]){
      const backlash=e?.type==='VELSA_BACKLASH';
      if(!backlash&&!isVelsaSpellPresentationEvent(e))continue;
      if(!visible.has(String(e.unitId))||!Number.isFinite(e.targetX)||!Number.isFinite(e.targetY))continue;
      const key=Number.isSafeInteger(e.sequence)?`${mapId}:${e.sequence}:${e.unitId}`:null;
      if(key&&this.recent.has(key))continue;
      if(key){this.recent.add(key);if(this.recent.size>80)this.recent.delete(this.recent.values().next().value)}
      this.group(backlash?'BACKLASH':SPELLS[e.skillId],e,snapshot,now);
    }
    // The sanity aura follows the real, visible Velsa snapshot. It is a
    // passive readout, never an effect that modifies the combat world.
    const wanted=new Set();
    for(const unit of snapshot?.units||[]){
      if(unit.characterId!=='velsa'||unit.alive===false)continue;
      const state=unit.resources?.sanity;
      if(!state||!(Number(state.max)>0))continue;
      const depleted=clamp(1-Number(state.value)/Number(state.max));
      if(depleted<=0)continue;
      const id=String(unit.id);wanted.add(id);
      let aura=this.auras.get(id);
      if(!aura){
        const root=new BABYLON.TransformNode('velsa-sanity-aura',this.scene);
        const ring=this.torus(root,'velsa-sanity-ring',1.24,'haze');
        const fragments=Array.from({length:3},(_,i)=>this.shard(root,`velsa-sanity-fragment-${i}`,i,3,.70,'violet'));
        aura={root,ring,fragments,depleted};this.auras.set(id,aura);
      }
      aura.depleted=depleted;
      aura.root.position.set(unit.x*TILE_SIZE,Number(unit.renderZ??unit.z??0)*ELEVATION_HEIGHT+.35,unit.y*TILE_SIZE);
      aura.ring.rotation.x=Math.PI/2;
    }
    for(const [id,aura] of this.auras)if(!wanted.has(id)){aura.root.dispose(false,false);this.auras.delete(id)}
  }
  updateFrame(now=performance.now()){
    for(const aura of this.auras.values()){
      aura.root.rotation.y+=.012+.034*aura.depleted;
      aura.ring.visibility=.10+.52*aura.depleted;
      aura.ring.scaling.setAll(.78+.25*aura.depleted);
      aura.fragments.forEach((m,i)=>{m.rotation.y+=.012+.014*aura.depleted;
        m.visibility=.12+.7*aura.depleted;m.scaling.setAll(.25+.75*aura.depleted)})
    }
    for(let i=this.active.length-1;i>=0;i--){
      const f=this.active[i],t=Math.max(0,now-f.started),p=clamp(t/f.duration);
      if(t>=f.duration){this.remove(f);this.active.splice(i,1);continue;}
      f.root.rotation.y+=.015;f.parts[0].scaling.setAll(.3+.8*smooth(t/290));
      f.parts[0].visibility=(1-p)*.9;
      if(f.kind==='BOLT'){
        const travel=smooth((t-240)/520);
        const travelPoint=v(lerp(f.source.x,f.target.x,travel),
          lerp(f.source.y,f.target.y,travel)+Math.sin(travel*Math.PI)*.40,
          lerp(f.source.z,f.target.z,travel));
        f.orb.position.copyFrom(travelPoint.subtract(f.source));
        f.orbCore.position.copyFrom(f.orb.position);
        const live=t>=200&&t<790;
        f.orb.setEnabled(live);f.orbCore.setEnabled(live);
        f.trails.forEach((mesh,i)=>{
          const lag=Math.max(0,travel-.05*(i+1));
          mesh.position.set(lerp(f.source.x,f.target.x,lag)-f.source.x,
            lerp(f.source.y,f.target.y,lag)-f.source.y+Math.sin(lag*Math.PI)*.4,
            lerp(f.source.z,f.target.z,lag)-f.source.z);
          mesh.setEnabled(live);
        });
        f.impactRing.setEnabled(t>=740);
        f.impactRing.scaling.setAll(.15+1.5*smooth((t-740)/340));
        f.impactRing.visibility=1-smooth((t-740)/340);
      }else if(f.kind==='CORRUPTION'){
        f.impact.rotation.y=t*.0025;
        f.targetRings[0].rotation.x=t*.002;
        f.targetRings[1].rotation.y=-t*.003;
        f.impact.scaling.setAll(.20+1.20*smooth((t-120)/430));
        f.targetRings.forEach((m,i)=>m.visibility=(1-p)*(i?.75:.9));
      }else if(f.kind==='FOLD'){
        const open=smooth(t/330)*(1-smooth((t-610)/310));
        f.sourceRings.forEach((m,i)=>{m.scaling.setAll(Math.max(.01,open*(i?.78:1)));m.rotation.z=t*.003;});
        f.targetRings.forEach((m,i)=>{m.scaling.setAll(Math.max(.01,open*(i?.78:1)));m.rotation.z=-t*.003;});
      }else if(f.kind==='COLLAPSE'){
        const gathering=smooth((t-100)/420),burst=smooth((t-510)/510);
        f.core.scaling.setAll(.25+gathering*.85-burst*.62);
        f.rings[0].rotation.z=t*.004;f.rings[1].rotation.y=t*.006;
        f.rings[2].scaling.setAll(.10+burst*1.15);
        f.rings[2].visibility=(1-burst)*.78;
        f.shards.forEach((m,i)=>{
          const a=2*Math.PI*i/f.shards.length+t*.0025;
          const radius=lerp(2.1,.36,gathering)+burst*1.5;
          m.position.set(Math.cos(a)*radius,Math.sin(a*2)*.46,Math.sin(a)*radius);
          m.rotation.y+=.045;m.visibility=1-p;
        });
      }else if(f.kind==='BREAKDOWN'){
        const charged=smooth(t/350),release=smooth((t-400)/520);
        f.targetRings.forEach((m,i)=>{m.rotation.y=t*(i?.004:-.004);m.scaling.setAll(.2+charged*.9);m.visibility=1-p;});
        f.beamRoot.setEnabled(t>=380&&t<840);
        f.beam.visibility=(1-smooth((t-680)/210))*.92;
        f.shards.forEach((m,i)=>{
          const a=2*Math.PI*i/f.shards.length;
          const r=.4+release*1.45;
          m.position.set(Math.cos(a)*r,Math.sin(a*2)*(.3+release),Math.sin(a)*r);
          m.rotation.z+=.04;m.visibility=1-release;
        });
      }else if(f.kind==='BACKLASH'){
        const travel=smooth((t-150)/570);
        f.orb.position.set(lerp(0,f.source.x-f.target.x,travel),
          lerp(0,f.source.y-f.target.y,travel)+Math.sin(travel*Math.PI)*.40,
          lerp(0,f.source.z-f.target.z,travel));
        f.orb.visibility=1-smooth((t-660)/210);
        f.targetRings[0].visibility=1-p;
        f.targetRings[0].scaling.setAll(.35+.7*smooth(t/340));
      }
    }
  }
  remove(f){
    f?.root?.dispose?.(false,false);f?.impact?.dispose?.(false,false);
    f?.beamRoot?.dispose?.(false,false);
  }
  clear(){for(const fx of this.active)this.remove(fx);this.active.length=0;
    for(const aura of this.auras.values())aura.root.dispose(false,false);
    this.auras.clear();this.recent.clear()}
  dispose(){this.clear();for(const material of Object.values(this.materials))material.dispose?.()}
  diagnostics(){return{active:this.active.length,sanityAuras:this.auras.size,
    materials:Object.keys(this.materials).length,skills:Object.keys(SPELLS).length}}
}
