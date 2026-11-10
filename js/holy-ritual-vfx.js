/** Shared holy casting, consecrated weapon trails, wards and sanctuary anchor.
 * The old HolyBladeVfx owns Verdict; this module NEVER draws another Verdict.
 * All damaging, healing, grace, HP links and sanctuary gameplay belongs to
 * canonical BattleResolution / EffectEngine / BattleAreaFieldEngine.
 */
import {HeroCombatVfxBase,VFX_TAU,vfxClamp,vfxSmooth,vfxLerp,vfxVec} from './hero-combat-vfx-common.js';
import {VfxDatabase} from './vfx-database.js';
import {SkillDatabase} from './skill-database.js';
const MODULE='holy-ritual';
const IDS=VfxDatabase.skillIds(MODULE);
const STATUS=VfxDatabase.definitions[MODULE].status;
const DURATION=Object.freeze({JUDGEMENT:860,HEAL:980,PURIFY:900,BLESS:920,SANCTUARY:960,SLASH:710,CHARGE:890,SHIELD:880});
export class HolyRitualVfx extends HeroCombatVfxBase{
  constructor(scene){
    super(scene,{name:'holy-ritual',maxActive:8,colors:{
      gold:[[1,.72,.23],.83],white:[[1,.98,.78],.95],teal:[[.51,.98,.88],.85],
      blue:[[.44,.72,1],.78],shield:[[1,.83,.39],.48]
    }});
    this.fields=new Map();this.sanctuarySkill=SkillDatabase.get('saint_sanctuary');
  }
  sync(snapshot,events=[]){
    this.prepare(snapshot);
    const now=performance.now();
    for(const event of events){
      if(!this.acceptEvent(snapshot,event,IDS))continue;
      const role=VfxDatabase.roleFor(MODULE,event.skillId);
      if(role==='SANCTUARY'){
        this.addSanctuary(event,snapshot,now);
        this.addCast('SANCTUARY',event,snapshot,now);
      }else this.addCast(role,event,snapshot,now);
    }
    const wanted=new Set();
    for(const unit of snapshot?.units||[]){
      for(const effect of unit.effects||[]){
        const name=effect.id;
        const kind=name===STATUS.HOLY_SHIELD?'SHIELD':name===STATUS.OVERHEAL?'OVERHEAL':
          name===STATUS.BLESSING?'BLESSING':name===STATUS.GRACE?'GRACE':
          name===STATUS.HP_LINK?'LINK':null;
        if(!kind)continue;
        const id=`${kind}:${unit.id}`;wanted.add(id);
        this.status(id,unit,()=>this.makeStatus(id,kind));
      }
    }
    this.pruneStatuses(wanted);
    // The field is created exclusively by a legal UNIT_ANIMATION cast. Duration
    // uses the official SkillDatabase turn count; its ring depicts the anchor,
    // NOT legal terrain cells (cliffs and walls are evaluated by gameplay).
    for(const [key,field] of this.fields){
      if((snapshot?.round??0)>=field.expiresRound){field.root.dispose(false,false);this.fields.delete(key);}
    }
  }
  makeStatus(id,kind){
    const root=this.node(`status-${id}`);
    const material=kind==='SHIELD'?'shield':kind==='GRACE'?'teal':kind==='LINK'?'blue':'gold';
    const outer=this.ring(root,`${kind}-outer`,kind==='SHIELD'?1.75:1.28,material,18);
    outer.rotation.x=Math.PI/2;
    const inner=this.ring(root,`${kind}-inner`,kind==='SHIELD'?1.30:.88,'white',12);
    inner.rotation.y=Math.PI/2;
    const motes=Array.from({length:kind==='SHIELD'?6:3},(_,i)=>this.orb(root,`${kind}-mote-${i}`,.10,'white'));
    return {root,above:.84,outer,inner,motes,kind};
  }
  addCast(role,event,snapshot,now){
    const fx=this.createEffect(role,event,snapshot,now,DURATION[role]||940);
    fx.root.position.copyFrom(role==='SLASH'||role==='CHARGE'?fx.from:fx.to);
    const holy=role==='PURIFY'?'teal':role==='SHIELD'?'shield':'gold';
    fx.ring=this.ring(fx.root,`${role}-circle`,role==='SANCTUARY'?2.2:1.15,holy,16);
    fx.ring.rotation.x=Math.PI/2;
    fx.core=this.orb(fx.root,`${role}-light`,role==='SANCTUARY'?.38:.31,'white');
    fx.motes=Array.from({length:role==='SLASH'?7:5},(_,i)=>this.shard(fx.root,`${role}-shard-${i}`,i%2?'white':holy,.24));
    if(role==='SLASH'||role==='CHARGE'){
      fx.edge=this.mesh(fx.root,`${role}-gold-edge`,'CreateBox',
        {width:1.30,height:.10,depth:.05},'gold');
      fx.whiteEdge=this.mesh(fx.root,`${role}-physical-edge`,'CreateBox',
        {width:1.12,height:.048,depth:.04},'white');
      fx.edge.rotation.y=Math.PI/4;fx.whiteEdge.rotation.y=Math.PI/4;
    }
    if(role==='JUDGEMENT'){
      fx.missile=this.orb(fx.root,'holy-judgement-dart',.27,'gold');
    }
    return fx;
  }
  addSanctuary(event,snapshot,now){
    const key=`${snapshot?.map?.id??''}:${event.sequence}:${event.unitId}`;
    const root=this.node(`sanctuary-anchor-${key}`,this.point(snapshot,event.targetX,event.targetY,.11));
    if(!['HEALING','PUNISHMENT'].includes(event.sanctuaryMode))return;
    const isHeal=event.sanctuaryMode==='HEALING';
    // The mode comes from the authoritative cast; never infer from a stale
    // resource bar. PvP-safe event already passes the actor visibility gate.
    const ring=this.ring(root,'sanctuary-ground-sigil',2.55,isHeal?'teal':'gold',24);
    ring.rotation.x=Math.PI/2;
    const core=this.ring(root,'sanctuary-inner-rune',1.65,'white',12);
    core.rotation.x=Math.PI/2;
    const points=Array.from({length:6},(_,i)=>this.orb(root,`sanctuary-point-${i}`,.12,isHeal?'teal':'gold'));
    this.fields.set(key,{root,ring,core,points,created:now,mode:event.sanctuaryMode,
      expiresRound:Number(snapshot?.round??0)+Number(this.sanctuarySkill?.sanctuary?.duration||0)});
    while(this.fields.size>4){const oldest=this.fields.keys().next().value;
      this.fields.get(oldest).root.dispose(false,false);this.fields.delete(oldest);}
  }
  updateEffect(fx,elapsed,p){
    fx.ring.scaling.setAll(.50+1.45*vfxSmooth(p));
    fx.ring.visibility=(1-p)*.94;
    fx.core.scaling.setAll(.15+.90*Math.sin(Math.PI*p));
    fx.core.visibility=(1-p)*.92;
    for(let i=0;i<fx.motes.length;i++){
      const a=VFX_TAU*i/fx.motes.length+elapsed*.003;
      const radius=.25+vfxSmooth(p)*.9;
      fx.motes[i].position.set(Math.cos(a)*radius,.1+Math.sin(a*2)*.20,Math.sin(a)*radius);
      fx.motes[i].visibility=(1-p)*.85;
    }
    if(fx.missile){fx.missile.position.copyFrom(fx.from.add(fx.to.subtract(fx.from).scale(vfxSmooth(p))));
      fx.missile.position.subtractInPlace(fx.root.position);}
    if(fx.edge){
      const pos=fx.from.add(fx.to.subtract(fx.from).scale(vfxSmooth(p)));
      fx.edge.position.copyFrom(pos.subtract(fx.root.position));
      fx.whiteEdge.position.copyFrom(fx.edge.position);
      fx.edge.rotation.z=p*1.9;fx.whiteEdge.rotation.z=p*1.9;
      fx.edge.visibility=(1-p);fx.whiteEdge.visibility=(1-p);
    }
  }
  updateAuras(now){
    for(const [key,fx] of this.auras){
      const theta=(now%14000)/14000*VFX_TAU;
      fx.outer.rotation.z=theta*.35;fx.inner.rotation.y=theta*.65;
      fx.outer.visibility=.55+.28*Math.sin(theta*2);
      fx.motes.forEach((m,i)=>{const a=theta+i*VFX_TAU/fx.motes.length;
        m.position.set(.65*Math.cos(a),.28*Math.sin(2*a),.65*Math.sin(a));});
    }
    for(const field of this.fields.values()){
      const t=(now-field.created)/1000;
      field.ring.rotation.y=t*.19;field.core.rotation.z=t*.21;
      field.points.forEach((p,i)=>{const a=VFX_TAU*i/field.points.length+t*.17;
        p.position.set(Math.cos(a)*1.16,.05+Math.sin(t*2+i)*.08,Math.sin(a)*1.16);});
    }
  }
  clear(){super.clear();for(const f of this.fields?.values()||[])f.root.dispose(false,false);this.fields?.clear();}
  diagnostics(){return {...super.diagnostics(),sanctuaryAnchors:this.fields.size}}
}
