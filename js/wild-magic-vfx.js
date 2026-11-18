/**
 * Shared Babylon spell and wild-form presentation. Only the geometry that has
 * no existing owner lives here (moonbeam, natural impact, rejuvenation and
 * beast/spear marks). EnvironmentRenderer ALONE owns live tornadoes, lightning
 * strikes and the canonical falling meteor / ground shockwave sequence.
 *
 * Reads published, visibility-filtered units and official UNIT_ANIMATION
 * events. No damage, game-state mutation, random target search or turn timing.
 */
import {VfxDatabase} from './vfx-database.js?rev=20261118-avreshi-vfx-2';
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
      if(['MOONBEAM','METEOR','LIGHTNING','TORNADO'].includes(role))
        globalThis.CardTacticsDiagnostics?.push?.('AVRESHI_VFX_ACCEPTED',{
          skillId:event.skillId,role,sequence:event.sequence,
          targetX:event.targetX,targetY:event.targetY
        });
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
    // A high-altitude moon shaft: two tapered overlapping columns descend from
    // above the camera's ground sightline. Moonlight is not an Ophi projectile.
    const height=8.2;
    fx.moonHeight=height;
    fx.root.position.y-=.74;
    fx.beamShell=this.mesh(fx.root,'avreshi-moonfire-sky-column','CreateCylinder',
      {height:1,diameterTop:1.48,diameterBottom:1.0,tessellation:20},'moon');
    fx.beamCore=this.mesh(fx.root,'avreshi-moonfire-luminous-core','CreateCylinder',
      {height:1,diameterTop:.52,diameterBottom:.75,tessellation:16},'moonCore');
    fx.skyRing=this.ring(fx.root,'avreshi-moonfire-sky-gate',2.6,'moonRim',32);
    fx.skyRing.rotation.x=Math.PI/2;fx.skyRing.position.y=height;
    fx.groundRing=this.ring(fx.root,'avreshi-moonfire-ground-impact',1.55,'moonRim',32);
    fx.groundRing.rotation.x=Math.PI/2;fx.groundRing.position.y=.055;
    fx.impactCrescent=this.ring(fx.root,'avreshi-moonfire-impact-crescent',1.05,'moonCore',30);
    fx.impactCrescent.rotation.x=Math.PI/2;fx.impactCrescent.position.y=.078;
    fx.motes=Array.from({length:12},(_,i)=>this.shard(fx.root,
      `avreshi-moonfire-falling-shard-${i}`,i%3?'moonRim':'moonCore',.20));
    for(const mesh of [fx.beamShell,fx.beamCore,fx.groundRing,fx.impactCrescent,...fx.motes])mesh.visibility=0;
  }
  natureBurst(fx){
    // Wrath is an erupting forest root-fissure, never Ophi's emerald missile.
    // The Moon Priestess tears OPEN the soil below a single enemy: rock cracks,
    // interlocking wooden roots rise, and curved thorns converge at the impact.
    fx.root.position.y-=.82;
    fx.fissures=Array.from({length:5},(_,i)=>{
      const a=i*VFX_TAU/5,dx=Math.cos(a),dz=Math.sin(a);
      return this.tube(fx.root,`wrath-earth-fissure-${i}`,[
        vfxVec(dx*.11,.025,dz*.11),vfxVec(dx*.33-dz*.06,.025,dz*.33+dx*.06),
        vfxVec(dx*.62+dz*.08,.028,dz*.62-dx*.08),
        vfxVec(dx*1.02,.03,dz*1.02)],i%2?'wood':'deepLeaf',.052);
    });
    fx.roots=Array.from({length:6},(_,i)=>{
      const a=i*VFX_TAU/6,points=Array.from({length:6},(_,step)=>{
        const t=step/5,angle=a+t*1.28,r=.69-.46*t;
        return vfxVec(Math.cos(angle)*r,.03+t*(1.58+(i%3)*.18),
          Math.sin(angle)*r);
      });
      const mesh=this.tube(fx.root,`wrath-rising-root-${i}`,points,
        i%2?'wood':'deepLeaf',.085-(i%3)*.009);
      mesh.visibility=0;return mesh;
    });
    fx.thorns=Array.from({length:9},(_,i)=>{
      const a=i*VFX_TAU/9,thorn=this.mesh(fx.root,`wrath-blackthorn-${i}`,
        'CreateCylinder',{height:.58+(i%3)*.16,diameterTop:0,
          diameterBottom:.17,tessellation:6},i%3?'wood':'moonRim');
      thorn.position.set(Math.cos(a)*(.45+(i%3)*.08),.32,
        Math.sin(a)*(.45+(i%3)*.08));
      thorn.rotation.z=Math.sin(a)*.30;
      thorn.rotation.x=Math.cos(a)*.30;
      thorn.visibility=0;return thorn;
    });
    fx.moonSplinters=Array.from({length:5},(_,i)=>{
      const blade=this.shard(fx.root,`wrath-halfmoon-wood-shard-${i}`,
        i%2?'moonRim':'wood',.18+(i%3)*.11);
      blade.visibility=0;return blade;
    });
  }
  rejuvenation(fx){
    // Moonlit flower opens at the ally's feet while spiral stems grow upwards.
    // Different geometry and color language from Ophi's song circle and notes.
    fx.root.position.y-=.53;
    fx.petals=Array.from({length:8},(_,i)=>{
      const petal=this.mesh(fx.root,`moonbloom-petal-${i}`,'CreateSphere',
        {diameter:1,segments:8},i%3?'moon':'moonCore');
      const a=i*VFX_TAU/8;
      petal.position.set(Math.cos(a)*.15,.15,Math.sin(a)*.15);
      petal.scaling.set(.17,.045,.36);
      petal.rotation.y=a;
      petal.visibility=0;
      return petal;
    });
    fx.stems=Array.from({length:3},(_,i)=>{
      const a=i*VFX_TAU/3;
      const points=Array.from({length:7},(_,j)=>{
        const t=j/6,spin=a+t*2.5,rad=.21+.21*Math.sin(t*Math.PI);
        return vfxVec(Math.cos(spin)*rad,.12+t*1.55,Math.sin(spin)*rad);
      });
      const mesh=this.tube(fx.root,`moonbloom-healing-vine-${i}`,points,
        i===1?'lightLeaf':'moonRim',.025);
      mesh.visibility=0;return mesh;
    });
    fx.dewdrops=Array.from({length:6},(_,i)=>{
      const crystal=this.shard(fx.root,`moonbloom-dew-crystal-${i}`,
        i%2?'moonCore':'moonRim',.11);
      crystal.visibility=0;return crystal;
    });
  }
  healingAura(key){
    const root=this.node(`moonbloom-regrowth-status-${key}`);
    // Three living crescents, rather than a round healing-song boundary.
    const shoots=Array.from({length:3},(_,i)=>{
      const a=i*VFX_TAU/3;
      const points=Array.from({length:6},(_,j)=>{
        const t=j/5,angle=a+t*1.3;
        return vfxVec(Math.cos(angle)*(.30+.17*t),-.44+t*.88,
          Math.sin(angle)*(.30+.17*t));
      });
      return this.tube(root,`moonbloom-regrowth-shoot-${i}`,points,
        i===1?'lightLeaf':'moonRim',.028);
    });
    const buds=Array.from({length:5},(_,i)=>{
      const flower=this.mesh(root,`moonbloom-regrowth-bud-${i}`,
        'CreateSphere',{diameter:1,segments:6},i%2?'moon':'moonCore');
      flower.scaling.set(.11,.04,.21);return flower;
    });
    return{root,above:.72,shoots,buds,rejuvenation:true};
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
    // Camouflage is a fading predator pawprint in smoky shade, not green leaves.
    fx.root.position.y-=.54;
    fx.hidePaws=Array.from({length:3},(_,i)=>{
      const paw=this.mesh(fx.root,`feline-stealth-footprint-pad-${i}`,
        'CreateSphere',{diameter:1,segments:7},'shadow');
      paw.scaling.set(.20,.018,.25);
      paw.position.set((i-1)*.25,.03,(i-1)*.14);
      return paw;
    });
    fx.hideToes=Array.from({length:9},(_,i)=>{
      const toe=this.orb(fx.root,`feline-stealth-toe-${i}`, .085,'shadow');
      const paw=Math.floor(i/3),finger=i%3;
      toe.scaling.y=.24;
      toe.position.set((paw-1)*.25+(finger-1)*.10,.07,(paw-1)*.14+.21);
      return toe;
    });
    fx.hideMist=Array.from({length:5},(_,i)=>this.shard(fx.root,
      `feline-stealth-shadow-vapor-${i}`,'shadow',.12+(i%3)*.09));
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
      const height=fx.moonHeight,descend=vfxSmooth(p/.28),length=height*descend;
      // Root origin is the target ground. The pillar's TOP is fixed in the sky
      // while its bottom sweeps downward to ground-level impact.
      for(const [index,mesh] of [fx.beamShell,fx.beamCore].entries()){
        mesh.position.y=height-length*.5;
        mesh.scaling.y=Math.max(.001,length);
        mesh.visibility=length>.02?(1-vfxSmooth((p-.79)/.21))*(index?.98:.92):0;
      }
      fx.skyRing.visibility=(1-vfxSmooth(p/.52))*.94;
      fx.skyRing.rotation.z+=.008;
      const impact=vfxSmooth((p-.24)/.26),falloff=1-vfxSmooth((p-.76)/.24);
      fx.groundRing.visibility=impact*falloff*.94;
      fx.groundRing.scaling.setAll(.50+impact*1.35);
      fx.impactCrescent.visibility=impact*falloff*.90;
      fx.impactCrescent.scaling.setAll(.35+impact*.82);
      for(let i=0;i<fx.motes.length;i++){
        const m=fx.motes[i],angle=i*VFX_TAU/fx.motes.length+a*.27;
        m.position.set(Math.cos(angle)*(.37+impact*.67),.12+Math.sin(angle*3)*.22+impact*.65,
          Math.sin(angle)*(.37+impact*.67));
        m.rotation.z=a+i;m.visibility=impact*falloff*.90;
      }
    }else if(role==='NATURE_BURST'){
      const erupt=vfxSmooth((p-.08)/.40),fade=1-vfxSmooth((p-.67)/.33);
      fx.fissures.forEach((mesh,i)=>{
        mesh.visibility=vfxSmooth((p-.03-i*.018)/.18)*fade*.94;
        mesh.scaling.setAll(.15+erupt*.85);
      });
      fx.roots.forEach((mesh,i)=>{
        mesh.scaling.y=Math.max(.001,vfxSmooth((p-.12-i*.021)/.35));
        mesh.visibility=erupt*fade*.96;
      });
      fx.thorns.forEach((mesh,i)=>{
        mesh.scaling.y=Math.max(.001,vfxSmooth((p-.16-(i%3)*.043)/.26));
        mesh.visibility=erupt*fade*.87;
      });
      fx.moonSplinters.forEach((mesh,i)=>{
        const a=i*VFX_TAU/fx.moonSplinters.length;
        mesh.position.set(Math.cos(a)*(.18+erupt*.72),.32+erupt*(.52+(i%3)*.11),
          Math.sin(a)*(.18+erupt*.72));
        mesh.rotation.z=a+elapsed*.003;
        mesh.visibility=erupt*fade*.85;
      });
    }else if(role==='REJUVENATION'){
      const live=this.livePoint(fx.targetId,.18);
      if(live)fx.root.position.copyFrom(live);
      const bloom=vfxSmooth((p-.06)/.42),fade=1-vfxSmooth((p-.75)/.25);
      fx.petals.forEach((mesh,i)=>{
        const a=i*VFX_TAU/8,r=.13+.42*bloom;
        mesh.position.set(Math.cos(a)*r,.08+.28*bloom,Math.sin(a)*r);
        mesh.rotation.z=.20+bloom*.62;
        mesh.scaling.set(.12+.10*bloom,.04,.20+.15*bloom);
        mesh.visibility=bloom*fade*.94;
      });
      fx.stems.forEach((mesh,i)=>{
        mesh.scaling.y=Math.max(.001,vfxSmooth((p-.24-i*.055)/.38));
        mesh.visibility=bloom*fade*.80;
      });
      fx.dewdrops.forEach((mesh,i)=>{
        const a=i*VFX_TAU/fx.dewdrops.length+elapsed*.0016;
        mesh.position.set(Math.cos(a)*(.34+.22*bloom),.35+bloom*(.43+(i%3)*.19),
          Math.sin(a)*(.34+.22*bloom));
        mesh.visibility=bloom*fade*.90;
      });
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
      const fade=1-vfxSmooth((p-.36)/.58);
      for(const mesh of [...fx.hidePaws,...fx.hideToes]){
        mesh.visibility=fade*.80;
        mesh.position.y=.02+q*.055;
      }
      fx.hideMist.forEach((mesh,i)=>{
        const a=i*VFX_TAU/fx.hideMist.length;
        mesh.position.set(Math.cos(a)*(.25+.23*q),.22+q*.46+i*.025,
          Math.sin(a)*(.25+.23*q));
        mesh.visibility=fade*.52;
      });
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
      fx.shoots.forEach((shoot,i)=>{
        shoot.rotation.y=.08*Math.sin(now*.0007+i);
        shoot.visibility=.58+.12*Math.sin(now*.002+i);
      });
      fx.buds.forEach((m,i)=>{
        const a=i*VFX_TAU/fx.buds.length+now*.0007;
        m.position.set(Math.cos(a)*.40,-.16+(i%3)*.23+Math.sin(a)*.08,
          Math.sin(a)*.40);
        m.rotation.y=a;m.visibility=.69+.15*Math.sin(a);
      });
    }
  }
  diagnostics(){return {...super.diagnostics(),environmentGeometryOwnedBy:'EnvironmentRenderer'};}
}
