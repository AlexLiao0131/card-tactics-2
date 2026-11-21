import {VfxDatabase} from './vfx-database.js?rev=20261121-alchemy-vfx-1';
/**
 * Cassandra's shared Babylon-only spell presentation.
 *
 * Every cast begins from an authoritative UNIT_ANIMATION presentation event.
 * Buff removal, HP damage, MP loss, analysis duration and PvP visibility remain
 * exclusively owned by the game's existing combat/state engines. A visible
 * analysis glyph follows the effect carried by the published unit snapshot.
 *
 * Uses BabylonRenderer's existing scene, snapshot commit and frame clock;
 * no extra timers, lights, textures, colliders or gameplay-side mutations.
 */
import {TILE_SIZE,ELEVATION_HEIGHT} from './coordinate-system.js';

const MODULE='arcane';
const SPELLS=Object.fromEntries(VfxDatabase.skillIds(MODULE)
  .filter(id=>id.startsWith('cassandra_')).map(id=>[id,VfxDatabase.roleFor(MODULE,id)]));
const ALCHEMY_SPELLS=Object.fromEntries(VfxDatabase.skillIds(MODULE)
  .filter(id=>id.startsWith('alchemy_')).map(id=>[id,VfxDatabase.roleFor(MODULE,id)]));
const ALCHEMY_COLORS=Object.freeze({
  NONE:[.93,.71,.37],NATURE:[.36,.94,.48],WATER:[.22,.78,1],
  ICE:[.66,.92,1],FIRE:[1,.38,.13],THUNDER:[.47,.55,1],
  HOLY:[1,.87,.36],DARK:[.49,.25,.81],STONE:[.81,.65,.43]});
const ALCHEMY_TERRAIN=new Set(['WATER_TO_LAND','FLOOD','FREEZE','MUD','SHATTER','WALL','CLIFF']);
const ANALYSIS_ID=VfxDatabase.statusId(MODULE,'ANALYSIS');
const DURATION=Object.freeze({ANALYZE:1060,MANA_BURN:1160,DISPEL:1050,DISSOLVE:1390});
const MAX_ACTIVE=4;
const PI=Math.PI,TAU=2*PI;
const clamp=x=>Math.max(0,Math.min(1,Number(x)||0));
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t)};
const mix=(a,b,t)=>a+(b-a)*t;
const vec=(x,y,z)=>new BABYLON.Vector3(x,y,z);

export function isCassandraSpellPresentationEvent(event){
  return !!event&&event.type==='UNIT_ANIMATION'&&
    Object.prototype.hasOwnProperty.call(SPELLS,event.skillId)&&
    Number.isFinite(event.targetX)&&Number.isFinite(event.targetY)&&
    Number.isFinite(event.x)&&Number.isFinite(event.y)&&
    event.unitId!=null;
}

export function isAlchemySpellPresentationEvent(event){
  return !!event&&event.type==='UNIT_ANIMATION'&&
    Object.prototype.hasOwnProperty.call(ALCHEMY_SPELLS,event.skillId)&&
    Number.isFinite(event.targetX)&&Number.isFinite(event.targetY)&&
    Number.isFinite(event.x)&&Number.isFinite(event.y)&&event.unitId!=null;
}

export class ArcaneSigilVfx{
  constructor(scene){
    this.scene=scene;
    this.active=[];
    this.analysisGlyphs=new Map();
    this.recent=new Set();
    this.mapId=null;this.round=null;this.hasTimeline=false;
    this.materials={
      ink:this.material('cassandra-ink',[.11,.035,.28],.86),
      violet:this.material('cassandra-violet',[.56,.20,.94],.90),
      bright:this.material('cassandra-bright',[.88,.65,1],.95),
      cyan:this.material('cassandra-mana-flame',[.16,.61,1],.93),
      gold:this.material('cassandra-ward-fracture',[1,.72,.32],.87),
      alchemyGlass:this.material('alchemy-vial-glass',[.75,.94,.95],.27),
      alchemyMetal:this.material('alchemy-vial-metal',[.72,.60,.39],.90),
      alchemyCore:this.material('alchemy-runic-ink',[.25,.17,.34],.86),
      alchemyWhite:this.material('alchemy-runic-light',[1,.95,.77],.97),
      ...Object.fromEntries(Object.entries(ALCHEMY_COLORS).map(([name,color])=>
        [`alchemy${name}`,this.material(`alchemy-affinity-${name.toLowerCase()}`,color,.93)]))
    };
    if(BABYLON.Engine?.ALPHA_COMBINE!==undefined)
      this.materials.alchemyGlass.alphaMode=BABYLON.Engine.ALPHA_COMBINE;
    scene.onDisposeObservable?.addOnce?.(()=>this.dispose());
  }
  material(name,color,alpha){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=new BABYLON.Color3(...color);
    material.emissiveColor=new BABYLON.Color3(...color);
    material.alpha=alpha;
    material.disableLighting=true;
    material.backFaceCulling=false;
    if(BABYLON.Engine?.ALPHA_ADD!==undefined)
      material.alphaMode=BABYLON.Engine.ALPHA_ADD;
    return material;
  }
  mesh(root,name,kind,args,material='violet'){
    const mesh=BABYLON.MeshBuilder[kind](name,args,this.scene);
    mesh.parent=root;
    mesh.material=this.materials[material];
    mesh.isPickable=false;mesh.receiveShadows=false;
    mesh.metadata={castShadow:false};
    return mesh;
  }
  rune(root,name,diameter=1,material='violet',sides=8){
    return this.mesh(root,name,'CreateTorus',{
      diameter,thickness:.045,tessellation:sides
    },material);
  }
  sphere(root,name,diameter,material='bright'){
    return this.mesh(root,name,'CreateSphere',{diameter,segments:8},material);
  }
  shard(root,name,index,count,radius,material='violet',height=.28){
    const mesh=this.mesh(root,name,'CreateBox',{
      width:.12,height,depth:.085
    },material);
    const angle=TAU*index/count;
    mesh.position.set(Math.cos(angle)*radius,Math.sin(angle*2)*.10,Math.sin(angle)*radius);
    mesh.rotation.set(.3,angle,.55+angle);
    return mesh;
  }
  height(snapshot,x,y){
    const unit=(snapshot?.units||[]).find(u=>u.alive!==false&&u.x===x&&u.y===y);
    if(unit){
      const z=unit.renderZ??unit.z;
      if(z!=null&&Number.isFinite(Number(z)))return Number(z)*ELEVATION_HEIGHT;
    }
    const tile=(snapshot?.map?.tiles||[]).find(t=>t.x===x&&t.y===y);
    return Number(tile?.elevation??0)*ELEVATION_HEIGHT;
  }
  position(snapshot,x,y,above){
    return vec(x*TILE_SIZE,this.height(snapshot,x,y)+above,y*TILE_SIZE);
  }
  spawn(event,snapshot,now){
    const kind=SPELLS[event.skillId];
    const source=this.position(snapshot,event.x,event.y,1.18);
    const target=this.position(snapshot,event.targetX,event.targetY,.80);
    const root=new BABYLON.TransformNode(`cassandra-${kind}-caster`,this.scene);
    const impact=new BABYLON.TransformNode(`cassandra-${kind}-target`,this.scene);
    root.position.copyFrom(source);impact.position.copyFrom(target);
    const effect={kind,root,impact,source,target,start:now,duration:DURATION[kind],
      sourceSigil:null,targetSigils:[],shards:[],orb:null,trails:[],
      flames:[],shock:null,beamRoot:null,beam:null};
    effect.sourceSigil=this.rune(root,'cassandra-caster-runic-ring',.84,'bright',8);
    effect.sourceSigil.rotation.x=PI/2;
    if(kind==='ANALYZE'){
      const second=this.rune(root,'cassandra-analysis-hex',.62,'violet',6);
      second.rotation.x=PI/2;effect.casterInner=second;
      effect.orb=this.sphere(root,'cassandra-analysis-dart',.28,'violet');
      effect.orbCore=this.sphere(root,'cassandra-analysis-dart-core',.12,'cyan');
      effect.trails=Array.from({length:3},(_,i)=>this.sphere(root,`cassandra-analysis-trail-${i}`, .15-i*.025,'bright'));
      effect.targetSigils=[this.rune(impact,'cassandra-analysis-lock',.90,'cyan',6)];
      effect.targetSigils[0].rotation.x=PI/2;
    }else if(kind==='MANA_BURN'){
      effect.orb=this.sphere(root,'cassandra-mana-burn-core',.25,'cyan');
      effect.trails=Array.from({length:2},(_,i)=>this.sphere(root,`cassandra-mana-trail-${i}`,.13-i*.03,'violet'));
      effect.targetSigils=[this.rune(impact,'cassandra-mana-brand-a',1.08,'cyan',8),
        this.rune(impact,'cassandra-mana-brand-b',.71,'violet',6)];
      for(const ring of effect.targetSigils)ring.rotation.x=PI/2;
      effect.flames=Array.from({length:7},(_,i)=>{
        const flame=this.mesh(impact,`cassandra-mana-splinter-${i}`,'CreateBox',
          {width:.095,height:.35,depth:.07},i%2?'cyan':'violet');
        const angle=TAU*i/7;
        flame.position.set(Math.cos(angle)*.46,0,Math.sin(angle)*.46);
        flame.rotation.set(.3,angle,angle*.36);
        return flame;
      });
    }else if(kind==='DISPEL'){
      // One ward fractures, not a second damage calculation. The same effect
      // works against a chosen unit buff or a four-cell Holy Wing Wall anchor.
      effect.targetSigils=[this.rune(impact,'cassandra-ward-outer',1.48,'gold',8),
        this.rune(impact,'cassandra-ward-inner',.93,'bright',6),
        this.rune(impact,'cassandra-dispel-cut',.56,'cyan',6)];
      effect.targetSigils[0].rotation.x=PI/2;
      effect.targetSigils[1].rotation.y=PI/2;
      effect.targetSigils[2].rotation.z=PI/2;
      effect.shards=Array.from({length:9},(_,i)=>this.shard(impact,
        `cassandra-shattered-ward-${i}`,i,9,.45,i%3?'gold':'cyan',.47));
    }else if(kind==='DISSOLVE'){
      effect.targetSigils=[this.rune(impact,'cassandra-dissolve-seal-a',1.70,'violet',8),
        this.rune(impact,'cassandra-dissolve-seal-b',1.25,'bright',6),
        this.rune(impact,'cassandra-dissolve-seal-c',.72,'cyan',8)];
      effect.targetSigils[0].rotation.x=PI/2;
      effect.targetSigils[1].rotation.z=PI/2;
      effect.targetSigils[2].rotation.y=PI/2;
      effect.shards=Array.from({length:11},(_,i)=>this.shard(impact,
        `cassandra-dissolve-rune-${i}`,i,11,1.50,i%3?'violet':'cyan',.46));
      effect.orb=this.sphere(impact,'cassandra-dissolve-implosion',.73,'ink');
      effect.shock=this.rune(impact,'cassandra-dissolve-wave',1.35,'bright',20);
      effect.shock.rotation.x=PI/2;
      const beamRoot=new BABYLON.TransformNode('cassandra-dissolve-ray-root',this.scene);
      beamRoot.position.copyFrom(source.add(target).scale(.5));
      beamRoot.lookAt(target);
      const distance=target.subtract(source).length();
      effect.beamRoot=beamRoot;
      effect.beam=this.mesh(beamRoot,'cassandra-dissolve-ray','CreateBox',
        {width:.11,height:.16,depth:Math.max(.10,distance)},'cyan');
      effect.beamRoot.setEnabled(false);
    }
    this.active.push(effect);
    while(this.active.length>MAX_ACTIVE)this.remove(this.active.shift());
  }
  // A single shared Babylon geometry pipeline for the five material spells
  // and seven true-terrain casts. It never resolves material costs, damage or
  // hydrology; the official UNIT_ANIMATION contains the committed variant.
  alchemySurfacePosition(snapshot,x,y,above=0){
    const tile=(snapshot?.map?.tiles||[]).find(t=>t.x===x&&t.y===y);
    const depth=Math.max(0,Number(tile?.waterDepth||0));
    const surface=depth>0?Number(tile?.waterSurfaceZ??(Number(tile?.elevation||0)+depth)):
      Number(tile?.elevation||0);
    return vec(x*TILE_SIZE,surface*ELEVATION_HEIGHT+above,y*TILE_SIZE);
  }
  spawnAlchemy(event,snapshot,now){
    const kind=ALCHEMY_SPELLS[event.skillId];
    const element=String(event.alchemyAffinity||'NONE').toUpperCase();
    const affinity=Object.hasOwn(ALCHEMY_COLORS,element)?element:'NONE';
    const mat=`alchemy${affinity}`;
    const terrain=kind==='ALCHEMY_TERRAIN'&&ALCHEMY_TERRAIN.has(event.alchemyTerrain)
      ?event.alchemyTerrain:null;
    const source=this.position(snapshot,event.x,event.y,1.12);
    const target=kind==='ALCHEMY_BLAST'||terrain
      ?this.alchemySurfacePosition(snapshot,event.targetX,event.targetY,.62)
      :this.position(snapshot,event.targetX,event.targetY,.62);
    const root=new BABYLON.TransformNode(`alchemy-${kind}-source`,this.scene);
    const impact=new BABYLON.TransformNode(`alchemy-${kind}-target`,this.scene);
    root.position.copyFrom(source);impact.position.copyFrom(target);
    const fx={alchemy:true,kind,affinity,terrain,source,target,root,impact,
      start:now,duration:terrain?1700:1300,event,
      motes:[],rings:[],impactMotes:[],hitForms:[],formation:null,liquid:null,field:[]};
    // The same runic wheel materializes the ingredient and condensed object.
    const wheel=this.rune(root,'alchemy-materialization-wheel',1.08,'alchemyWhite',16);
    wheel.rotation.x=PI/2;wheel.position.y=-.88;
    const inner=this.rune(root,'alchemy-materialization-inner',.70,mat,8);
    inner.rotation.x=PI/2;inner.position.y=-.80;
    fx.rings.push(wheel,inner);
    for(let i=0;i<9;i++){
      const shape=['STONE','THUNDER','HOLY'].includes(affinity)?'CreateBox':
        ['ICE','FIRE','NATURE'].includes(affinity)?'CreateCylinder':'CreateSphere';
      const args=shape==='CreateSphere'?{diameter:.10,segments:6}:shape==='CreateBox'?
        {width:.07,height:.17,depth:.07}:
        {height:.17,diameterTop:0,diameterBottom:.11,tessellation:6};
      const label=kind==='ALCHEMY_TERRAIN'?'alchemy-rune-spark':'alchemy-ingredient';
      const mote=this.mesh(root,`${label}-${i}`,shape,args,i%3?'alchemyWhite':mat);
      fx.motes.push(mote);
    }
    // All props are real Babylon meshes (not flat billboards). Potion flasks
    // are formed from translucent glass, colored liquid and an actual stopper.
    const prop=new BABYLON.TransformNode(`alchemy-${kind}-formed-prop`,this.scene);
    prop.parent=root;
    fx.formation=prop;
    if(kind==='ALCHEMY_TERRAIN'){
      // The ultimate spends ONLY the charged rune: a pure geometrical
      // transmutation focus, not a free physical potion or extra ingredient.
      const focus=this.mesh(prop,'alchemy-world-transmutation-focus','CreateCylinder',
        {height:.62,diameterTop:0,diameterBottom:.43,tessellation:8},'alchemyWhite');
      focus.rotation.z=PI/3;
      for(let i=0;i<3;i++){
        const band=this.rune(prop,`alchemy-world-synthesis-ring-${i}`,.62+i*.23,
          i%2?'alchemyNONE':'alchemyWhite',12);
        band.rotation.set(PI*(i%2)/2,0,PI*i/3);
      }
    }else if(kind==='ALCHEMY_MANA'){
      const crystal=this.mesh(prop,'alchemy-mana-cut-crystal','CreateCylinder',
        {height:.47,diameterTop:.01,diameterBottom:.34,tessellation:6},mat);
      crystal.rotation.z=PI/4;
      const core=this.sphere(prop,'alchemy-mana-crystal-core',.18,'alchemyWhite');
      core.position.y=.05;
      const prongs=Array.from({length:3},(_,i)=>this.mesh(prop,
        `alchemy-crystal-facet-${i}`,'CreateBox',{width:.06,height:.28,depth:.06},'alchemyMetal'));
      prongs.forEach((p,i)=>{p.rotation.z=TAU*i/3;p.position.set(Math.cos(TAU*i/3)*.14,.02,0)});
    }else{
      const body=this.mesh(prop,'alchemy-glass-vial','CreateCylinder',
        {height:.48,diameterTop:.27,diameterBottom:.35,tessellation:12},'alchemyGlass');
      const liquid=this.mesh(prop,'alchemy-vial-liquid','CreateCylinder',
        {height:.25,diameterTop:.245,diameterBottom:.31,tessellation:12},mat);
      liquid.position.y=-.095;fx.liquid=liquid;
      const neck=this.mesh(prop,'alchemy-vial-neck','CreateCylinder',
        {height:.18,diameter:.15,tessellation:10},'alchemyGlass');neck.position.y=.31;
      const cork=this.mesh(prop,'alchemy-vial-stopper','CreateCylinder',
        {height:.10,diameterTop:.19,diameterBottom:.15,tessellation:10},'alchemyMetal');
      cork.position.y=.42;
      if(kind==='ALCHEMY_ARMOR'){
        const band=this.rune(prop,'alchemy-vial-armor-band',.43,mat,8);
        band.rotation.x=PI/2;
      }
    }
    const pulse=this.rune(impact,'alchemy-impact-primary-sigil',kind==='ALCHEMY_BLAST'?1.35:1.05,mat,20);
    pulse.rotation.x=PI/2;pulse.position.y=-.48;
    const cross=this.rune(impact,'alchemy-impact-secondary-sigil',.63,'alchemyWhite',8);
    cross.rotation.z=PI/2;
    fx.impactMotes.push(pulse,cross);
    const n=kind==='ALCHEMY_BLAST'?14:9;
    for(let i=0;i<n;i++){
      const material=i%4===0?'alchemyWhite':mat;
      const shape=(kind==='ALCHEMY_ARMOR'||kind==='ALCHEMY_BLAST'||
        ['STONE','THUNDER','HOLY'].includes(affinity))?'CreateBox':
        ['ICE','FIRE','NATURE'].includes(affinity)?'CreateCylinder':'CreateSphere';
      const args=shape==='CreateBox'?{width:.09,height:.28,depth:.085}:
        shape==='CreateCylinder'?{height:.25,diameterTop:0,diameterBottom:.12,tessellation:6}:
        {diameter:.13,segments:6};
      fx.impactMotes.push(this.mesh(impact,`alchemy-effect-spark-${i}`,shape,args,material));
    }
    // Visible target-side identity, distinct from the elemental color.
    // Statuses and damage remain the authoritative EffectEngine's concern.
    if(kind==='ALCHEMY_MANA'){
      for(let i=0;i<5;i++){
        const diamond=this.mesh(impact,`alchemy-mana-restoration-crystal-${i}`,
          'CreateCylinder',{height:.24,diameterTop:0,diameterBottom:.17,tessellation:6},mat);
        fx.hitForms.push(diamond);
      }
    }else if(kind==='ALCHEMY_HEAL'){
      const plusH=this.mesh(impact,'alchemy-healing-cross-horizontal','CreateBox',
        {width:.55,height:.105,depth:.10},'alchemyWhite');
      const plusV=this.mesh(impact,'alchemy-healing-cross-vertical','CreateBox',
        {width:.105,height:.55,depth:.10},'alchemyWhite');
      fx.hitForms.push(plusH,plusV);
      for(let i=0;i<5;i++)fx.hitForms.push(this.mesh(impact,
        `alchemy-healing-leaf-${i}`,'CreateCylinder',
        {height:.29,diameterTop:0,diameterBottom:.12,tessellation:6},mat));
    }else if(kind==='ALCHEMY_POWER'){
      for(let i=0;i<3;i++){
        const arrow=this.mesh(impact,`alchemy-power-arrow-${i}`,'CreateCylinder',
          {height:.47,diameterTop:0,diameterBottom:.19,tessellation:4},mat);
        fx.hitForms.push(arrow);
      }
    }else if(kind==='ALCHEMY_ARMOR'){
      for(let i=0;i<5;i++){
        const plate=this.mesh(impact,`alchemy-armor-floating-plate-${i}`,'CreateBox',
          {width:.23,height:.59,depth:.075},i===0?'alchemyWhite':mat);
        fx.hitForms.push(plate);
      }
    }else if(kind==='ALCHEMY_BLAST'){
      const core=this.sphere(impact,'alchemy-volumetric-explosion-core',.83,mat);
      fx.hitForms.push(core);
      const shell=this.rune(impact,'alchemy-blast-spherical-shock',1.05,'alchemyWhite',24);
      shell.rotation.x=PI/2;fx.hitForms.push(shell);
    }
    if(terrain)this.terrainShapes(fx,event,snapshot,mat);
    fx.root.setEnabled(true);fx.impact.setEnabled(true);
    this.active.push(fx);
    while(this.active.length>MAX_ACTIVE)this.remove(this.active.shift());
    return fx;
  }
  terrainShapes(fx,event,snapshot,mat){
    // Only actual committed cells are illuminated. Never invent a persistent
    // ice surface/wall/rock collision mesh: the normal map renderer owns that.
    const cells=Array.isArray(event.alchemyFootprint)&&event.alchemyFootprint.length
      ?event.alchemyFootprint.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))
      :[{x:event.targetX,y:event.targetY}];
    const maxCells=Math.min(3,cells.length);
    for(let i=0;i<maxCells;i++){
      const cell=cells[i];
      const anchor=new BABYLON.TransformNode(`alchemy-terrain-${fx.terrain}-${i}`,this.scene);
      const position=this.alchemySurfacePosition(snapshot,cell.x,cell.y,.05);
      anchor.position.copyFrom(position);
      fx.field.push({root:anchor,parts:[],index:i});
      const parts=fx.field[i].parts;
      const box=(name,w,h,d,material=mat)=>this.mesh(anchor,name,'CreateBox',
        {width:w,height:h,depth:d},material);
      const wave=(name,r,material=mat)=>{
        const mesh=this.rune(anchor,name,r,material,20);mesh.rotation.x=PI/2;return mesh;
      };
      if(fx.terrain==='FLOOD'){
        for(let ring=0;ring<3;ring++)parts.push(wave(`alchemy-flood-circular-wave-${ring}`,.5+ring*.36,ring?'alchemyWATER':'alchemyWhite'));
      }else if(fx.terrain==='FREEZE'){
        const ice=box('alchemy-ice-hex-sheet',.87,.07,.87,'alchemyICE');parts.push(ice);
        for(let j=0;j<6;j++){
          const needle=this.mesh(anchor,`alchemy-ice-crystal-${j}`,'CreateCylinder',
            {height:.49,diameterTop:0,diameterBottom:.17,tessellation:6},'alchemyICE');
          const a=TAU*j/6;needle.position.set(Math.cos(a)*.40,.18,Math.sin(a)*.40);
          parts.push(needle);
        }
      }else if(fx.terrain==='MUD'){
        parts.push(box('alchemy-mud-surface-shimmer',.83,.09,.83,'alchemySTONE'));
        for(let j=0;j<6;j++){
          const bubble=this.sphere(anchor,`alchemy-mud-bubble-${j}`,.16,'alchemySTONE');
          const a=TAU*j/6;bubble.position.set(Math.cos(a)*.32,.08,Math.sin(a)*.32);parts.push(bubble);
        }
      }else if(fx.terrain==='SHATTER'){
        for(let j=0;j<11;j++)parts.push(box(`alchemy-shattered-rock-${j}`,.13,.20,.11,'alchemySTONE'));
      }else if(fx.terrain==='WALL'||fx.terrain==='CLIFF'||fx.terrain==='WATER_TO_LAND'){
        const height=fx.terrain==='CLIFF'?1.60:fx.terrain==='WALL'?1.30:.28;
        fx.field[i].riseHeight=height;
        parts.push(box(`alchemy-${fx.terrain.toLowerCase()}-rising-outline`,.77,height,.77,'alchemySTONE'));
        parts[0].position.y=height/2;
        for(let j=0;j<4;j++){
          const edge=box(`alchemy-terrain-outline-${j}`,.08,height,.08,'alchemyWhite');
          edge.position.set(j%2?.38:-.38,height/2,j<2?-.38:.38);parts.push(edge);
        }
      }
    }
  }
  updateAlchemy(f,elapsed,p){
    const phase=smooth(elapsed/300);
    f.rings.forEach((ring,i)=>{
      ring.rotation.y=elapsed*(i?.004:-.005);
      ring.scaling.setAll(.22+phase*(i?.70:1.05));
      ring.visibility=(1-smooth((elapsed-850)/360))*(i?.84:.96);
    });
    f.motes.forEach((mote,i)=>{
      const a=TAU*i/f.motes.length+elapsed*.005*(i%2?-1:1);
      const gather=smooth(elapsed/350),r=(.82-.67*gather)+.04*Math.sin(elapsed*.015+i);
      mote.position.set(Math.cos(a)*r,Math.sin(a*2)*.18,Math.sin(a)*r);
      mote.rotation.y=elapsed*.004+i;
      mote.visibility=(1-smooth((elapsed-500)/220))*.90;
    });
    const travel=smooth((elapsed-360)/460),launch=elapsed>=340&&elapsed<900;
    const relative=f.target.subtract(f.source);
    f.formation.position.set(relative.x*travel,
      relative.y*travel+Math.sin(PI*travel)*.55,relative.z*travel);
    f.formation.rotation.y=elapsed*.0022;
    f.formation.scaling.setAll(.18+.82*smooth(elapsed/310));
    f.formation.setEnabled(launch);
    const burst=smooth((elapsed-800)/270),fade=1-smooth((elapsed-1130)/180);
    f.impactMotes.forEach((m,i)=>{
      if(i<2){m.rotation.y=elapsed*(i?.004:-.005);m.scaling.setAll(.15+burst*(i?.98:1.70));}
      else{
        const j=i-2,a=TAU*j/(f.impactMotes.length-2);
        const r=.09+burst*(f.kind==='ALCHEMY_BLAST'?1.75:.85);
        const lift=f.affinity==='FIRE'?burst*(.4+j%3*.13):
          f.affinity==='ICE'?burst*.40:
          f.affinity==='WATER'?-.12+Math.sin(a*2)*.1:Math.sin(a*2)*.11+burst*.28;
        m.position.set(Math.cos(a)*r,lift,Math.sin(a)*r);
        m.rotation.y=elapsed*.006+a;
      }
      m.visibility=burst*fade*(i===1?.75:.95);
    });
    f.hitForms.forEach((m,i)=>{
      const a=TAU*i/Math.max(1,f.hitForms.length)+elapsed*.0015;
      if(f.kind==='ALCHEMY_MANA'){
        m.position.set(Math.cos(a)*(.22+burst*.40),burst*(.16+i%2*.22),Math.sin(a)*(.22+burst*.40));
        m.rotation.z=elapsed*.003+i;
      }else if(f.kind==='ALCHEMY_HEAL'){
        if(i<2)m.position.y=.22+burst*.24;
        else {m.position.set(Math.cos(a)*.52,burst*(.06+i*.09),Math.sin(a)*.52);m.rotation.z=a;}
      }else if(f.kind==='ALCHEMY_POWER'){
        m.position.set(Math.cos(a)*(.25+burst*.35),burst*(.08+i*.21),Math.sin(a)*(.25+burst*.35));
      }else if(f.kind==='ALCHEMY_ARMOR'){
        m.position.set(Math.cos(a)*(.65-burst*.09),.38+Math.sin(a*2)*.16,
          Math.sin(a)*(.65-burst*.09));m.rotation.y=a;
      }else if(f.kind==='ALCHEMY_BLAST'){
        m.scaling.setAll(i===0?.1+burst*3.3:.1+burst*2.9);
        m.position.y=.18;
      }
      m.visibility=burst*fade*(f.kind==='ALCHEMY_BLAST'?.7:.9);
    });
    f.impactMotes[0]?.setEnabled(elapsed>=760);
    f.impactMotes[1]?.setEnabled(elapsed>=760);
    if(f.terrain){
      const up=smooth((elapsed-730)/350),decay=1-smooth((elapsed-1320)/320);
      for(const [i,group] of f.field.entries()){
        for(const [j,shape] of group.parts.entries()){
          if(f.terrain==='FLOOD'){
            shape.scaling.setAll(.10+up*(1.35+j*.17));
          }else if(f.terrain==='SHATTER'){
            const a=TAU*j/group.parts.length;
            shape.position.set(Math.cos(a)*(.12+up*.95),.13+up*(.25+j%4*.12),Math.sin(a)*(.12+up*.95));
            shape.rotation.z=up*(a+1.3);
          }else if(f.terrain==='MUD'&&j>0){
            shape.position.y=.08+up*.25;shape.scaling.setAll(.45+up*.65);
          }else if(f.terrain==='FREEZE'&&j>0){
            shape.scaling.y=Math.max(.02,up);
          }else if(f.terrain==='WALL'||f.terrain==='CLIFF'||f.terrain==='WATER_TO_LAND'){
            // The REAL terrain already exists. These are just short-lived
            // highlight edges rising into its verified new position.
            shape.scaling.y=Math.max(.015,up);
            shape.position.y=(group.riseHeight||0)*up/2;
          }
          shape.visibility=up*decay*(j===0?.68:.93);
        }
      }
    }
  }
  addGlyph(id,unit){
    const root=new BABYLON.TransformNode(`cassandra-analysis-glyph-${id}`,this.scene);
    const outer=this.rune(root,'cassandra-analysis-status-hex',.89,'cyan',6);
    const inner=this.rune(root,'cassandra-analysis-status-core',.47,'bright',8);
    outer.rotation.x=PI/2;inner.rotation.z=PI/2;
    const glyph={root,outer,inner};
    this.analysisGlyphs.set(id,glyph);
    this.moveGlyph(glyph,unit);
    return glyph;
  }
  moveGlyph(glyph,unit){
    const z=unit.renderZ??unit.z??0;
    glyph.root.position.set(Number(unit.x)*TILE_SIZE,
      Number(z)*ELEVATION_HEIGHT+1.58,Number(unit.y)*TILE_SIZE);
  }
  sync(snapshot,events=[]){
    const mapId=snapshot?.map?.id??null;
    const round=Number(snapshot?.round??0);
    if(this.hasTimeline&&(this.mapId!==mapId||round<this.round))this.clear();
    this.mapId=mapId;this.round=round;this.hasTimeline=true;
    const visible=new Set((snapshot?.units||[]).filter(u=>u.alive!==false).map(u=>String(u.id)));
    const now=performance.now();
    for(const event of events||[]){
      const isAlchemy=isAlchemySpellPresentationEvent(event);
      if((!isCassandraSpellPresentationEvent(event)&&!isAlchemy)||
         !visible.has(String(event.unitId)))continue;
      const key=Number.isSafeInteger(event.sequence)
        ? `${mapId}:${event.sequence}:${event.unitId}:${event.skillId}`:null;
      if(key&&this.recent.has(key))continue;
      if(key){
        this.recent.add(key);
        if(this.recent.size>128)this.recent.delete(this.recent.values().next().value);
      }
      if(isAlchemy)this.spawnAlchemy(event,snapshot,now);
      else this.spawn(event,snapshot,now);
    }
    // The authoritative snapshot is the sole source for visible analysis marks.
    // A miss, a cleanse or an expired status never leaves a predicted marker.
    const wanted=new Set();
    for(const unit of snapshot?.units||[]){
      if(unit.alive===false||!Array.isArray(unit.effects)||
         !unit.effects.some(e=>e.id===ANALYSIS_ID))continue;
      const id=String(unit.id);wanted.add(id);
      const glyph=this.analysisGlyphs.get(id)||this.addGlyph(id,unit);
      this.moveGlyph(glyph,unit);
    }
    for(const [id,glyph] of this.analysisGlyphs){
      if(!wanted.has(id)){glyph.root.dispose(false,false);this.analysisGlyphs.delete(id)}
    }
  }
  updateFrame(now=performance.now()){
    for(const glyph of this.analysisGlyphs.values()){
      glyph.outer.rotation.y+=.022;
      glyph.inner.rotation.y-=.034;
      glyph.outer.visibility=.46+.14*Math.sin(now*.006);
      glyph.inner.visibility=.64+.16*Math.sin(now*.008);
    }
    for(let i=this.active.length-1;i>=0;i--){
      const f=this.active[i],elapsed=Math.max(0,now-f.start);
      if(elapsed>=f.duration){this.remove(f);this.active.splice(i,1);continue;}
      const progress=clamp(elapsed/f.duration);
      if(f.alchemy){this.updateAlchemy(f,elapsed,progress);continue;}
      f.sourceSigil.rotation.y=elapsed*.0032;
      f.sourceSigil.scaling.setAll(.2+.8*smooth(elapsed/290));
      f.sourceSigil.visibility=(1-progress)*.87;
      if(f.kind==='ANALYZE'||f.kind==='MANA_BURN'){
        const travel=smooth((elapsed-170)/520);
        const live=elapsed>=150&&elapsed<740;
        const arc=Math.sin(PI*travel)*.45;
        const x=mix(f.source.x,f.target.x,travel)-f.source.x;
        const y=mix(f.source.y,f.target.y,travel)-f.source.y+arc;
        const z=mix(f.source.z,f.target.z,travel)-f.source.z;
        f.orb.position.set(x,y,z);f.orb.setEnabled(live);
        if(f.orbCore){f.orbCore.position.copyFrom(f.orb.position);f.orbCore.setEnabled(live)}
        f.trails.forEach((trail,index)=>{
          const lag=smooth((elapsed-170-(index+1)*52)/520);
          trail.position.set(mix(f.source.x,f.target.x,lag)-f.source.x,
            mix(f.source.y,f.target.y,lag)-f.source.y+Math.sin(PI*lag)*.45,
            mix(f.source.z,f.target.z,lag)-f.source.z);
          trail.setEnabled(live);
          trail.visibility=(1-progress)*(.64-index*.13);
        });
        f.targetSigils.forEach((ring,index)=>{
          const bloom=smooth((elapsed-670)/290);
          ring.setEnabled(elapsed>=650);
          ring.scaling.setAll(.12+bloom*(index?.95:1.40));
          ring.visibility=(1-bloom)*(index?.85:1);
          ring.rotation.y=elapsed*(index?-.003:.003);
        });
        if(f.casterInner){f.casterInner.rotation.y=-elapsed*.004;
          f.casterInner.visibility=(1-progress)*.78;}
        if(f.flames.length){
          const flamePulse=smooth((elapsed-630)/170),fade=1-smooth((elapsed-920)/220);
          f.flames.forEach((mesh,index)=>{
            const a=TAU*index/f.flames.length;
            const lift=flamePulse*(.30+index%3*.12);
            mesh.position.set(Math.cos(a)*(.30+flamePulse*.35),lift,
              Math.sin(a)*(.30+flamePulse*.35));
            mesh.scaling.y=.35+flamePulse*(.85+(index%3)*.18);
            mesh.visibility=flamePulse*fade;
          });
        }
      }else if(f.kind==='DISPEL'){
        const shatter=smooth((elapsed-290)/450);
        const fade=1-smooth((elapsed-650)/350);
        f.targetSigils.forEach((mesh,index)=>{
          mesh.rotation.y=elapsed*(index%2?.004:-.004);
          mesh.scaling.setAll(.36+.65*smooth(elapsed/290)+shatter*.30);
          mesh.visibility=fade*(1-shatter*.76);
        });
        f.shards.forEach((mesh,index)=>{
          const angle=TAU*index/f.shards.length;
          const radius=.32+shatter*1.45;
          mesh.position.set(Math.cos(angle)*radius,
            Math.sin(angle*2)*.12+shatter*(.25+index%3*.17),
            Math.sin(angle)*radius);
          mesh.rotation.z=angle+elapsed*.004;
          mesh.visibility=shatter*fade;
        });
      }else if(f.kind==='DISSOLVE'){
        const gather=smooth((elapsed-120)/500);
        const explode=smooth((elapsed-660)/470);
        f.targetSigils.forEach((ring,index)=>{
          ring.rotation.y=elapsed*(index%2?.005:-.006);
          ring.scaling.setAll(.18+gather*(index===0?1.22:.88)-explode*.39);
          ring.visibility=(1-smooth((elapsed-1030)/360))*.88;
        });
        f.shards.forEach((mesh,index)=>{
          const angle=TAU*index/f.shards.length+elapsed*.0018;
          const radius=mix(1.65,.22,gather)+explode*1.70;
          mesh.position.set(Math.cos(angle)*radius,Math.sin(angle*2)*(.2+explode*.7),
            Math.sin(angle)*radius);
          mesh.rotation.y=elapsed*.003+angle;
          mesh.visibility=(1-explode)*.85;
        });
        f.orb.scaling.setAll(.30+gather*.78-explode*.69);
        f.orb.visibility=1-smooth((elapsed-890)/340);
        f.beamRoot.setEnabled(elapsed>=530&&elapsed<940);
        f.beam.visibility=1-smooth((elapsed-810)/130);
        f.shock.setEnabled(elapsed>=660);
        f.shock.scaling.setAll(.13+1.7*explode);
        f.shock.visibility=1-explode;
      }
    }
  }
  remove(effect){
    for(const field of effect?.field||[])field.root?.dispose?.(false,false);
    effect?.root?.dispose?.(false,false);
    effect?.impact?.dispose?.(false,false);
    effect?.beamRoot?.dispose?.(false,false);
  }
  clear(){
    for(const effect of this.active)this.remove(effect);
    this.active.length=0;
    for(const glyph of this.analysisGlyphs.values())glyph.root.dispose(false,false);
    this.analysisGlyphs.clear();this.recent.clear();
  }
  dispose(){
    this.clear();
    for(const material of Object.values(this.materials))material.dispose?.();
  }
  diagnostics(){return{active:this.active.length,analysisMarks:this.analysisGlyphs.size,
    materials:Object.keys(this.materials).length,
    skills:Object.keys(SPELLS).length+Object.keys(ALCHEMY_SPELLS).length};}
}
