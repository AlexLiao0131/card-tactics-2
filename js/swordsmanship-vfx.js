/**
 * Leon's sword technique visuals. Uses already committed UNIT_ANIMATION and
 * UNIT_FLOAT_TEXT, never re-rolls hit/defense, changes HP or moves combatants.
 */
import {HeroCombatVfxBase,VFX_TAU,vfxSmooth,vfxClamp} from './hero-combat-vfx-common.js';
import {VfxDatabase} from './vfx-database.js';

const MODULE='swordsmanship';
const SKILLS=VfxDatabase.skillIds(MODULE);
const LENGTH=Object.freeze({CUT:440,PIERCE:480,STRIKE:580,FLASH:720,PARRY:390,DODGE:390});
export class SwordsmanshipVfx extends HeroCombatVfxBase{
  constructor(scene){
    super(scene,{name:'swordsmanship',maxActive:10,colors:{
      steel:[[.72,.84,.98],.92],edge:[[.97,.98,1],.98],
      gold:[[1,.81,.38],.90],ghost:[[.43,.74,1],.35],impact:[[1,.73,.48],.92]
    }});
  }
  sync(snapshot,events=[]){
    this.prepare(snapshot);
    const now=performance.now();
    for(const event of events){
      if(event?.type==='UNIT_ANIMATION'){
        if(!this.acceptEvent(snapshot,event,SKILLS))continue;
        const kind=VfxDatabase.roleFor(MODULE,event.skillId);
        if(!kind)continue;
        this.startSword(kind,event,snapshot,now);
      }else if(event?.type==='UNIT_FLOAT_TEXT'&&['PARRY','DODGE'].includes(event.kind)){
        const unit=this.findUnit(snapshot,event.unitId);
        if(unit?.characterId!=='leon'&&unit?.character?.id!=='leon')continue;
        if(!Number.isFinite(event.x)||!Number.isFinite(event.y))continue;
        const key=`${snapshot?.map?.id}:${event.sequence}:${event.unitId}:${event.kind}`;
        if(this.seen.has(key))continue;
        this.seen.add(key);
        this.startDefense(event.kind,event,unit,snapshot,now);
      }
    }
  }
  startSword(kind,event,snapshot,now){
    const fx=this.createEffect(kind,event,snapshot,now,LENGTH[kind]);
    fx.root.position.copyFrom(fx.from);
    if(kind==='FLASH'&&Number.isFinite(event.landingX)&&Number.isFinite(event.landingY))
      fx.to=this.point(snapshot,event.landingX,event.landingY,.82);
    fx.span=fx.to.subtract(fx.from);
    fx.duel=event.duelActive===true;
    const glow=fx.duel?'gold':'steel';
    fx.edge=this.mesh(fx.root,`${kind}-blade`,'CreateBox',
      {width:kind==='PIERCE'?.08:1.42,height:kind==='PIERCE'?.07:.08,
        depth:kind==='PIERCE'?1.45:.055},'edge');
    fx.trail=this.ring(fx.root,`${kind}-arc`,kind==='STRIKE'?1.4:1.05,glow,16);
    fx.trail.rotation.x=Math.PI/3;
    fx.sparks=Array.from({length:kind==='FLASH'?7:4},(_,i)=>
      this.shard(fx.root,`${kind}-afterimage-${i}`,i%2?'ghost':glow,.18));
    if(fx.duel){
      fx.duelRing=this.ring(fx.root,'duel-rune',1.4,'gold',20);
      fx.duelRing.rotation.x=Math.PI/2;
    }
    if(kind==='FLASH'){
      // A LINE cast is one event no matter how many enemies were struck;
      // ghosts depict the full committed traversal, never relocate the unit.
      fx.edge.rotation.z=-.38;
      fx.trail.rotation.x=Math.PI/2;
    }
  }
  startDefense(kind,event,unit,snapshot,now){
    const fx=this.createEffect(kind,{...event,unitId:unit.id,
      x:unit.x,y:unit.y,targetX:unit.x,targetY:unit.y},snapshot,now,LENGTH[kind]);
    fx.root.position.copyFrom(this.unitPoint(unit,.96));
    fx.trail=this.ring(fx.root,`${kind}-defense`,1.17,kind==='PARRY'?'steel':'ghost',16);
    fx.trail.rotation.y=Math.PI/2;
    fx.edge=this.mesh(fx.root,`${kind}-flash`,'CreateBox',
      {width:1.05,height:.08,depth:.065},'edge');
    fx.edge.rotation.z=kind==='PARRY'?.54:-.54;
    fx.sparks=Array.from({length:3},(_,i)=>this.orb(fx.root,`defense-spark-${i}`,.12,'steel'));
  }
  updateEffect(fx,elapsed,t){
    const fade=1-vfxSmooth((t-.52)/.48);
    const strike=vfxSmooth(t/.32);
    if(fx.kind==='PARRY'||fx.kind==='DODGE'){
      fx.trail.scaling.setAll(.35+strike*1.5);
      fx.trail.visibility=fade*.9;
      fx.edge.rotation.y=elapsed*.007;
      fx.edge.visibility=fade;
    }else{
      const isFlash=fx.kind==='FLASH';
      const move=isFlash?vfxSmooth(t/.73):vfxSmooth(t/.47);
      if(isFlash){
        fx.root.position.copyFrom(BABYLON.Vector3.Lerp(fx.from,fx.to,move));
      }else{
        // The blade is painted from the official attacker's initial location.
        fx.root.position.copyFrom(BABYLON.Vector3.Lerp(fx.from,fx.to,move*.53));
      }
      fx.edge.rotation.y=elapsed*(fx.kind==='PIERCE'?.002:.008);
      fx.edge.rotation.z=fx.kind==='STRIKE'?.68*Math.sin(t*Math.PI):
        fx.kind==='CUT'?.86*Math.sin(t*Math.PI):fx.edge.rotation.z;
      fx.edge.visibility=fade;
      fx.trail.scaling.setAll(.40+strike*(isFlash?1.7:1.1));
      fx.trail.visibility=fade*.75;
      if(fx.duelRing){fx.duelRing.scaling.setAll(.7+strike*.9);fx.duelRing.visibility=fade*.76;}
    }
    fx.sparks.forEach((m,i)=>{
      const n=fx.sparks.length,a=i*VFX_TAU/n+elapsed*.004;
      if(fx.kind==='FLASH'){
        const delayed=vfxSmooth((t-i*.065)/.73);
        const lag=Math.max(0,move-delayed);
        m.position.set(-fx.span.x*lag,.10+Math.sin(t*Math.PI)*.20,-fx.span.z*lag);
      }else{
        m.position.set(Math.cos(a)*(.27+t*.45),.15+t*.35,Math.sin(a)*(.27+t*.45));
      }
      m.visibility=fade*(.55+i%2*.2);
    });
  }
}
