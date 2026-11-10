/** Visual-only spear, water bolt, dive-grab and water-cast choreography.
 * WaterRenderer exclusively draws the actual TSUNAMI_WAVE and WHIRLPOOL,
 * and hydrology/forced movement own all gameplay effects. No duplicate wave.
 */
import {HeroCombatVfxBase,VFX_TAU,vfxClamp,vfxSmooth,vfxLerp,vfxVec} from './hero-combat-vfx-common.js';
import {VfxDatabase} from './vfx-database.js';
const MODULE='aquatic-magic',IDS=VfxDatabase.skillIds(MODULE);
const WATER_SHIELD_ID=VfxDatabase.statusId(MODULE,'WATER_SHIELD');
const DURATION={THRUST:670,THROW:850,BULLET:920,WHIRLPOOL:900,TSUNAMI:1040,DRAG:850};
export class AquaticMagicVfx extends HeroCombatVfxBase{
  constructor(scene){
    super(scene,{name:'aquatic-magic',maxActive:7,colors:{
      ocean:[[.13,.64,.92],.90],water:[[.42,.92,1],.88],foam:[[.85,.99,1],.82],
      shaft:[[.17,.39,.56],.87],trident:[[.86,.94,1],.94]
    }});
  }
  sync(snapshot,events=[]){
    this.prepare(snapshot);
    const now=performance.now();
    for(const event of events){
      if(!this.acceptEvent(snapshot,event,IDS))continue;
      this.cast(VfxDatabase.roleFor(MODULE,event.skillId),event,snapshot,now);
    }
    const wanted=new Set();
    for(const unit of snapshot?.units||[]){
      // Only actual applied shield effects. Water contact itself does not
      // grant a shield; it is published by the official effect engine.
      if((unit.effects||[]).some(e=>e.id===WATER_SHIELD_ID&&e.type==='SHIELD')){
        const id=`WATER_SHIELD:${unit.id}`;wanted.add(id);
        this.status(id,unit,()=>this.makeShield(id));
      }
    }
    this.pruneStatuses(wanted);
  }
  makeTrident(root,kind){
    const shaft=this.mesh(root,`${kind}-staff`,'CreateCylinder',
      {height:1.12,diameter:.06,tessellation:7},'shaft');shaft.rotation.x=Math.PI/2;
    const neck=this.mesh(root,`${kind}-neck`,'CreateCylinder',
      {height:.18,diameter:.15,tessellation:6},'trident');neck.rotation.x=Math.PI/2;neck.position.z=.65;
    const tines=[];
    for(let i=-1;i<=1;i++){
      const prong=this.mesh(root,`${kind}-prong-${i}`,'CreateCylinder',
        {height:.37,diameterTop:0,diameterBottom:.09,tessellation:6},'trident');
      prong.rotation.x=Math.PI/2;prong.position.set(i*.18,0,.83);tines.push(prong);
    }
    return {shaft,neck,tines};
  }
  makeShield(id){
    const root=this.node(`water-ward-${id}`);
    const outer=this.ring(root,'water-ward-ring',1.57,'water',18);
    outer.rotation.y=Math.PI/2;
    const inner=this.ring(root,'water-ward-crest',1.27,'foam',18);
    inner.rotation.x=Math.PI/2;
    return {root,above:.83,outer,inner};
  }
  cast(kind,e,s,now){
    const fx=this.createEffect(kind,e,s,now,DURATION[kind]);
    fx.root.position.copyFrom(kind==='WHIRLPOOL'||kind==='TSUNAMI'?fx.from:fx.to);
    fx.ring=this.ring(fx.root,`${kind}-water-spell-circle`,kind==='TSUNAMI'?1.7:1.1,'water',16);
    fx.ring.rotation.x=Math.PI/2;
    fx.spray=Array.from({length:7},(_,i)=>this.orb(fx.root,`${kind}-spray-${i}`,.14,i%2?'foam':'ocean'));
    if(kind==='THRUST'||kind==='THROW'){
      fx.weapon=this.node(`${kind}-trident-weapon`,fx.from);this.makeTrident(fx.weapon,kind);
      // The weapon node itself is parented to the effect's root. It is a
      // presentation duplicate of the caster's existing held trident only
      // during the attack; no equipment changes and no second hit roll.
      fx.weapon.parent=fx.root;fx.weapon.position.copyFrom(fx.from.subtract(fx.root.position));
    }
    if(kind==='BULLET')fx.bullet=this.orb(fx.root,'aquatic-bullet',.35,'ocean');
    if(kind==='DRAG'){
      // This represents only the confirmed grab's connecting current. The
      // authoritative forced-movement result still owns actual unit motion.
      const relativeFrom=fx.from.subtract(fx.root.position);
      const relativeTo=fx.to.subtract(fx.root.position);
      const mid=relativeFrom.add(relativeTo).scale(.5);mid.y+=.15;
      fx.current=this.tube(fx.root,'deep-drag-current',[relativeFrom,mid,relativeTo],'water',.055);
      fx.bubbles=Array.from({length:4},(_,i)=>this.orb(fx.root,`deep-drag-bubble-${i}`,.09,'foam'));
    }
    return fx;
  }
  updateEffect(fx,elapsed,p){
    fx.ring.scaling.setAll(.45+1.45*vfxSmooth(p));
    fx.ring.visibility=(1-p)*.82;
    fx.spray.forEach((orb,i)=>{
      const angle=VFX_TAU*i/fx.spray.length+elapsed*.003;
      const radius=.20+1.0*vfxSmooth(p);
      orb.position.set(Math.cos(angle)*radius,.20+Math.sin(angle*2)*.28,Math.sin(angle)*radius);
      orb.visibility=(1-p)*.8;
    });
    const travel=vfxSmooth(p);
    if(fx.weapon){
      const delta=fx.to.subtract(fx.from);
      const world=fx.from.add(delta.scale(fx.kind==='THRUST'?.65*travel:travel));
      const direction=fx.to.subtract(fx.from);
      const pitch=Math.atan2(direction.y,Math.hypot(direction.x,direction.z));
      fx.weapon.position.copyFrom(world.subtract(fx.root.position));
      fx.weapon.rotation.y=Math.atan2(direction.x,direction.z);
      fx.weapon.rotation.x=-pitch;
      fx.weapon.scaling.setAll((1-p)*.9+.1);
    }
    if(fx.bullet){const pos=fx.from.add(fx.to.subtract(fx.from).scale(travel));
      pos.y+=Math.sin(Math.PI*p)*.42;
      fx.bullet.position.copyFrom(pos.subtract(fx.root.position));
      fx.bullet.visibility=1-vfxSmooth((p-.72)/.28);
    }
    if(fx.current){fx.current.visibility=(1-p)*.88;
      fx.bubbles.forEach((bubble,i)=>{
        const pos=fx.from.add(fx.to.subtract(fx.from).scale(vfxClamp(p+i*.18)));
        pos.y+=Math.sin(p*VFX_TAU+i)*.2;
        bubble.position.copyFrom(pos.subtract(fx.root.position));bubble.visibility=(1-p)*.85;
      });
    }
  }
  updateAuras(now){for(const fx of this.auras.values()){
    const p=(now%5800)/5800*VFX_TAU;
    fx.outer.rotation.y=p;fx.inner.rotation.z=p*.5;
    fx.outer.visibility=.56+.22*Math.sin(p*2);
  }}
}
