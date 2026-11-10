import {VfxDatabase} from './vfx-database.js';
/**
 * Seraphina: crimson rapier, accepted backstab transit, authoritative multi-
 * center blood burst, HP restoration and the actual 5V awakening flag.
 * Every center and movement origin is supplied by the canonical battle action.
 * The render pass never predicts damage, blood gain, healing or legal landing.
 */
import {HeroCombatVfxBase,VFX_TAU,vfxClamp,vfxLerp,vfxSmooth,vfxVec} from './hero-combat-vfx-common.js';

const MODULE='blood-ritual';
const SPELLS=VfxDatabase.skillIds(MODULE);
const LIFE=Object.freeze({RAZOR:730,SHADOW:1050,BURST:1100,REGEN:960});
const MAX_BURST_CENTERS=20; // presentation GPU cap; no change to official hits

export class BloodRitualVfx extends HeroCombatVfxBase{
  constructor(scene){
    super(scene,{name:'blood-ritual-vfx',maxActive:9,colors:{
      blood:[[.80,.035,.095],.92],dark:[[.13,.012,.045],.88],
      crimson:[[1,.25,.31],.95],mist:[[.50,.048,.11],.60],
      sigil:[[.94,.42,.52],.91]
    }});
  }
  sync(snapshot,events=[]){
    this.prepare(snapshot);
    const now=performance.now();
    for(const e of events){
      if(!this.acceptEvent(snapshot,e,SPELLS))continue;
      if(VfxDatabase.roleFor(MODULE,e.skillId)==='RAZOR')this.startRazor(e,snapshot,now);
      else if(VfxDatabase.roleFor(MODULE,e.skillId)==='SHADOW')this.startShadow(e,snapshot,now);
      else if(VfxDatabase.roleFor(MODULE,e.skillId)==='BURST')this.startBurst(e,snapshot,now);
      else if(VfxDatabase.roleFor(MODULE,e.skillId)==='REGEN')this.startRegen(e,snapshot,now);
    }
    const wanted=new Set();
    for(const unit of snapshot?.units||[]){
      if(unit.characterId===VfxDatabase.statusId(MODULE,'AWAKENED_CHARACTER')&&unit.resources?.blood?.awakened===true){
        const key=`AWAKENED:${unit.id}`;wanted.add(key);
        this.status(key,unit,()=>this.awakenAura(key));
      }
      if((unit.effects||[]).some(e=>e.id===VfxDatabase.statusId(MODULE,'BLEED'))){
        const key=`BLEED:${unit.id}`;wanted.add(key);
        this.status(key,unit,()=>this.bleedAura(key));
      }
    }
    this.pruneStatuses(wanted);
  }
  startRazor(e,s,now){
    const fx=this.createEffect('RAZOR',e,s,now,LIFE.RAZOR);
    fx.slash=this.ring(fx.root,'blood-rapier-impact',.78,'crimson',9);
    fx.slash.rotation.z=.70;
    fx.splinters=Array.from({length:6},(_,i)=>this.shard(fx.root,`blood-rapier-cut-${i}`,
      i%2?'blood':'sigil',.20));
    fx.cut=this.mesh(fx.root,'blood-rapier-flash','CreateBox',
      {width:1.05,height:.085,depth:.065},'sigil');
    fx.cut.rotation.z=-.55;
  }
  startShadow(e,s,now){
    const fx=this.createEffect('SHADOW',e,s,now,LIFE.SHADOW);
    // The official controller publishes its actually chosen legal rear tile
    // and pre-teleport origin. Never infer a second landing from the target.
    const origin=e.visualOrigin;
    fx.actualOrigin=origin&&Number.isFinite(origin.x)&&Number.isFinite(origin.y)
      ?this.point(s,origin.x,origin.y,1.05):fx.from;
    fx.exit=this.ring(fx.root,'blood-shadow-arrival',.83,'crimson',10);
    fx.exit.rotation.x=Math.PI/2;
    fx.shade=this.orb(fx.root,'blood-shadow-body',.70,'dark');
    fx.afterimages=Array.from({length:5},(_,i)=>this.orb(fx.root,
      `blood-shadow-trail-${i}`,.24-i*.024,i%2?'blood':'mist'));
    fx.cut=this.mesh(fx.root,'blood-shadow-backstab','CreateBox',
      {width:.12,height:1.05,depth:.09},'sigil');
    fx.cut.rotation.z=-.38;
    fx.cut.setEnabled(false);
  }
  startBurst(e,s,now){
    const fx=this.createEffect('BURST',e,s,now,LIFE.BURST);
    fx.root.position.copyFrom(fx.from);
    // Both PvP seats and solo publish their real EffectEngine.bloodBurstCenters
    // in the normal UNIT_ANIMATION event. Hidden target coordinates are not drawn.
    const visible=(s?.units||[]);
    const centers=Array.isArray(e.burstCenters)?e.burstCenters:[];
    fx.centers=centers.filter(center=>Number.isSafeInteger(center.x)&&
      Number.isSafeInteger(center.y)&&(center.serverVisibleBefore===true ||
      center.unitId!=null || visible.some(u=>u.x===center.x&&u.y===center.y)))
      .slice(0,MAX_BURST_CENTERS).map((center,index)=>{
        const pos=this.point(s,center.x,center.y,.65);
        const root=this.node(`blood-burst-center-${e.sequence}-${index}`,pos);
        const rune=this.ring(root,'blood-burst-rune',1.08,'sigil',12);
        rune.rotation.x=Math.PI/2;
        const core=this.orb(root,'blood-burst-core',.48,'blood');
        const fragments=Array.from({length:6},(_,i)=>this.shard(root,
          `blood-burst-fragment-${index}-${i}`,i%2?'blood':'crimson',.22));
        return{root,rune,core,fragments};
      });
    fx.summon=this.ring(fx.root,'blood-burst-summoning',1.0,'blood',12);
    fx.summon.rotation.x=Math.PI/2;
  }
  startRegen(e,s,now){
    const fx=this.createEffect('REGEN',e,s,now,LIFE.REGEN);
    fx.root.position.copyFrom(fx.from);
    fx.ring=this.ring(fx.root,'blood-regrowth-circle',1.0,'blood',12);
    fx.ring.rotation.x=Math.PI/2;
    fx.droplets=Array.from({length:9},(_,i)=>this.orb(fx.root,
      `returning-blood-${i}`,.14,i%3?'mist':'crimson'));
  }
  awakenAura(key){
    const root=this.node(`blood-five-v-awakening-${key}`);
    const outer=this.ring(root,'awakened-outer-circle',1.45,'blood',16);
    outer.rotation.x=Math.PI/2;outer.position.y=-.65;
    const crown=this.ring(root,'awakened-crown',1.1,'sigil',10);
    crown.rotation.z=Math.PI/2;crown.position.y=.66;
    const motes=Array.from({length:6},(_,i)=>this.orb(root,
      `awakened-blood-ember-${i}`,.14,'crimson'));
    return{root,outer,crown,motes,above:.78};
  }
  bleedAura(key){
    const root=this.node(`blood-bleed-status-${key}`);
    const cut=this.ring(root,'bleeding-sign',.43,'blood',8);
    cut.rotation.x=Math.PI/2;
    return{root,cut,above:1.40};
  }
  updateEffect(fx,elapsed,p){
    if(fx.kind==='RAZOR'){
      const expand=vfxSmooth(p/.45),fade=1-vfxSmooth((p-.32)/.68);
      fx.slash.scaling.setAll(.26+expand*1.22);fx.slash.visibility=fade;
      fx.cut.scaling.x=.2+expand*1.35;fx.cut.visibility=fade;
      fx.splinters.forEach((m,i)=>{
        const a=VFX_TAU*i/fx.splinters.length;
        m.position.set(Math.cos(a)*expand*.85,Math.sin(a*2)*expand*.46,
          Math.sin(a)*expand*.85);
        m.visibility=fade;
      });
    }else if(fx.kind==='SHADOW'){
      const q=vfxSmooth((p-.06)/.67),fade=1-vfxSmooth((p-.72)/.28);
      fx.afterimages.forEach((m,i)=>{
        const t=vfxSmooth((p-.06-i*.046)/.68);
        const pt=BABYLON.Vector3.Lerp(fx.actualOrigin,fx.from,t);
        m.position.set(pt.x-fx.to.x,pt.y-fx.to.y+Math.sin(Math.PI*t)*.18,
          pt.z-fx.to.z);
        m.visibility=fade*(.78-i*.12);
      });
      fx.shade.scaling.setAll(1-vfxSmooth((p-.61)/.26)*.8);
      fx.shade.visibility=fade*.55;
      fx.exit.scaling.setAll(.17+vfxSmooth((p-.55)/.32)*1.33);
      fx.exit.visibility=vfxSmooth((p-.54)/.15)*fade;
      fx.cut.setEnabled(p>.62&&p<.94);
      fx.cut.visibility=fade;
    }else if(fx.kind==='BURST'){
      const gather=vfxSmooth(p/.33),detonate=vfxSmooth((p-.29)/.40),
        fade=1-vfxSmooth((p-.59)/.41);
      fx.summon.scaling.setAll(.25+gather*.72);fx.summon.visibility=fade;
      fx.centers.forEach((c,index)=>{
        c.rune.rotation.y=elapsed*(index%2?.003:-.003);
        c.rune.scaling.setAll(.33+gather*.8+detonate*.9);
        c.rune.visibility=fade;
        c.core.scaling.setAll(.12+gather*.8-detonate*.54);
        c.core.visibility=fade;
        c.fragments.forEach((m,i)=>{
          const a=VFX_TAU*i/c.fragments.length;
          const radius=.2+detonate*1.45;
          m.position.set(Math.cos(a)*radius,detonate*(.2+i%3*.25),
            Math.sin(a)*radius);
          m.rotation.z=a+elapsed*.003;
          m.visibility=detonate*fade;
        });
      });
    }else if(fx.kind==='REGEN'){
      const rise=vfxSmooth(p/.68),fade=1-vfxSmooth((p-.65)/.35);
      fx.ring.scaling.setAll(.18+rise*1.05);fx.ring.visibility=fade;
      fx.droplets.forEach((m,i)=>{
        const a=VFX_TAU*i/fx.droplets.length+elapsed*.001;
        const radius=(1-rise)*1.3;
        m.position.set(Math.cos(a)*radius, .25+Math.sin(a*2)*.25+rise*.72,
          Math.sin(a)*radius);
        m.visibility=fade;
      });
    }
  }
  updateAuras(now){
    for(const fx of this.auras.values()){
      if(fx.outer){
        fx.outer.rotation.y=now*.0019;
        fx.outer.visibility=.59+.16*Math.sin(now*.004);
        fx.crown.rotation.y=now*-.0027;
        fx.crown.visibility=.52+.14*Math.cos(now*.006);
        fx.motes.forEach((m,i)=>{
          const a=VFX_TAU*i/fx.motes.length+now*.0017;
          m.position.set(Math.cos(a)*.67,-.13+.18*Math.sin(a*2),Math.sin(a)*.67);
          m.visibility=.50+.20*Math.sin(a);
        });
      }else if(fx.cut){
        fx.cut.rotation.y=now*.0025;
        fx.cut.visibility=.46+.18*Math.sin(now*.006);
      }
    }
  }
  removeEffect(fx){
    super.removeEffect(fx);
    for(const c of fx?.centers||[])c.root.dispose?.(false,false);
  }
}
