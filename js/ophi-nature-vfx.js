/**
 * Ophi's nature magic. The existing ArrowProjectileVfx continues to own the
 * physical curved bow arrow; this module draws only its emerald wind trail.
 * Healing and root bindings appear only while official statuses are present.
 */
import {SkillDatabase} from './skill-database.js';
import {HeroCombatVfxBase,VFX_TILE,VFX_TAU,vfxClamp,vfxLerp,vfxSmooth,vfxVec} from './hero-combat-vfx-common.js';

const SPELLS=['ophi_eagle_arc_shot','ophi_forest_thrust','ophi_forest_throw',
  'ophi_healing_song','ophi_forest_entangle'];
const LIFE=Object.freeze({ARC:960,THRUST:660,THROW:850,SONG:990,ENTANGLE:720});

export class OphiNatureVfx extends HeroCombatVfxBase{
  constructor(scene){
    super(scene,{name:'ophi-vfx',maxActive:7,colors:{
      leaf:[[.18,.78,.35],.88],glow:[[.68,1,.64],.91],deep:[[.07,.33,.18],.88],
      spirit:[[.53,.89,.77],.91],gold:[[.92,.87,.46],.89]
    }});
  }
  sync(snapshot,events=[]){
    this.prepare(snapshot);
    const now=performance.now();
    for(const e of events){
      if(!this.acceptEvent(snapshot,e,SPELLS))continue;
      if(e.skillId==='ophi_eagle_arc_shot')this.startArc(e,snapshot,now);
      else if(e.skillId==='ophi_forest_thrust')this.startThrust(e,snapshot,now);
      else if(e.skillId==='ophi_forest_throw')this.startThrow(e,snapshot,now);
      else if(e.skillId==='ophi_healing_song')this.startSong(e,snapshot,now);
      // Entanglement is visualized from its official applied status below.
    }
    const wanted=new Set();
    for(const unit of snapshot?.units||[]){
      const effects=unit.effects||[];
      if(effects.some(e=>e.id==='OPHI_HEALING_SONG'&&e.type==='HEALING_CHANNEL')){
        const key=`SONG:${unit.id}`;wanted.add(key);
        this.status(key,unit,()=>this.songAura(key));
      }
      if(effects.some(e=>e.id==='FOREST_ENTANGLED')){
        const key=`ROOT:${unit.id}`;wanted.add(key);
        this.status(key,unit,()=>this.rootAura(key,unit,snapshot));
      }
    }
    this.pruneStatuses(wanted);
  }
  startArc(e,s,now){
    const fx=this.createEffect('ARC',e,s,now,LIFE.ARC);
    fx.root.position.copyFrom(fx.from);
    fx.wind=Array.from({length:5},(_,i)=>this.orb(fx.root,`curve-wind-${i}`,.14-i*.014,i%2?'leaf':'spirit'));
    fx.impactRoot=this.node(`arc-impact-${e.sequence}`,fx.to);
    fx.impact=this.ring(fx.impactRoot,'forest-arrow-gust',.79,'spirit',12);
    fx.impact.rotation.x=Math.PI/2;
  }
  createSpiritSpear(root,kind){
    // This is one visual weapon primitive shared by the thrust and throw.
    // Local +Z points at the impact; no combat position or weapon state changes.
    const tip=this.mesh(root,`${kind}-spear-tip`,'CreateCylinder',
      {height:.26,diameterTop:0,diameterBottom:.14,tessellation:6},'glow');
    tip.rotation.x=Math.PI/2;tip.position.z=.50;
    const shaft=this.mesh(root,`${kind}-spear-shaft`,'CreateCylinder',
      {height:.88,diameter:.045,tessellation:6},'deep');
    shaft.rotation.x=Math.PI/2;
    return{tip,shaft};
  }
  startThrust(e,s,now){
    const fx=this.createEffect('THRUST',e,s,now,LIFE.THRUST);
    fx.flight=this.node(`spirit-spear-thrust-${e.sequence}`,fx.from);
    fx.weapon=this.createSpiritSpear(fx.flight,'thrust');
    fx.aim=fx.to.add(fx.to.subtract(fx.from));
    fx.flight.setEnabled(false);
    fx.ring=this.ring(fx.root,'spear-nature-thrust',1.10,'leaf',10);
    fx.ring.rotation.z=Math.PI/2;
    fx.sparks=Array.from({length:6},(_,i)=>this.shard(fx.root,`thrust-leaf-${i}`,i%2?'leaf':'glow',.25));
  }
  startThrow(e,s,now){
    const fx=this.createEffect('THROW',e,s,now,LIFE.THROW);
    fx.flight=this.node(`spirit-spear-flight-${e.sequence}`,fx.from);
    fx.weapon=this.createSpiritSpear(fx.flight,'throw');
    fx.trail=Array.from({length:4},(_,i)=>this.orb(fx.flight,`spirit-spear-leaf-${i}`,.10,'leaf'));
    fx.flight.setEnabled(false);
    fx.ring=this.ring(fx.root,'spirit-spear-contact',.92,'glow',10);
    fx.ring.rotation.x=Math.PI/2;
  }
  startSong(e,s,now){
    const fx=this.createEffect('SONG',e,s,now,LIFE.SONG);
    fx.root.position.copyFrom(fx.from);
    fx.ring=this.ring(fx.root,'healing-song-cast',1.15,'leaf',16);
    fx.ring.rotation.x=Math.PI/2;
    fx.notes=Array.from({length:6},(_,i)=>this.orb(fx.root,`song-note-${i}`,.13,i%2?'gold':'spirit'));
  }
  songAura(key){
    const root=this.node(`healing-song-aura-${key}`);
    const radius=Number(SkillDatabase.get('ophi_healing_song')?.channel?.radius);
    if(!Number.isFinite(radius)||radius<0)throw Error('Official Ophi song radius unavailable');
    const boundary=this.ring(root,'healing-channel-range',(radius*2+.25)*VFX_TILE,'leaf',32);
    boundary.rotation.x=Math.PI/2;
    boundary.position.y=-.60;
    const core=this.ring(root,'healing-channel-core',1.24,'spirit',14);
    core.rotation.x=Math.PI/2;
    const motes=Array.from({length:5},(_,i)=>this.orb(root,`healing-song-pollen-${i}`,.115,
      i%2?'leaf':'glow'));
    return{root,boundary,core,motes,above:.75};
  }
  rootAura(key,unit,snapshot){
    const root=this.node(`forest-entangle-aura-${key}`);
    const rings=Array.from({length:3},(_,i)=>{
      const r=this.ring(root,`living-root-bind-${i}`,.82+i*.14,'leaf',9);
      r.rotation.x=Math.PI/2;r.position.y=-.54+i*.34;
      return r;
    });
    const leaves=Array.from({length:5},(_,i)=>this.shard(root,`entangle-leaf-${i}`,
      i%2?'glow':'leaf',.20));
    // Source only from actual tree objects already present on this map.
    const tree=(snapshot?.map?.objects||[]).filter(o=>!o.destroyed&&o.type==='TREE'&&
      Math.abs(o.x-unit.x)<=1&&Math.abs(o.y-unit.y)<=1)
      .sort((a,b)=>Math.abs(a.x-unit.x)+Math.abs(a.y-unit.y)-
        Math.abs(b.x-unit.x)-Math.abs(b.y-unit.y))[0]||null;
    if(tree){
      const source=vfxVec((tree.x-unit.x)*VFX_TILE,-.67,(tree.y-unit.y)*VFX_TILE);
      // Static tessellated root follows only a legal existing tree. Mesh is
      // created once for this status and disposed when the status is removed.
      this.tube(root,'living-root-tree-connection',[
        source,vfxVec(source.x*.64,-.67,source.z*.64),
        vfxVec(source.x*.25,-.62,source.z*.25),vfxVec(0,-.5,0)
      ],'deep',.075);
    }
    return{root,rings,leaves,above:.76};
  }
  arcPoint(fx,t){
    // Identical quadratic trajectory shape to shared ArrowProjectileVfx;
    // this is only a wind trail, not a second attack projectile.
    const control=fx.from.add(fx.to).scale(.5);
    control.y=Math.max(fx.from.y,fx.to.y)+
      Math.min(1.2,.24+BABYLON.Vector3.Distance(fx.from,fx.to)*.13);
    const a=BABYLON.Vector3.Lerp(fx.from,control,t);
    const b=BABYLON.Vector3.Lerp(control,fx.to,t);
    return BABYLON.Vector3.Lerp(a,b,t);
  }
  updateEffect(fx,elapsed,p){
    if(fx.kind==='ARC'){
      const travel=vfxSmooth((p-.05)/.78);
      fx.wind.forEach((m,i)=>{
        const q=vfxClamp(travel-i*.055),pt=this.arcPoint(fx,q);
        m.position.set(pt.x-fx.from.x,pt.y-fx.from.y,pt.z-fx.from.z);
        m.visibility=(1-vfxSmooth((p-.77)/.23))*(.77-i*.12);
      });
      const bloom=vfxSmooth((p-.77)/.15);
      fx.impact.scaling.setAll(.14+1.6*bloom);
      fx.impact.visibility=bloom*(1-vfxSmooth((p-.89)/.10));
    }else if(fx.kind==='THRUST'){
      // The visible spear travels along the official caster-target line.
      // No second hit or movement is generated by this presentation action.
      const travel=vfxSmooth((p-.06)/.70);
      const pos=BABYLON.Vector3.Lerp(fx.from,fx.to,travel);
      fx.flight.position.copyFrom(pos);
      if(BABYLON.Vector3.DistanceSquared(fx.from,fx.to)>1e-6)fx.flight.lookAt(fx.aim);
      fx.flight.setEnabled(p<.80);
      const burst=vfxSmooth(p/.43),fade=1-vfxSmooth((p-.35)/.65);
      fx.ring.scaling.setAll(.25+burst*1.05);fx.ring.visibility=fade;
      fx.sparks.forEach((m,i)=>{
        const a=VFX_TAU*i/fx.sparks.length;
        m.position.set(Math.cos(a)*burst*.73,Math.sin(a)*burst*.55,Math.sin(a)*burst*.73);
        m.visibility=fade;
      });
    }else if(fx.kind==='THROW'){
      const q=vfxSmooth((p-.08)/.75);
      const pt=this.arcPoint(fx,q),next=this.arcPoint(fx,Math.min(1,q+.025));
      fx.flight.position.copyFrom(pt);fx.flight.lookAt(next);fx.flight.setEnabled(p<.88);
      fx.trail.forEach((m,i)=>{
        const a=VFX_TAU*i/fx.trail.length+elapsed*.008;
        m.position.set(Math.cos(a)*.15,Math.sin(a)*.15,-.30-i*.11);
        m.visibility=(1-p)*.6;
      });
      const bloom=vfxSmooth((p-.82)/.1);
      fx.ring.scaling.setAll(.2+bloom*1.3);
      fx.ring.visibility=bloom*(1-vfxSmooth((p-.92)/.08));
    }else if(fx.kind==='SONG'){
      const rise=vfxSmooth(p/.44),fade=1-vfxSmooth((p-.60)/.40);
      fx.ring.scaling.setAll(.2+rise*1.05);fx.ring.visibility=fade;
      fx.notes.forEach((m,i)=>{
        const a=VFX_TAU*i/fx.notes.length+elapsed*.003;
        m.position.set(Math.cos(a)*(.26+rise*.52),rise*.78+i*.05,
          Math.sin(a)*(.26+rise*.52));
        m.visibility=fade;
      });
    }
  }
  updateAuras(now){
    for(const fx of this.auras.values()){
      if(fx.boundary){
        fx.boundary.visibility=.22+.09*Math.sin(now*.004);
        fx.core.rotation.y=now*.002;fx.core.visibility=.61+.17*Math.sin(now*.006);
        fx.motes.forEach((m,i)=>{
          const a=VFX_TAU*i/fx.motes.length+now*.0015;
          m.position.set(Math.cos(a)*(.7+i*.1),.18+.34*Math.sin(a*.7),
            Math.sin(a)*(.7+i*.1));
          m.visibility=.51+.20*Math.sin(a);
        });
      }else if(fx.rings){
        fx.rings.forEach((ring,i)=>{
          ring.rotation.y=now*(i%2?.0016:-.0019);
          ring.visibility=.52+.15*Math.sin(now*.005+i);
        });
        fx.leaves.forEach((m,i)=>{
          const a=VFX_TAU*i/fx.leaves.length+now*.0006;
          m.position.set(Math.cos(a)*.47,-.28+(i%3)*.25,
            Math.sin(a)*.47);
          m.rotation.y=a;m.visibility=.7;
        });
      }
    }
  }
  removeEffect(fx){super.removeEffect(fx);fx?.flight?.dispose?.(false,false);fx?.impactRoot?.dispose?.(false,false);}
}
