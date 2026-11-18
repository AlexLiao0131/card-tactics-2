/**
 * Shared Babylon spell and wild-form presentation. Only the geometry that has
 * no existing owner lives here (moonbeam, natural impact, rejuvenation and
 * beast/spear marks). EnvironmentRenderer ALONE owns live tornadoes, lightning
 * strikes and the canonical falling meteor / ground shockwave sequence.
 *
 * Reads published, visibility-filtered units and official UNIT_ANIMATION
 * events. No damage, game-state mutation, random target search or turn timing.
 */
import {VfxDatabase} from './vfx-database.js';
import {HeroCombatVfxBase,VFX_TAU,vfxClamp,vfxSmooth,vfxVec} from './hero-combat-vfx-common.js';

const MODULE='wild-magic';
const SKILLS=VfxDatabase.skillIds(MODULE);
const HOT=VfxDatabase.statusId(MODULE,'REJUVENATION');
const DUR=Object.freeze({MOONBEAM:1000,NATURE_BURST:760,REJUVENATION:920,
  SPEAR_THRUST:520,SPEAR_THROW:840,POUNCE:780,BITE:640,
  CLAW:550,SHRED:800,HIDE:650});

export class WildMagicVfx extends HeroCombatVfxBase{
  constructor(scene,{units=null}={}){
    super(scene,{name:'wild-magic',maxActive:14,colors:{
      moon:[[.85,.94,1],.70],moonCore:[[.98,.99,1],.90],moonRim:[[.61,.82,1],.88],
      leaf:[[.26,.83,.38],.90],lightLeaf:[[.72,1,.66],.90],deepLeaf:[[.10,.41,.20],.77],
      fang:[[1,.96,.84],.95],claw:[[1,.86,.69],.94],cut:[[.78,.15,.13],.66],
      spear:[[.73,.79,.79],.94],wood:[[.42,.28,.16],.88],shadow:[[.36,.49,.38],.58]
    }});
    this.units=units;
  }
  sync(snapshot,events=[]){
    this.prepare(snapshot);
    const now=performance.now();
    for(const event of events){
      if(!this.acceptEvent(snapshot,event,SKILLS))continue;
      const role=VfxDatabase.roleFor(MODULE,event.skillId);
      // The one environment renderer already owns these physical effects.
      // A silent receipt remains only to hold official float playback through
      // that real animation's public duration, not as a second VFX mesh.
      if(['METEOR','LIGHTNING'].includes(role)){
        const envelope=role==='METEOR'?this.meteorDuration():620;
        this.active.push({event,kind:role,started:now,duration:envelope});
        while(this.active.length>this.maxActive)this.removeEffect(this.active.shift());
        continue;
      }
      if(role==='TORNADO')continue; // Canonical terrain effect already created.
      this.start(role,event,snapshot,now);
    }
    const wanted=new Set();
    for(const unit of snapshot?.units||[]){
      if(unit.alive===false||!(unit.effects||[]).some(e=>e.id===HOT))continue;
      const key=`REJUVENATION:${unit.id}`;wanted.add(key);
      this.status(key,unit,()=>this.healingAura(key));
    }
    this.pruneStatuses(wanted);
  }
  meteorDuration(){
    // Use EXACTLY the existing starfall card animation contract, not a guessed
    // druid-only playback length. The core does not inherit card damage.
    const card=globalThis.CardDatabase?.get?.('starfall_card');
    const p=card?.effect?.presentation;
    const fall=Number(p?.fallDuration),impact=Number(p?.impactDuration);
    return p?.type==='METEOR_STRIKE'&&fall>0&&impact>0?fall+impact:0;
  }
  start(role,event,snapshot,now){
    if(!DUR[role])return;
    const fx=this.createEffect(role,event,snapshot,now,DUR[role]);
    fx.targetId=event.targetId==null?null:String(event.targetId);
    fx.root.position.copyFrom(fx.to);
    if(role==='MOONBEAM')this.moonbeam(fx);
    else if(role==='NATURE_BURST')this.natureBurst(fx);
    else if(role==='REJUVENATION')this.rejuvenation(fx);
    else if(role==='CLAW'||role==='SHRED')this.clawMarks(fx,role);
    else if(role==='BITE'||role==='POUNCE')this.biteMarks(fx,role);
    else if(role==='HIDE')this.hideMark(fx);
    else if(role==='SPEAR_THROW'||role==='SPEAR_THRUST')this.spearMark(fx,role);
  }
  moonbeam(fx){
    // A true moonbeam appears HIGH IN THE SKY and travels vertically DOWN.
    // It never launches from the caster or expands upwards from the ground.
    fx.root.position.y-=.72; // ground reference for the canonical target tile
    fx.beamShell=this.mesh(fx.root,'moonfire-sky-pillar','CreateCylinder',
      {height:1,diameterTop:.95,diameterBottom:1.32,tessellation:14},'moon');
    fx.beamCore=this.mesh(fx.root,'moonfire-white-core','CreateCylinder',
      {height:1,diameterTop:.28,diameterBottom:.56,tessellation:12},'moonCore');
    fx.skyRing=this.ring(fx.root,'moonfire-sky-opening',1.55,'moonRim',20);
    fx.skyRing.rotation.x=Math.PI/2;fx.skyRing.position.y=7.5;
    fx.groundRing=this.ring(fx.root,'moonfire-target-seal',1.20,'moonRim',20);
    fx.groundRing.rotation.x=Math.PI/2;fx.groundRing.position.y=.06;
    fx.motes=Array.from({length:8},(_,i)=>this.shard(fx.root,`moonfire-stardust-${i}`,
      i%2?'moonRim':'moonCore',.16));
    for(const mesh of [fx.beamShell,fx.beamCore,fx.groundRing])mesh.visibility=0;
  }
  natureBurst(fx){
    fx.root.position.y-=.20;
    fx.core=this.orb(fx.root,'wrath-force-core',.43,'deepLeaf');
    fx.rings=Array.from({length:3},(_,i)=>this.ring(fx.root,
      `wrath-nature-front-${i}`,1.0+i*.29,i===1?'lightLeaf':'leaf',14));
    fx.rings.forEach((m,i)=>{m.rotation.set(i*.37,i*.62,i*.24)});
    fx.thorns=Array.from({length:9},(_,i)=>this.shard(fx.root,`wrath-nature-thorn-${i}`,
      i%2?'lightLeaf':'leaf',.24+(i%3)*.09));
  }
  rejuvenation(fx){
    fx.ring=this.ring(fx.root,'rejuvenation-sylvan-circle',1.20,'leaf',18);
    fx.ring.rotation.x=Math.PI/2;fx.ring.position.y=-.62;
    fx.leaves=Array.from({length:8},(_,i)=>this.shard(fx.root,
      `rejuvenation-rise-leaf-${i}`,i%2?'lightLeaf':'leaf',.18));
    fx.lifeCore=this.orb(fx.root,'rejuvenation-life-spark',.34,'lightLeaf');
  }
  healingAura(key){
    const root=this.node(`rejuvenation-status-${key}`);
    const leaves=Array.from({length:4},(_,i)=>this.shard(root,`rejuvenation-buff-leaf-${i}`,
      i%2?'leaf':'lightLeaf',.16));
    const ring=this.ring(root,'rejuvenation-persistent-verdure',.9,'leaf',14);
    ring.rotation.x=Math.PI/2;ring.position.y=-.56;
    return{root,above:.65,leaves,ring,rejuvenation:true};
  }
  clawMarks(fx,role){
    const strong=role==='SHRED';
    fx.root.position.y+=.16;
    fx.slashes=Array.from({length:strong?7:3},(_,i)=>{
      // Each mark is a curved five-point gouge, not a generic straight bar.
      // Shred's finishing pass cuts across the first sweep in reverse.
      const dir=strong&&i>3?-1:1,offset=(i%4-1.5)*.15;
      const path=Array.from({length:5},(_,step)=>{
        const t=(step-2)/2,hook=.08*Math.sin((t+1)*Math.PI);
        return vfxVec(t*(strong?.74:.59),dir*(t*.52+hook)+offset,
          ((i%3)-1)*.05+Math.sin((t+1)*Math.PI)*.07);
      });
      const mesh=this.tube(fx.root,`feline-${role}-curved-gash-${i}`,path,
        i%3===1?'cut':'claw',strong?.053:.045);
      mesh.visibility=0;return mesh;
    });
    fx.spark=strong?this.ring(fx.root,'shred-finish-rip',1.03,'cut',16):null;
    if(fx.spark){fx.spark.rotation.x=Math.PI/2;fx.spark.visibility=0;}
  }
  biteMarks(fx,role){
    const pounce=role==='POUNCE';
    fx.root.position.y+=.10;
    // Two jaws with distinct upper/lower puncture arcs, not a slash trail.
    const upper=[[-.52,.19,0],[-.28,.30,.025],[0,.34,.04],[.28,.30,.025],[.52,.19,0]];
    const lower=[[-.50,-.16,0],[-.28,-.29,.025],[0,-.35,.04],[.28,-.29,.025],[.50,-.16,0]];
    fx.jaws=[upper,lower].map((points,i)=>this.tube(fx.root,
      `feline-${role}-jaw-${i}`,points.map(q=>vfxVec(...q)),i?'cut':'fang',.052));
    fx.fangs=[];
    for(const dir of [-1,1])for(const side of [-1,1]){
      const tooth=this.mesh(fx.root,`feline-${role}-tooth-${dir}-${side}`,'CreateCylinder',
        {height:.27,diameterTop:0,diameterBottom:.10,tessellation:6},'fang');
      tooth.position.set(side*.33,dir*.18,.07);tooth.rotation.z=dir>0?Math.PI:0;
      fx.fangs.push(tooth);
    }
    if(pounce){
      fx.pounceRing=this.ring(fx.root,'feline-pounce-shock-ring',1.26,'claw',18);
      fx.pounceRing.rotation.x=Math.PI/2;fx.pounceRing.visibility=0;
    }
  }
  hideMark(fx){
    fx.root.position.y-=.52;
    fx.hideRing=this.ring(fx.root,'feline-camouflage-leaf-vortex',1.05,'shadow',16);
    fx.hideRing.rotation.x=Math.PI/2;
    fx.hideLeaves=Array.from({length:6},(_,i)=>this.shard(fx.root,
      `feline-silent-leaf-${i}`,i%2?'leaf':'shadow',.15));
  }
  spearMark(fx,role){
    const flying=role==='SPEAR_THROW';
    if(flying){
      fx.root.position.copyFrom(fx.from);
      fx.shaft=this.mesh(fx.root,'sylvan-spear-shaft','CreateCylinder',
        {height:1.35,diameter:.075,tessellation:8},'wood');
      fx.shaft.rotation.x=Math.PI/2;
      fx.point=this.mesh(fx.root,'sylvan-spear-head','CreateCylinder',
        {height:.30,diameterTop:0,diameterBottom:.22,tessellation:6},'spear');
      fx.point.rotation.x=Math.PI/2;fx.point.position.z=.81;
      fx.wind=this.ring(fx.root,'sylvan-spear-flight-ring',.67,'leaf',12);
      fx.wind.rotation.x=Math.PI/2;
    }else{
      fx.root.position.y+=.16;
      fx.thrust=this.mesh(fx.root,'sylvan-spear-pierce-line','CreateBox',
        {width:.08,height:1.3,depth:.075},'spear');fx.thrust.rotation.z=.85;
      fx.tip=this.orb(fx.root,'sylvan-spear-point-spark',.18,'lightLeaf');
    }
  }
  livePoint(unitId,offset){
    const entries=this.units?.entries;
    const entry=entries?.get?.(unitId)||entries?.get?.(String(unitId));
    if(!entry?.root||entry.root.isDisposed?.())return null;
    const pos=entry.root.getAbsolutePosition?.()||entry.root.position;
    const p=pos.clone();
    p.y+=(entry.kind==='CAPSULE'?-Number(entry.height||0)/2:0)+offset;
    return p;
  }
  updateEffect(fx,elapsed,p){
    const role=fx.kind,q=vfxSmooth(p),a=elapsed*.008;
    if(role==='MOONBEAM'){
      const descend=vfxSmooth(p/.32),length=7.5*descend;
      // Top of the column is fixed at sky height 7.5 throughout descent.
      for(const [index,mesh] of [fx.beamShell,fx.beamCore].entries()){
        mesh.position.y=7.5-length*.5;
        mesh.scaling.y=Math.max(.001,length);
        mesh.visibility=length>.02?(1-vfxSmooth((p-.75)/.25))*(index?.98:.70):0;
      }
      fx.skyRing.visibility=(1-vfxSmooth(p/.40))*.90;
      fx.skyRing.rotation.y+=.008;
      const impact=vfxSmooth((p-.30)/.30);
      fx.groundRing.visibility=impact*(1-vfxSmooth((p-.72)/.28))*.88;
      fx.groundRing.scaling.setAll(.55+impact*1.05);
      for(let i=0;i<fx.motes.length;i++){
        const m=fx.motes[i],angle=i*VFX_TAU/fx.motes.length+a*.25;
        m.position.set(Math.cos(angle)*(.42+impact*.38),.12+Math.sin(angle*2)*.20+impact*.52,Math.sin(angle)*(.42+impact*.38));
        m.rotation.z=a+i;m.visibility=impact*(1-p)*.9;
      }
    }else if(role==='NATURE_BURST'){
      fx.core.scaling.setAll(.1+q*2.0);fx.core.visibility=(1-q)*.80;
      fx.rings.forEach((m,i)=>{m.scaling.setAll(.28+q*(1.75+i*.28));
        m.visibility=(1-p)*.90;m.rotation.z+=.014*(i%2?1:-1);});
      fx.thorns.forEach((m,i)=>{const t=i*VFX_TAU/fx.thorns.length;
        m.position.set(Math.cos(t)*(.10+q*1.4),Math.sin(t*2)*(.2+q*.3),Math.sin(t)*(.10+q*1.4));
        m.rotation.set(t,a,t*.5);m.visibility=(1-p)*.95;});
    }else if(role==='REJUVENATION'){
      const live=this.livePoint(fx.targetId,.85);
      if(live)fx.root.position.copyFrom(live);
      fx.ring.scaling.setAll(.64+q*.72);fx.ring.visibility=(1-p)*.78;
      fx.lifeCore.scaling.setAll(.5+.38*Math.sin(Math.PI*p));fx.lifeCore.visibility=(1-p)*.88;
      fx.leaves.forEach((m,i)=>{const t=i*VFX_TAU/fx.leaves.length+a*.6;
        m.position.set(Math.cos(t)*(.30+q*.43),-.5+q*1.2+i*.032,Math.sin(t)*(.30+q*.43));
        m.rotation.y+=.024;m.visibility=(1-p)*.95;});
    }else if(role==='CLAW'||role==='SHRED'){
      fx.slashes.forEach((m,i)=>{const offset=i/(fx.slashes.length+1);
        const reveal=vfxClamp((p-.10-offset*.22)/.22);
        m.visibility=reveal*(1-vfxSmooth((p-.70)/.30))*.97;
        m.scaling.x=.25+.75*vfxSmooth(reveal);
        m.position.z=.01+q*.10;
      });
      if(fx.spark){fx.spark.visibility=vfxSmooth((p-.40)/.20)*(1-p)*.70;
        fx.spark.scaling.setAll(.50+q*.75);}
    }else if(role==='BITE'||role==='POUNCE'){
      // Jaws close on the target after pounce travel, independently of claw bars.
      const jawTime=role==='POUNCE'?vfxClamp((p-.40)/.43):vfxClamp((p-.12)/.43);
      const close=vfxSmooth(jawTime);
      fx.jaws[0].position.y=.30-close*.22;fx.jaws[1].position.y=-.30+close*.22;
      fx.jaws.forEach((m,i)=>m.visibility=(1-vfxSmooth((p-.80)/.20))*.93);
      fx.fangs.forEach((m,i)=>{const sign=i<2?-1:1;
        m.position.y=sign*(.28-.18*close);m.visibility=(1-vfxSmooth((p-.80)/.20))*.90;});
      if(fx.pounceRing){fx.pounceRing.visibility=close*(1-p)*.74;
        fx.pounceRing.scaling.setAll(.65+q*.75);}
    }else if(role==='HIDE'){
      fx.hideRing.scaling.setAll(1-.37*q);fx.hideRing.rotation.y+=.045;
      fx.hideRing.visibility=(1-p)*.70;
      fx.hideLeaves.forEach((m,i)=>{const t=i*VFX_TAU/fx.hideLeaves.length+a;
        m.position.set(Math.cos(t)*(.45-.25*q),q*.75,Math.sin(t)*(.45-.25*q));
        m.visibility=(1-p)*.86;});
    }else if(role==='SPEAR_THROW'){
      fx.root.position.copyFrom(BABYLON.Vector3.Lerp(fx.from,fx.to,q));
      fx.root.position.y+=Math.sin(Math.PI*p)*.28;
      const direction=fx.to.subtract(fx.from);fx.root.rotation.y=Math.atan2(direction.x,direction.z);
      fx.wind.scaling.setAll(.7+.6*Math.sin(Math.PI*p));fx.wind.visibility=(1-p)*.55;
    }else if(role==='SPEAR_THRUST'){
      fx.thrust.scaling.y=.4+.7*Math.sin(Math.PI*p);
      fx.thrust.visibility=(1-p)*.72;
      fx.tip.scaling.setAll(.7+q);fx.tip.visibility=(1-p)*.95;
    }
  }
  updateAuras(now){
    for(const fx of this.auras.values()){
      if(!fx.rejuvenation)continue;
      fx.leaves.forEach((m,i)=>{const a=i*VFX_TAU/fx.leaves.length+now*.0018;
        m.position.set(Math.cos(a)*.42,Math.sin(a*1.2)*.26,Math.sin(a)*.42);
        m.rotation.y+=.012;});
      fx.ring.rotation.y+=.010;
    }
  }
  diagnostics(){return {...super.diagnostics(),environmentGeometryOwnedBy:'EnvironmentRenderer'};}
}
