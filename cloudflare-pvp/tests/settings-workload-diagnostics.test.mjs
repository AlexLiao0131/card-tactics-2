import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../js/diagnostics.js',import.meta.url),'utf8');
function setup(enabled=true){
  let clock=100;
  const data=new Map([['ct:diagnostics',enabled?'1':'0']]);
  const win={addEventListener(){}};
  const document={readyState:'loading',visibilityState:'visible',addEventListener(){},querySelectorAll(){return[]}};
  const sandbox={window:win,document,performance:{now:()=>clock},navigator:{userAgent:'test'},localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},requestAnimationFrame(){},setInterval(){},setTimeout(){}};
  vm.runInNewContext(source,sandbox);
  const api=win.CardTacticsDiagnostics;
  return {api,data,setClock:v=>clock=v,report:()=>JSON.parse(api.report().split('\n').slice(1).join('\n'))};
}
test('actual frame totals not frame peaks, cumulative timings survive rolling window reset',()=>{
  const {api,report}=setup();
  api.recordFrameWindow({start:100,wallMs:5000,count:250,frameTotal:1250,renderTotal:750,shadowTotal:250});
  for(let i=0;i<130;i++)api.recordPerf('renderSync.water',2);
  api.recordPerf('frame.cpuElapsed',1000);
  const w=report().workload;
  assert.equal(w.frames.count,250);assert.equal(w.frames.meanFrameCpuMs,5);assert.equal(w.frames.frameCpuMs,1250);
  assert.equal(w.timings['renderSync.water'].calls,130);assert.equal(w.timings['renderSync.water'].totalMs,260);assert.equal(w.timings['frame.cpuElapsed'],undefined);
});
test('terrain and water update counters retain real deltas, not prior water updates',()=>{
  const {api,report}=setup();
  api.recordGeometryCommit({surfaceBuilds:1,cliffBuilds:1},{built:2,attributesUpdated:1,verticesUpdated:3,estimatedUploadBytes:1024,polygonDirtyTiles:8});
  api.recordGeometryCommit({surfaceBuilds:0,cliffBuilds:0},null);
  const g=report().workload.geometry;
  assert.equal(g.commits,2);assert.equal(g.surfaceBuilds,1);assert.equal(g.cliffBuilds,1);assert.equal(g.waterUpdates,1);assert.equal(g.waterUploadBytesEstimated,1024);
});
test('clear resets totals and discards frame window crossing the reset',()=>{
  const {api,report,setClock}=setup();
  api.recordHydrologyWork(9,4,3);setClock(200);api.clear();
  api.recordFrameWindow({start:100,wallMs:5000,count:10,frameTotal:500,renderTotal:100,shadowTotal:100});
  api.recordFrameWindow({start:200,wallMs:5000,count:10,frameTotal:200,renderTotal:100,shadowTotal:100});
  assert.equal(report().workload.hydrology.calls,0);assert.equal(report().workload.frames.frameCpuMs,200);
});
test('disabled preference prevents new workload collection',()=>{
  const {api,report}=setup(false);
  api.recordHydrologyWork(10,5,2);api.recordGeometryCommit({surfaceBuilds:1},null);api.recordPerf('renderSync.water',99);api.recordFrameWindow({start:100,wallMs:5000,count:100,frameTotal:500,renderTotal:200,shadowTotal:100});
  const w=report().workload;assert.equal(w.hydrology.calls,0);assert.equal(w.geometry.commits,0);assert.equal(w.frames.count,0);assert.deepEqual(w.timings,{});
});
test('hydrology accumulates completed local solver work and persists it in existing record',()=>{
  const {api,report,data}=setup();
  api.recordHydrologyWork(10,2,8);api.recordHydrologyWork(12,1,4);
  const h=report().workload.hydrology;assert.deepEqual(h,{calls:2,iterations:3,changedTiles:12,elapsedMs:22});
  assert.ok(JSON.parse(data.get('ct:diagnostics:session:v1')).workload);
});
