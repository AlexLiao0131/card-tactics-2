import test from 'node:test';
import assert from 'node:assert/strict';
import {WaterRenderer} from '../../js/water-renderer.js';

// Deterministic Babylon geometry contract without external CDN or GPU.
// Does not pretend to be a mobile Safari / GPU visual acceptance test.
class Pose { constructor(){this.x=0;this.y=0;this.z=0;} set(x,y,z){this.x=x;this.y=y;this.z=z;} }
class FakeNode {
  constructor(name,scene){this.name=name;this.scene=scene;this.position=new Pose();this.scaling={x:1,y:1,z:1,set(x,y,z){Object.assign(this,{x,y,z});}};this.enabled=true;}
  setEnabled(value){this.enabled=!!value}
  dispose(){this.disposed=true}
}
class FakeMesh extends FakeNode {}
class FakeVertexData {
  applyToMesh(mesh){mesh.geometry={positions:this.positions,uvs:this.uvs,indices:this.indices,normals:this.normals}}
  static ComputeNormals(positions,indices,normals){for(let i=0;i<positions.length;i++)normals.push(i%3===1?1:0)}
}
globalThis.BABYLON={TransformNode:FakeNode,Mesh:FakeMesh,VertexData:FakeVertexData,
  MeshBuilder:{CreateTube:(name,options,scene)=>{const mesh=new FakeMesh(name,scene);mesh.options=options;return mesh;},
    CreateSphere:(name,options,scene)=>{const mesh=new FakeMesh(name,scene);mesh.metadata={};return mesh;}},
  Vector3:class {constructor(x,y,z){Object.assign(this,{x,y,z})}}
};

test('tsunami authored once as a lightweight forward-curled wave mesh, separate from water meshes',()=>{
 const root=new FakeNode('parent',{}),seen=[];
 const fake={scene:{},tsunamiWallMaterial:{id:'waterwall'},rogueFoamMaterial:{id:'spray'}};
 const wave={token:'unit-test',dx:1,dz:0,maxPerp:4,minPerp:-4,amplitude:1,tsunami:true};
 const node=WaterRenderer.prototype.createTsunamiWallVisual.call(fake,wave,root);
 assert.equal(node.parent,root);
 assert.equal(node.enabled,false);
 assert.equal(node.name,'tsunami-wall-unit-test');
 assert.ok(node.metadata===undefined);
 assert.ok(!('hydrology' in fake));
});

test('timed tsunami wave body is presented without touching hydrology and can be disabled',()=>{
 const fake={scene:{},tsunamiWallMaterial:{id:'waterwall'},rogueFoamMaterial:{id:'spray'}};
 fake.createTsunamiWallVisual=wave=>WaterRenderer.prototype.createTsunamiWallVisual.call(fake,wave,new FakeNode('parent',{}));
 const wave={token:'wave-1',cells:[{x:0,z:0,along:0,perp:0,surfaceY:0,key:'0,0'}],dx:1,dz:0,minPerp:-1,maxPerp:1,amplitude:.5,startedAt:0,duration:1,phase:0,startAlong:0,endAlong:3,surfaceY:0,tsunami:true};
 const visual=WaterRenderer.prototype.createRogueWaveVisual.call(fake,wave);
 assert.ok(visual.wall);
 assert.ok(visual.spray.length>0);
 wave.visual=visual;
 assert.doesNotThrow(()=>WaterRenderer.prototype.updateRogueWaveVisual.call(fake,wave,.6));
 assert.equal(visual.wall.enabled,true);
 assert.equal(visual.wall.position.x>0,true);
 assert.doesNotThrow(()=>WaterRenderer.prototype.updateRogueWaveVisual.call(fake,wave,1));
 assert.equal(visual.wall.enabled,false);
});
