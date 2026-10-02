import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";
import { VisualSurfaceResolver } from "./visual-surface-resolver.js";
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

const tileKey=(x,y)=>`${x},${y}`;
function canonicalType(object){return globalThis.EnvironmentObjectEngine?.normalizeType?.(object?.type)||String(object?.type||"").toUpperCase();}
function groundY(tile){return Number(tile?.elevation||0)*ELEVATION_HEIGHT;}
function objectY(tile,object){
  if(!tile)return 0;
  if(object.floatOnWater===true&&tile.waterSurfaceZ!=null)return Number(tile.waterSurfaceZ)*ELEVATION_HEIGHT;
  return groundY(tile);
}
function hash01(value){
  const text=String(value||"");let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return(h>>>0)/4294967295;
}

export class MapObjectRenderer{
  constructor(scene){
    this.scene=scene;
    this.nodes=new Map();
    this.surfaceResolver=new VisualSurfaceResolver();
    this.materials={
      trunk:this.mat("prop-trunk",new BABYLON.Color3(.28,.17,.09)),
      deadTrunk:this.mat("prop-dead-trunk",new BABYLON.Color3(.25,.23,.20)),
      foliage:this.mat("prop-foliage",new BABYLON.Color3(.10,.34,.16)),
      bush:this.mat("prop-bush",new BABYLON.Color3(.13,.39,.18)),
      rock:this.mat("prop-rock",new BABYLON.Color3(.36,.38,.42)),
      generic:this.mat("prop-generic",new BABYLON.Color3(.38,.34,.28))
    };
    this.surfaceMaterial=this.mat("prop-vertex-surface",BABYLON.Color3.White());
    this.surfaceMaterial.specularColor=new BABYLON.Color3(.025,.025,.025);
    this.bushTime=0;this.bushFrameTime=0;this.bushWasCalm=true;this.bushWind=null;
    this.bushObserver=scene.onBeforeRenderObservable.add(()=>this.updateBushWind(Math.min(.1,Math.max(0,scene.getEngine().getDeltaTime()/1000))));
    scene.onDisposeObservable.addOnce(()=>scene.onBeforeRenderObservable.remove(this.bushObserver));
  }

  mat(name,color){const material=new BABYLON.StandardMaterial(name,this.scene);material.diffuseColor=color;material.specularColor=BABYLON.Color3.Black();return material;}
  setNodeVisibility(node,value){node.getChildMeshes?.().forEach(mesh=>mesh.visibility=value);}
  root(object){const root=new BABYLON.TransformNode(`map-object-${object.id}`,this.scene);root.metadata={kind:"map-object",objectId:object.id,objectType:canonicalType(object)};return root;}
  mesh(root,mesh,material){mesh.parent=root;mesh.material=material;mesh.isPickable=false;mesh.receiveShadows=true;return mesh;}

  createTree(object,dead=false){
    const root=this.root(object),seed=hash01(object.id),trunkMat=dead?this.materials.deadTrunk:this.materials.trunk;
    const trunk=this.mesh(root,BABYLON.MeshBuilder.CreateCylinder(`tree-trunk-${object.id}`,{height:1.25,diameter:.24,tessellation:7},this.scene),trunkMat);
    trunk.position.y=.625;
    if(!dead){
      const canopy=this.mesh(root,BABYLON.MeshBuilder.CreateCylinder(`tree-canopy-${object.id}`,{height:1.35,diameterTop:.10,diameterBottom:1.08,tessellation:8},this.scene),this.materials.foliage);
      canopy.position.y=1.48;
    }else{
      for(let i=0;i<2;i++){
        const branch=this.mesh(root,BABYLON.MeshBuilder.CreateCylinder(`dead-branch-${object.id}-${i}`,{height:.62,diameter:.08,tessellation:6},this.scene),trunkMat);
        branch.position.set((i?-.16:.16),1.05,0);branch.rotation.z=(i?-.7:.7);
      }
    }
    root.rotation.y=seed*Math.PI*2;root.scaling.setAll(.88+seed*.18);return root;
  }

  createStump(object){
    const root=this.root(object),stump=this.mesh(root,BABYLON.MeshBuilder.CreateCylinder(`stump-${object.id}`,{height:.34,diameter:.48,tessellation:8},this.scene),this.materials.trunk);
    stump.position.y=.17;root.rotation.y=hash01(object.id)*Math.PI*2;return root;
  }

  createLog(object){
    const root=this.root(object),log=this.mesh(root,BABYLON.MeshBuilder.CreateCylinder(`log-${object.id}`,{height:1.05,diameter:.30,tessellation:8},this.scene),this.materials.trunk);
    log.rotation.z=Math.PI/2;log.position.y=.18;root.rotation.y=hash01(object.id)*Math.PI*2;return root;
  }

  createBush(object){
    const root=this.root(object),positions=[],indices=[],weights=[];
    // Broad pointed leaves around woody shoots distinguish shrubs from grass.
    // One leaf mesh and one merged stem mesh replace the three rounded blobs.
    let seed=Math.floor(hash01(object.id)*4294967295);
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const stems=[];
    for(let shoot=0;shoot<7;shoot++){
      const angle=shoot*2.399+random()*.4,radius=shoot===0?0:.12+random()*.2;
      const x=Math.cos(angle)*radius,z=Math.sin(angle)*radius,height=.55+random()*.30;
      const stem=BABYLON.MeshBuilder.CreateCylinder(`bush-stem-${object.id}-${shoot}`,{height,diameterTop:.018,diameterBottom:.035,tessellation:5},this.scene);
      stem.position.set(x,height*.5,z);stems.push(stem);
      for(let leaf=0;leaf<5;leaf++){
        const a=angle+leaf*2.4,dx=Math.cos(a),dz=Math.sin(a),sideX=-dz,sideZ=dx;
        const y=height*(.28+leaf*.13),length=.22+random()*.13,width=.06+random()*.045;
        const start=positions.length/3;
        positions.push(x,y,z,
          x+dx*length*.5+sideX*width,y+.07,z+dz*length*.5+sideZ*width,
          x+dx*length*.5,y+.105,z+dz*length*.5,
          x+dx*length*.5-sideX*width,y+.07,z+dz*length*.5-sideZ*width,
          x+dx*length,y+.17,z+dz*length);
        weights.push(0,.5,.5,.5,1);
        const faces=[0,1,2,0,2,3,1,4,2,2,4,3];
        for(let i=0;i<faces.length;i+=3){
          const a=start+faces[i],b=start+faces[i+1],c=start+faces[i+2];
          indices.push(a,b,c,c,b,a);
        }
      }
    }
    const normals=[];
    // Calculate lighting normals from front faces, then retain reverse triangles
    // for opaque two-sided leaves without changing other props' material.
    const front=[];for(let i=0;i<indices.length;i+=6)front.push(...indices.slice(i,i+3));
    BABYLON.VertexData.ComputeNormals(positions,front,normals);
    for(let i=0;i<normals.length;i+=3)if(normals[i+1]<0){normals[i]*=-1;normals[i+1]*=-1;normals[i+2]*=-1;}
    const leaves=this.mesh(root,new BABYLON.Mesh(`bush-leaves-${object.id}`,this.scene),this.materials.bush);
    const data=new BABYLON.VertexData();Object.assign(data,{positions,indices,normals});data.applyToMesh(leaves,true);
    leaves.metadata={leafSway:{rest:new Float32Array(positions),positions:new Float32Array(positions),weights,phase:random()*Math.PI*2}};
    const bounds=leaves.getBoundingInfo().boundingBox;
    leaves.setBoundingInfo(new BABYLON.BoundingInfo(bounds.minimum.subtract(new BABYLON.Vector3(.08,0,.08)),bounds.maximum.add(new BABYLON.Vector3(.08,0,.08))));
    const stemMesh=BABYLON.Mesh.MergeMeshes(stems,true,true);
    if(stemMesh)this.mesh(root,stemMesh,this.materials.trunk);
    return root;
  }

  updateBushWind(dt){
    this.bushTime+=dt;this.bushFrameTime+=dt;
    if(this.bushFrameTime<1/30)return;this.bushFrameTime=0;
    const wind=this.bushWind||{},strength=clamp(Number(wind.strength||0),0,3);
    if(strength===0&&this.bushWasCalm)return;
    this.bushWasCalm=strength===0;
    const direction=new BABYLON.Vector3(Number(wind.x||0),0,Number(wind.y||0));
    if(direction.lengthSquared()>0)direction.normalize();
    for(const entry of this.nodes.values()){
      if(entry.signature!=="BUSH")continue;
      for(const mesh of entry.model.getChildMeshes()){
        const sway=mesh.metadata?.leafSway;if(!sway)continue;
        const local=BABYLON.Vector3.TransformNormal(direction,mesh.computeWorldMatrix(true).clone().invert());
        local.y=0;if(local.lengthSquared()>0)local.normalize();
        const bend=strength*.022*(.65+.35*Math.sin(this.bushTime*1.9+sway.phase));
        for(let v=0;v<sway.weights.length;v++){
          const offset=v*3,amount=bend*sway.weights[v];
          sway.positions[offset]=sway.rest[offset]+local.x*amount;
          sway.positions[offset+2]=sway.rest[offset+2]+local.z*amount;
        }
        mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind,sway.positions,false,false);
      }
    }
  }

  createBoulder(object){
    const root=this.root(object),rock=this.mesh(root,BABYLON.MeshBuilder.CreatePolyhedron(`boulder-${object.id}`,{type:2,size:.72},this.scene),this.materials.rock),seed=hash01(object.id);
    rock.scaling.set(.95+seed*.28,.75+seed*.48,.9+(1-seed)*.32);rock.rotation.set(seed*.35,seed*Math.PI*2,(1-seed)*.22);rock.position.y=.58;return root;
  }

  createGeneric(object){
    const root=this.root(object),mesh=this.mesh(root,BABYLON.MeshBuilder.CreateBox(`prop-${object.id}`,{width:.8,height:.8,depth:.8},this.scene),this.materials.generic);mesh.position.y=.4;return root;
  }

  createObject(object){
    switch(canonicalType(object)){
      case"TREE":return this.createTree(object,false);
      case"DEAD_TREE":return this.createTree(object,true);
      case"STUMP":return this.createStump(object);
      case"LOG":return this.createLog(object);
      case"BUSH":return this.createBush(object);
      case"BOULDER":
      case"ROCK":return this.createBoulder(object);
      default:return this.createGeneric(object);
    }
  }

  createRubble(object){
    const root=this.root(object),pieces=[];
    for(let i=0;i<4;i++){
      const h=hash01(`${object.id}:chip:${i}`),a=i*2.4+h;
      const chip=this.mesh(root,BABYLON.MeshBuilder.CreatePolyhedron(`rubble-${object.id}-${i}`,{type:2,size:.11+h*.08},this.scene),this.materials.rock);
      chip.position.set(Math.cos(a)*(.2+h*.27),.07,Math.sin(a)*(.2+h*.27));
      chip.scaling.set(1,.55+h*.2,.8);chip.rotation.y=a;pieces.push(chip);
    }
    const merged=BABYLON.Mesh.MergeMeshes(pieces,true,true);if(merged){merged.parent=root;merged.isPickable=false;merged.receiveShadows=true;}
    return root;
  }

  createEntry(object){
    const node=this.root(object),model=object.type==="RUBBLE"?this.createRubble(object):this.createObject(object);
    model.parent=node;
    // Shared vertex material; retain each original part's colour for recolouring.
    for(const mesh of model.getChildMeshes()){
      mesh.metadata={...(mesh.metadata||{}),baseColor:mesh.material.diffuseColor.asArray()};
      mesh.material=this.surfaceMaterial;mesh.useVertexColors=true;mesh.receiveShadows=true;
    }
    return{node,model,signature:this.signature(object),detail:null};
  }

  groundProfile(object,tile,byKey){
    const sample=(x,z)=>this.surfaceResolver.sampleRenderedHeight(tile,byKey,x/TILE_SIZE,z/TILE_SIZE)*ELEVATION_HEIGHT;
    const h=sample(0,0),dx=(sample(.25,0)-sample(-.25,0))/.5,dz=(sample(0,.25)-sample(0,-.25))/.5;
    const neighbors=[[0,0],[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>byKey.get(tileKey(object.x+x,object.y+y))).filter(Boolean);
    const adjacentWater=neighbors.some(t=>Number(t.waterDepth||0)>0&&Math.abs(Number(t.elevation||0)-Number(tile?.elevation||0))<=1);
    return{height:h,tiltX:clamp(Math.atan(dz)*.45,-.12,.12),tiltZ:clamp(-Math.atan(dx)*.45,-.12,.12),
      wet:clamp(Math.max(Number(tile?.soilMoisture||0)/.45,Number(tile?.waterDepth||0)*2,adjacentWater?.55:0),0,1),
      forest:neighbors.some(t=>(t.dryTerrain||t.terrain)==="FOREST"),mud:tile?.terrain==="MUD",
      snow:clamp(Number(tile?.snowDepth||0)/.75,0,1),sample};
  }

  tintModel(entry,profile){
    const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*clamp(t,0,1));
    for(const mesh of entry.model.getChildMeshes()){
      mesh.computeWorldMatrix(true);
      const positions=mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind)||[],normals=mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind)||[],colors=[];
      const base=mesh.metadata.baseColor,world=mesh.getWorldMatrix();
      for(let i=0;i<positions.length;i+=3){
        const point=BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(positions[i],positions[i+1],positions[i+2]),world);
        const normal=BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(normals[i]||0,normals[i+1]||0,normals[i+2]||0),world).normalize();
        const height=point.y-entry.node.position.y,foot=clamp(1-height/.65,0,1);
        let color=mix(base,[.18,.23,.20],profile.wet*(.18+foot*.40));
        if(profile.forest)color=mix(color,[.20,.32,.12],foot*.55);
        if(profile.mud)color=mix(color,[.30,.23,.14],foot*.72);
        color=mix(color,[.87,.92,.94],profile.snow*clamp((normal.y-.15)/.55,0,1));
        colors.push(...color,1);
      }
      mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind,colors,true);
    }
  }

  updateGroundDetail(entry,object,tile,byKey,profile,floating){
    entry.detail?.dispose();entry.detail=null;
    if(floating||!tile||object.type==="RUBBLE")return;
    // One low-poly, opaque mesh per prop: soft-coloured irregular contact region
    // and embedded chips/roots. It follows terrain, never changes gameplay tiles.
    const positions=[],indices=[],colors=[],normals=[],segments=12;
    const radius=canonicalType(object)==="BOULDER"?.82:canonicalType(object)==="BUSH"?.66:.53;
    const centerColor=profile.mud?[.30,.23,.15]:profile.forest?[.22,.30,.16]:[.34,.33,.27];
    const add=(x,z,color,lift=.014)=>{positions.push(x,profile.sample(x,z)-profile.height+lift,z);colors.push(...color,1);return positions.length/3-1;};
    const center=add(0,0,centerColor),ring=[];
    for(let i=0;i<segments;i++){
      const a=i/segments*Math.PI*2,r=radius*(.78+.22*hash01(`${object.id}:edge:${i}`)),x=Math.cos(a)*r,z=Math.sin(a)*r;
      ring.push(add(x,z,this.surfaceResolver.surfaceColorAt(tile,byKey,x/TILE_SIZE,z/TILE_SIZE)));
    }
    for(let i=0;i<segments;i++)indices.push(center,ring[i],ring[(i+1)%segments]);
    // Tiny faceted roots for vegetation, chips for stone, all in the same draw call.
    const rock=canonicalType(object)==="BOULDER";
    for(let i=0;i<3;i++){
      const a=i*2.4+hash01(object.id)*6.28,r=radius*.67,x=Math.cos(a)*r,z=Math.sin(a)*r,w=rock?.11:.06;
      const color=rock?[.36,.38,.36]:[.28,.20,.12];
      const v=[add(x-w,z-w,color),add(x+w,z-w,color),add(x+w,z+w,color),add(x-w,z+w,color),add(x,z,color,rock?.13:.07)];
      for(let j=0;j<4;j++)indices.push(v[j],v[(j+1)%4],v[4]);
    }
    BABYLON.VertexData.ComputeNormals(positions,indices,normals);
    const mesh=new BABYLON.Mesh(`ground-contact-${object.id}`,this.scene),data=new BABYLON.VertexData();
    Object.assign(data,{positions,indices,colors,normals});data.applyToMesh(mesh);this.mesh(entry.node,mesh,this.surfaceMaterial);
    mesh.useVertexColors=true;mesh.metadata={castShadow:false};entry.detail=mesh;
  }

  place(entry,object,tile,byKey){
    const profile=this.groundProfile(object,tile,byKey),type=canonicalType(object);
    const floating=object.floatOnWater===true&&Number(tile?.waterDepth||0)>0&&tile?.waterSurfaceZ!=null;
    const model=entry.model,seed=hash01(`${object.id}:pose`);
    entry.node.position.set(Number(object.x||0)*TILE_SIZE,floating?objectY(tile,object):profile.height,Number(object.y||0)*TILE_SIZE);
    model.position.set(0,0,0);model.rotation.set(floating?0:profile.tiltX,seed*Math.PI*2,floating?0:profile.tiltZ);
    model.scaling.setAll(.90+hash01(`${object.id}:scale`)*.18);
    const bounds=model.getHierarchyBoundingVectors(true),height=bounds.max.y-bounds.min.y;
    const sink=type==="BOULDER"?.10+seed*.08:type==="RUBBLE"?.08:type==="BUSH"?.09:.025;
    model.position.y=entry.node.position.y-bounds.min.y-height*(floating?.32:sink+(profile.mud?.025:0));
    entry.node.metadata={...entry.node.metadata,sinkRatio:sink,floating,groundHeight:profile.height};
    this.tintModel(entry,profile);this.updateGroundDetail(entry,object,tile,byKey,profile,floating);
    this.setNodeVisibility(entry.node,tile?.fogged?.24:1);
  }

  // Geometry only: movement, weather and durability do not rebuild the body.
  signature(object){return canonicalType(object);}
  visualSignature(object,byKey){
    const neighborhood=[];
    for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
      const tile=byKey.get(tileKey(object.x+x,object.y+y));
      neighborhood.push(tile?[tile.terrain,tile.dryTerrain,tile.material,tile.elevation,tile.waterSurfaceZ,tile.waterDepth,tile.soilMoisture,tile.snowDepth,tile.debrisMass,tile.fogged?1:0].join(":"):"-");
    }
    return[object.id,this.signature(object),object.x,object.y,object.floatOnWater?1:0,...neighborhood].join("|");
  }

  sync(state){
    this.bushWind=state?.presentation?.environment?.wind||null;
    const tiles=state?.map?.tiles||[],byKey=new Map(tiles.map(tile=>[tileKey(tile.x,tile.y),tile]));
    const objects=(state?.map?.objects||[]).filter(object=>!object.destroyed&&object.type!=="CORE");
    // Existing debrisMass is the source of truth. These are presentation records,
    // never inserted into map.objects, so debris cannot acquire collision rules.
    for(const tile of tiles)if(Number(tile.debrisMass||0)>.02)objects.push({id:`visual-debris:${tile.x},${tile.y}`,type:"RUBBLE",x:tile.x,y:tile.y});
    const alive=new Set();
    for(const object of objects){
      const key=`OBJECT:${object.id}`,signature=this.signature(object);alive.add(key);
      let entry=this.nodes.get(key);
      if(!entry||entry.signature!==signature){entry?.node?.dispose();entry=this.createEntry(object);this.nodes.set(key,entry);}
      const visualSignature=this.visualSignature(object,byKey);
      if(entry.visualSignature===visualSignature)continue;
      this.place(entry,object,byKey.get(tileKey(object.x,object.y)),byKey);entry.visualSignature=visualSignature;
    }
    for(const[key,entry]of this.nodes){if(alive.has(key))continue;entry.node.dispose();this.nodes.delete(key);}
  }

  diagnostics(){
    const byType={};for(const entry of this.nodes.values()){const type=entry.node.metadata?.objectType||"UNKNOWN";byType[type]=(byType[type]||0)+1;}
    return{total:this.nodes.size,byType,sharedSurfaceSampling:true,perObjectVisualCache:true,durabilityRebuild:false};
  }
}
