/**
 * Shared shield techniques: full guard, swap rush and impact bash.
 * Presentation-only; actual status, positions and damage come from the canon.
 */
import {HeroCombatVfxBase,VFX_TAU,vfxSmooth} from './hero-combat-vfx-common.js';
import {VfxDatabase} from './vfx-database.js';
const MODULE='shield-guard';
const SKILLS=VfxDatabase.skillIds(MODULE);
const DURATION=Object.freeze({SWAP:460,GUARD:650,BASH:540});
export class ShieldGuardVfx extends HeroCombatVfxBase{
  constructor(scene){
    super(scene,{name:MODULE,maxActive:12,colors:{
      steel:[[.65,.81,.94],.85],rim:[[.86,.94,1],.95],
      guard:[[.32,.61,.85],.46],spark:[[1,.85,.55],.95]
    }});
  }
  sync(snapshot,events=[]){
    this.prepare(snapshot);
    const now=performance.now();
    for(const event of events){
      if(event?.type!=='UNIT_ANIMATION'||!this.acceptEvent(snapshot,event,SKILLS))continue;
      const role=VfxDatabase.roleFor(MODULE,event.skillId);
      if(!role)continue;
      const fx=this.createEffect(role,event,snapshot,now,DURATION[role]);
      fx.root.position.copyFrom(fx.from);
      // All geometry is transient; status persistence uses the real effect HUD.
      fx.face=this.mesh(fx.root,`${role}-shield-face`,'CreateBox',
        {width:1.2,height:1.65,depth:.10},'guard');
      fx.face.position.y=.24;
      fx.rim=this.ring(fx.root,`${role}-shield-rim`,1.18,'rim',20);
      fx.rim.rotation.x=Math.PI/2;
      fx.sparks=Array.from({length:role==='BASH'?7:4},(_,i)=>
        this.orb(fx.root,`${role}-impact-${i}`,.11,i%2?'steel':'spark'));
    }
  }
  updateEffect(fx,elapsed,t){
    const launch=vfxSmooth(t/.4),fade=1-vfxSmooth((t-.52)/.48);
    const start=fx.from,end=fx.to;
    const progress=fx.kind==='SWAP'?.75:fx.kind==='BASH'?.62:.10;
    fx.root.position.copyFrom(BABYLON.Vector3.Lerp(start,end,launch*progress));
    fx.face.scaling.setAll(.75+launch*.40);
    fx.face.visibility=fade*(fx.kind==='GUARD'?.85:.68);
    fx.rim.scaling.setAll(.45+launch*(fx.kind==='BASH'?1.5:1.2));
    fx.rim.visibility=fade*(fx.kind==='GUARD'?.8:1);
    fx.sparks.forEach((orb,i)=>{
      const a=VFX_TAU*i/fx.sparks.length;
      const burst=(fx.kind==='BASH'?1.05:.65)*launch;
      orb.position.set(Math.cos(a)*burst,.1+t*.68,Math.sin(a)*burst);
      orb.visibility=fade;
    });
  }
}
