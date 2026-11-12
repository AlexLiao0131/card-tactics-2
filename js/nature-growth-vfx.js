import {VfxDatabase} from './vfx-database.js';
/**
 * Ophi's nature magic. The existing ArrowProjectileVfx continues to own the
 * physical curved bow arrow; this module draws only its emerald wind trail.
 * Healing and root bindings appear only while official statuses are present.
 */
import {SkillDatabase} from './skill-database.js';
import {HeroCombatVfxBase,VFX_TILE,VFX_TAU,vfxClamp,vfxLerp,vfxSmooth,vfxVec} from './hero-combat-vfx-common.js';

const MODULE='nature-growth';
const SPELLS=VfxDatabase.skillIds(MODULE);
const LIFE=Object.freeze({ARC:960,FAN:1050,TRIPLE:1120,BACK:940,
  WRATH:1160,SONG:990,ENTANGLE:720,SOUL_PICKUP:780,BASIC:700});

export class NatureGrowthVfx extends HeroCombatVfxBase{
  constructor(scene){
    super(scene,{name:'nature-growth-vfx',maxActive:7,colors:{
      leaf:[[.18,.78,.35],.88],glow:[[.68,1,.64],.91],deep:[[.07,.33,.18],.88],
      spirit:[[.53,.89,.77],.91],gold:[[.92,.87,.46],.89]
    }});
  }
  sync(snapshot,events=[]){
    this.prepare(snapshot);
    const now=performance.now();
    for(const e of events){
      if(e.type==='OPHI_FOREST_SOUL_COLLECT'){
        if(this.findUnit(snapshot,e.unitId))this.startSoulPickup(e,snapshot,now);
        continue;
      }
      if(!this.acceptEvent(snapshot,e,SPELLS))continue;
      const role=VfxDatabase.roleFor(MODULE,e.skillId);
      if(role==='ARC')this.startArc(e,snapshot,now);
      else if(role==='SONG')this.startSong(e,snapshot,now);
      else if(role==='WRATH')this.startWrath(e,snapshot,now);
      else if((role==='TRIPLE'||role==='FAN')&&this.findUnit(snapshot,e.unitId)?.resources?.forestSoul?.resonance)
        this.startBowBlessing(e,snapshot,now);
      else if(role==='BACK')this.startBackstepTrail(e,snapshot,now);
      else if(role==='BASIC'&&this.findUnit(snapshot,e.unitId)?.resources?.forestSoul?.resonance)
        this.startBowBlessing(e,snapshot,now);
      // Entanglement is visualized from its official applied status below.
    }
    const wanted=new Set();
    // Only nearby source lights are materialized as meshes (one per plant).
    // The authoritative soul amounts exist across the WHOLE map, including
    // unseen plants; the UI cannot create offscreen particle draw calls.
    const ophi=(snapshot?.units||[]).filter(u=>u.characterId==='ophi');
    for(const plant of snapshot?.map?.objects||[]){
      if(!['TREE','BUSH'].includes(String(plant.type||'').toUpperCase())||plant.destroyed||
         !(Number(plant.ophiForestSoul?.amount||0)>0))continue;
      if(!ophi.some(u=>Math.abs(u.x-plant.x)+Math.abs(u.y-plant.y)<=5))continue;
      const key=`SOURCE:${plant.id}`;wanted.add(key);
      let marker=this.auras.get(key);
      if(!marker){marker=this.soulSourceAura(key);this.auras.set(key,marker);}
      marker.root.position.set(Number(plant.x)*VFX_TILE,
        this.terrainY(snapshot,plant.x,plant.y)+1.38,Number(plant.y)*VFX_TILE);
    }
    for(const unit of snapshot?.units||[]){
      if(unit.characterId==='ophi'&&unit.resources?.forestSoul?.resonance){
        const key=`RESONANCE:${unit.id}`;wanted.add(key);
        this.status(key,unit,()=>this.forestResonanceAura(key));
      }
      const effects=unit.effects||[];
      if(effects.some(e=>e.id===VfxDatabase.statusId(MODULE,'SONG')&&e.type==='HEALING_CHANNEL')){
        const key=`SONG:${unit.id}`;wanted.add(key);
        this.status(key,unit,()=>this.songAura(key));
      }
      if(effects.some(e=>e.id===VfxDatabase.statusId(MODULE,'ENTANGLE'))){
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
  soulSourceAura(key){
    const root=this.node(`spirit-source-${key}`);
    const orb=this.orb(root,'forest-soul-ready',.19,'spirit');
    const halo=this.ring(root,'forest-soul-halo',.38,'leaf',10);
    halo.rotation.x=Math.PI/2;
    return{root,orb,halo,soulSource:true};
  }
  forestResonanceAura(key){
    const root=this.node(`forest-soul-resonance-${key}`);
    const orbs=Array.from({length:4},(_,i)=>this.orb(root,`resonance-${i}`,.14,'spirit'));
    return{root,orbs,resonance:true,above:.94};
  }
  startSoulPickup(e,s,now){
    const fx=this.createEffect('SOUL_PICKUP',{
      sequence:e.sequence,x:e.x,y:e.y,targetX:e.unitX,targetY:e.unitY
    },s,now,LIFE.SOUL_PICKUP);
    fx.from=this.point(s,e.x,e.y,1.35);
    fx.to=this.point(s,e.unitX,e.unitY,1.06);
    fx.orb=this.orb(fx.root,'soul-travel',.25,'spirit');
  }
  startWrath(e,s,now){
    const fx=this.createEffect('WRATH',e,s,now,LIFE.WRATH);
    fx.sphere=this.orb(fx.root,'forest-wrath-missile',.55,'leaf');
    fx.aura=this.ring(fx.root,'forest-wrath-pulse',1.2,'glow',14);
    fx.aura.rotation.x=Math.PI/2;
    fx.leaves=Array.from({length:5},(_,i)=>this.shard(fx.root,`forest-wrath-shard-${i}`,'spirit',.20));
  }
  startBackstepTrail(e,s,now){
    const fx=this.createEffect('BACK',e,s,now,LIFE.BACK);
    const p=e.backstepLanding;
    fx.to=p?this.point(s,p.x,p.y,.72):fx.from;
    fx.leaves=Array.from({length:6},(_,i)=>this.shard(fx.root,`backstep-leaf-${i}`,'spirit',.23));
  }
  startBowBlessing(e,s,now){
    const fx=this.createEffect('BASIC',e,s,now,LIFE.BASIC);
    fx.light=this.orb(fx.root,'blessed-arrow-trail',.18,'spirit');
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
    const radius=Number(SkillDatabase.get(VfxDatabase.skillId(MODULE,'SONG'))?.channel?.radius);
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
    }else if(fx.kind==='SOUL_PICKUP'){
      const q=vfxSmooth(p);
      const pos=BABYLON.Vector3.Lerp(fx.from,fx.to,q);
      pos.y+=Math.sin(Math.PI*q)*.48;
      fx.orb.position.copyFrom(pos.subtract(fx.root.position));
      fx.orb.visibility=1-vfxSmooth((p-.85)/.15);
    }else if(fx.kind==='WRATH'){
      const q=vfxSmooth((p-.18)/.67);
      const pos=BABYLON.Vector3.Lerp(fx.from,fx.to,q);
      fx.root.position.copyFrom(pos);
      fx.sphere.scaling.setAll(.5+.65*Math.sin(Math.PI*Math.min(1,p)));
      fx.aura.rotation.z+=.02;fx.aura.visibility=(1-vfxSmooth((p-.86)/.14))*.8;
      fx.leaves.forEach((m,i)=>{
        const a=VFX_TAU*i/fx.leaves.length+elapsed*.008;
        m.position.set(Math.cos(a)*.48,Math.sin(a)*.48,Math.sin(a*1.2)*.48);
      });
    }else if(fx.kind==='BACK'){
      fx.root.position.copyFrom(BABYLON.Vector3.Lerp(fx.from,fx.to,vfxSmooth(p)));
      fx.leaves.forEach((m,i)=>{
        const a=VFX_TAU*i/fx.leaves.length;
        m.position.set(Math.cos(a)*p,.3+Math.sin(p*Math.PI)*.35,Math.sin(a)*p);
        m.visibility=1-p;
      });
    }else if(fx.kind==='BASIC'){
      const q=vfxSmooth(p);const pos=BABYLON.Vector3.Lerp(fx.from,fx.to,q);
      fx.light.position.copyFrom(pos.subtract(fx.root.position));fx.light.visibility=1-q;
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
      if(fx.soulSource){
        fx.orb.position.y=Math.sin(now*.002)*.13;
        fx.halo.rotation.z=now*.0013;fx.halo.visibility=.54+.20*Math.sin(now*.003);
      }else if(fx.resonance){
        fx.orbs.forEach((orb,i)=>{
          const a=VFX_TAU*i/fx.orbs.length+now*.0018;
          orb.position.set(Math.cos(a)*.65,Math.sin(a*1.3)*.18,Math.sin(a)*.65);
          orb.visibility=.7+.24*Math.sin(a);
        });
      }else if(fx.boundary){
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
  removeEffect(fx){super.removeEffect(fx);fx?.impactRoot?.dispose?.(false,false);}
}
