/**
 * One presentation surface for the original Card Tactics battle scene.
 *
 * The native ShellUI decides when battleScreen is active. The online client
 * receives only authenticated, seat-filtered official snapshots. This bridge
 * neither creates a different battle page nor applies any game rules.
 *
 * The existing BabylonRenderer remains owned by the game boot manager when
 * ownsRenderer=false, so a disconnected room cannot destroy offline WebGL.
 */
export class PvpBattleRenderBridge {
  constructor({canvas,seat,onTilePicked=()=>{},createRenderer,ownsRenderer=false}={}){
    if(!canvas||![0,1].includes(seat)||typeof createRenderer!=='function')
      throw new TypeError('PVP_RENDER_BRIDGE_CONFIGURATION_REQUIRED');
    this.canvas=canvas;
    this.seat=seat;
    this.onTilePicked=onTilePicked;
    this.createRenderer=createRenderer;
    this.ownsRenderer=ownsRenderer;
    this.renderer=null;
    this.revision=-1;
    this.matchId=null;
    this.closed=false;
    this.seenPresentationEvents=new Set();
  }
  /** A frame is a WebSocket-authorized envelope, not untrusted local state. */
  accept({matchId,seat,revision,snapshot,presentationEvents=[]}={}){
    if(this.closed)throw Error('PVP_RENDER_BRIDGE_CLOSED');
    if(seat!==this.seat||typeof matchId!=='string'||!matchId||
       !Number.isSafeInteger(revision)||revision<0)
      throw Error('PVP_RENDER_ENVELOPE_INVALID');
    if(!snapshot||typeof snapshot!=='object'||snapshot.revision!==revision||
       !snapshot.map||!Array.isArray(snapshot.map.tiles)||
       !Array.isArray(snapshot.units)||!Array.isArray(snapshot.cores)||
       !snapshot.presentation)
      throw Error('PVP_RENDER_SNAPSHOT_INVALID');
    if(this.matchId!==null&&this.matchId!==matchId)
      throw Error('PVP_RENDER_MATCH_MISMATCH');
    if(revision<=this.revision)return false;

    // Only ShellUI may activate the game scene. A delayed WebSocket packet
    // cannot show the battle while the player is in the lobby or local match.
    if(!this.canvas.parentElement?.classList?.contains('active'))
      throw Error('NATIVE_PVP_SCREEN_NOT_ACTIVE');

    if(!this.renderer){
      const renderer=this.createRenderer(this.canvas,snapshot,{
        onTilePicked:(x,y)=>this.onTilePicked({matchId,seat:this.seat,x,y})
      });
      if(!renderer||typeof renderer.sync!=='function')
        throw Error('OFFICIAL_BABYLON_RENDERER_REQUIRED');
      this.renderer=renderer;
    }
    // Feed events through the ORIGINAL native BabylonRenderer.sync(), BEFORE
    // its UnitRenderer commits death/removal. A later UI-only enqueue loses
    // the deceased figure and cannot show the official death animation.
    if(!Array.isArray(presentationEvents))throw Error('PVP_PRESENTATION_EVENTS_INVALID');
    const fresh=[];
    for(const [index,event] of presentationEvents.entries()){
      if(!event||!['UNIT_ANIMATION','UNIT_FLOAT_TEXT'].includes(event.type))continue;
      const key=`${revision}:${event.sequence??index}`;
      if(this.seenPresentationEvents.has(key))continue;
      this.seenPresentationEvents.add(key);
      fresh.push(event);
    }
    // A render retry must not replay an already-enqueued hit/attack animation.
    // The bounded set covers only recent revisions of this one match.
    if(this.seenPresentationEvents.size>1024){
      const old=[...this.seenPresentationEvents].slice(0,this.seenPresentationEvents.size-512);
      for(const key of old)this.seenPresentationEvents.delete(key);
    }
    this.renderer.sync(snapshot,fresh);
    // The original renderer reports complete/incomplete subsystem commits.
    // An incomplete terrain, water or unit pass may not acknowledge a remote
    // revision: keep the same frame eligible for a real retry.
    const committed=this.renderer.presentationCommitHistory?.at(-1);
    if(committed?.revision===revision&&committed.complete===false)
      throw Error(`PVP_RENDER_INCOMPLETE:${(committed.failedStages||[]).join(',')}`);
    this.renderer.unitHud?.presentEvents?.(fresh);
    this.matchId=matchId;
    this.revision=revision;
    return true;
  }
  close(){
    if(this.closed)return;
    this.closed=true;
    if(this.ownsRenderer){
      if(this.renderer?.dispose)this.renderer.dispose();
      else{
        this.renderer?.engine?.stopRenderLoop?.();
        this.renderer?.scene?.dispose?.();
        this.renderer?.engine?.dispose?.();
      }
    }
    this.renderer=null;
    this.seenPresentationEvents.clear();
    // Screen active classes are never changed here; ShellUI alone owns them.
  }
}
