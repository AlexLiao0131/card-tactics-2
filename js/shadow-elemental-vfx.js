import {VfxDatabase} from './vfx-database.js';
/**
 * Livia: shadow travel, Nether Slash and authoritative weapon enchantment
 * presentation. This visual layer never moves the unit or consumes an enchant.
 * Fire-bow explosions are already drawn by FireBowExplosionVfx; don't duplicate.
 */
import {HeroCombatVfxBase,VFX_TILE,VFX_TAU,vfxClamp,vfxLerp,vfxSmooth,vfxVec} from './hero-combat-vfx-common.js';

const MODULE='shadow-elemental';
const SPELLS=VfxDatabase.skillIds(MODULE);
const LIFE=Object.freeze({STEP:860,SLASH:830,ENCHANT:720,ELEMENT_HIT:690});

export class ShadowElementalVfx extends HeroCombatVfxBase{
  constructor(scene,{units=null}={}){
    super(scene,{name:'shadow-elemental-vfx',maxActive:7,colors:{
      shadow:[[.13,.035,.25],.85],rift:[[.49,.13,.82],.92],spark:[[.82,.61,1],.94],
      fire:[[1,.32,.08],.91],ember:[[1,.68,.23],.94],
      thunder:[[.30,.67,1],.94],lightning:[[.76,.93,1],.96]
    }});
    // The UnitRenderer owns the actual animated pose; never infer a moving
    // weapon position from the already-committed gameplay destination.
    this.units=units;
  }
  sync(snapshot,events=[]){
    this.prepare(snapshot);
    const now=performance.now();
    for(const event of events){
      if(!this.acceptEvent(snapshot,event,SPELLS))continue;
      if(VfxDatabase.roleFor(MODULE,event.skillId)==='ENCHANT'){
        if(event.enchantmentElement==='FIRE'||event.enchantmentElement==='THUNDER')
          this.startEnchant(event,snapshot,now);
      }else if(VfxDatabase.roleFor(MODULE,event.skillId)==='STEP')this.startStep(event,snapshot,now);
      else if(VfxDatabase.roleFor(MODULE,event.skillId)==='SLASH'){
        this.startSlash(event,snapshot,now);
        if(event.enchantmentContact&&event.enchantmentElement)this.startElementHit(event,snapshot,now);
      }else if(['ELEMENT_CONTACT'].includes(VfxDatabase.roleFor(MODULE,event.skillId))&&event.enchantmentContact&&event.enchantmentElement)
        this.startElementHit(event,snapshot,now);
    }
    // Effect ID, weapon slot and element come from an authoritative unit state;
    // status existence is never inferred from the last animation's duration.
    const wanted=new Set();
    for(const unit of snapshot?.units||[]){
      for(const e of unit.effects||[]){
        // The published status ID contains the official weapon slot; current
        // snapshot projection exposes the canonical, localized status name.
        // Both originate in EffectEngine/commitEnchantment, never in VFX logic.
        const slot=e.weaponSlot||(typeof e.id==='string'&&e.id.startsWith(VfxDatabase.statusId(MODULE,'WEAPON_ENCHANT')+':')
          ?e.id.slice((VfxDatabase.statusId(MODULE,'WEAPON_ENCHANT')+':').length):null);
        const element=e.element||({'火元素附魔':'FIRE','雷元素附魔':'THUNDER'}[e.name]);
        if(e.type!==VfxDatabase.statusId(MODULE,'WEAPON_ENCHANT')||!slot||!['FIRE','THUNDER'].includes(element))continue;
        const key=`${unit.id}:ENCHANT:${slot}:${element}`;
        wanted.add(key);
        this.status(key,unit,()=>this.enchantAura(key,{unitId:unit.id,weaponSlot:slot,element}));
      }
    }
    this.pruneStatuses(wanted);
  }
  enchantAura(key,e){
    const root=this.node(`weapon-aura-${key}`);
    const material=e.element==='FIRE'?'fire':'thunder',glint=e.element==='FIRE'?'ember':'lightning';
    // Distinct sword and bow anchors; no skinning or mesh ownership mutation.
    const bow=/bow/i.test(e.weaponSlot);
    const near=this.ring(root,'weapon-edge-glow',bow?.76:.63,material,10);
    near.rotation.x=Math.PI/2;near.position.set(bow?.45:.34,.20,bow?-.17:.06);
    const motes=Array.from({length:4},(_,i)=>{
      const m=this.orb(root,`weapon-spark-${i}`,.10,glint);
      m.position.set(bow?.45:.34,.21,-.2);return m;
    });
    return{root,near,motes,unitId:String(e.unitId),weaponSlot:e.weaponSlot,
      isBow:bow,element:e.element,above:.93};
  }
  startStep(e,s,now){
    const fx=this.createEffect('STEP',e,s,now,LIFE.STEP);
    fx.root.position.copyFrom(fx.from);
    fx.start=this.orb(fx.root,'shadow-disperse',.80,'shadow');
    fx.exitRoot=this.node(`step-destination-${e.sequence}`,fx.to);
    fx.endRing=this.ring(fx.exitRoot,'shadow-reform',.9,'rift',10);
    fx.endRing.rotation.x=Math.PI/2;
    fx.ghosts=Array.from({length:5},(_,i)=>this.orb(fx.root,`shadow-trail-${i}`,.18-i*.013,i%2?'rift':'shadow'));
  }
  startSlash(e,s,now){
    const fx=this.createEffect('SLASH',e,s,now,LIFE.SLASH);
    const span=Math.max(.45,Math.min(2.6,fx.to.subtract(fx.from).length()));
    fx.ellipse=this.ring(fx.root,'nether-rift-opening',.68,'rift',14);
    fx.ellipse.rotation.x=Math.PI/3;
    fx.blade=this.mesh(fx.root,'nether-wave','CreateBox',
      {width:span*1.4,height:.13,depth:.075},'spark');
    fx.blade.rotation.z=-.45;
    fx.echo=Array.from({length:3},(_,i)=>this.ring(fx.root,`nether-rune-${i}`,.54+i*.34,
      i===1?'shadow':'rift',8));
    fx.echo.forEach((r,i)=>{r.rotation.z=i*Math.PI/4;});
  }
  startEnchant(e,s,now){
    const fx=this.createEffect('ENCHANT',e,s,now,LIFE.ENCHANT);
    fx.root.position.copyFrom(fx.to);
    const fire=e.enchantmentElement==='FIRE';
    fx.ring=this.ring(fx.root,'enchant-weapon-consecrate',.92,fire?'fire':'thunder',12);
    fx.ring.rotation.x=Math.PI/2;
    fx.motes=Array.from({length:5},(_,i)=>this.orb(fx.root,`enchant-spark-${i}`,.15,fire?'ember':'lightning'));
  }
  startElementHit(e,s,now){
    if(!['FIRE','THUNDER'].includes(e.enchantmentElement))return;
    const fx=this.createEffect('ELEMENT_HIT',e,s,now,LIFE.ELEMENT_HIT);
    const fire=e.enchantmentElement==='FIRE';
    fx.element=e.enchantmentElement;
    fx.ring=this.ring(fx.root,'element-impact-ring',.84,fire?'fire':'thunder',12);
    fx.ring.rotation.x=Math.PI/2;
    fx.parts=Array.from({length:6},(_,i)=>this.shard(fx.root,`element-spark-${i}`,fire?'ember':'lightning',.22));
  }
  updateEffect(fx,elapsed,p){
    if(fx.kind==='STEP'){
      const travel=vfxSmooth((p-.08)/.74),fade=1-vfxSmooth(p);
      fx.start.scaling.setAll(1+travel*.25);fx.start.visibility=fade*.75;
      fx.ghosts.forEach((m,i)=>{
        const t=vfxSmooth((p-.12-i*.045)/.66);
        const pt=BABYLON.Vector3.Lerp(fx.from,fx.to,t);
        m.position.set(pt.x-fx.from.x,pt.y-fx.from.y+Math.sin(Math.PI*t)*.25,pt.z-fx.from.z);
        m.visibility=(1-p)*(.72-i*.095);
      });
      fx.endRing.scaling.setAll(.2+vfxSmooth((p-.58)/.37)*1.1);
      fx.endRing.visibility=vfxSmooth((p-.54)/.18)*(1-vfxSmooth((p-.83)/.17));
    }else if(fx.kind==='SLASH'){
      const flash=vfxSmooth((p-.13)/.32),fade=1-vfxSmooth((p-.43)/.57);
      fx.ellipse.scaling.setAll(.25+flash*1.4);fx.ellipse.rotation.z=elapsed*.004;
      fx.ellipse.visibility=fade;
      fx.blade.scaling.x=.2+1.2*flash;fx.blade.visibility=fade;
      fx.echo.forEach((r,i)=>{r.rotation.y=elapsed*(i%2?.004:-.005);r.visibility=fade*(.9-i*.16);});
    }else if(fx.kind==='ENCHANT'){
      const fade=1-vfxSmooth((p-.53)/.47);
      fx.ring.scaling.setAll(.2+1.1*vfxSmooth(p/.46));fx.ring.visibility=fade;
      fx.motes.forEach((m,i)=>{
        const a=VFX_TAU*i/5+elapsed*.004;
        m.position.set(Math.cos(a)*(.35+p*.42),.25+p*.8,Math.sin(a)*(.35+p*.42));
        m.visibility=fade;
      });
    }else if(fx.kind==='ELEMENT_HIT'){
      const spread=vfxSmooth(p/.65),fade=1-vfxSmooth((p-.35)/.65);
      fx.ring.scaling.setAll(.15+spread*2.0);fx.ring.visibility=fade;
      fx.parts.forEach((m,i)=>{
        const a=VFX_TAU*i/fx.parts.length;
        m.position.set(Math.cos(a)*(spread*1.05),spread*(.25+i%2*.17),Math.sin(a)*(spread*1.05));
        m.rotation.y=elapsed*.005+a;m.visibility=fade;
      });
    }
  }
  updateAuras(now){
    for(const fx of this.auras.values()){
      // UnitRenderer updates its actual interpolated pose earlier in the same
      // Babylon frame. Follow its live weapon pivot rather than the final
      // x/y in the authoritative snapshot (which moves immediately).
      const entry=this.units?.entries?.get(fx.unitId);
      if(!entry?.root||entry.root.isDisposed?.()){
        // A drawable pose is required: never show a detached enchantment at a
        // future destination, or reveal a figure not in the visible roster.
        fx.root.setEnabled?.(false);
        continue;
      }
      fx.root.setEnabled?.(true);
      const pivot=entry.kind==='FIGURE'
        ?(fx.isBow?entry.figureParts?.bow:
          entry.figureParts?.weapon||entry.figureParts?.sword):null;
      if(pivot&&!pivot.isDisposed?.()){
        pivot.computeWorldMatrix?.(true);
        fx.root.position.copyFrom(pivot.getAbsolutePosition());
        const worldRotation=pivot.absoluteRotationQuaternion;
        if(worldRotation){
          if(fx.root.rotationQuaternion)fx.root.rotationQuaternion.copyFrom(worldRotation);
          else fx.root.rotationQuaternion=worldRotation.clone();
        }else{
          fx.root.rotationQuaternion=null;
          fx.root.rotation.copyFrom(pivot.rotation);
        }
      }else{
        // Sprite/capsule compatibility: follow the LIVE rendered root rather
        // than falling back to the gameplay end tile during interpolation.
        entry.root.computeWorldMatrix?.(true);
        fx.root.position.copyFrom(entry.root.getAbsolutePosition());
        fx.root.position.y+=(fx.above??.93)-(entry.kind==='CAPSULE'?Number(entry.height||0)/2:0);
        fx.root.rotationQuaternion=null;
        fx.root.rotation.copyFrom(entry.root.rotation);
      }
      fx.near.rotation.y=now*.0024;
      fx.near.visibility=.57+.23*Math.sin(now*.008);
      fx.motes.forEach((m,i)=>{
        const a=VFX_TAU*i/fx.motes.length+now*.004;
        m.position.set((fx.near.position.x||0)+Math.cos(a)*.30,
          .16+Math.sin(a*1.4)*.21,
          (fx.near.position.z||0)+Math.sin(a)*.22);
        m.visibility=.55+.28*Math.sin(a);
      });
    }
  }
  removeEffect(fx){
    super.removeEffect(fx);
    fx?.exitRoot?.dispose?.(false,false);
  }
}
