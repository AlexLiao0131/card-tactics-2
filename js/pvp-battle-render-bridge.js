/**
 * Browser-only adapter: render a seat-filtered, server-authoritative battle snapshot
 * using the SAME BabylonRenderer as single-player. It owns no rule calculations.
 *
 * The Cloudflare Worker must supply a server-created snapshot separately from
 * its player-secret view. Never generate it from client state or credentials.
 * The public multiplayer page only ACTIVATES it for explicitly enabled
 * internal test sessions; normal lobby users never create a WebGL renderer.
 */
export class PvpBattleRenderBridge {
  constructor({canvas,seat,onTilePicked=()=>{},createRenderer}={}){
    if(!canvas||![0,1].includes(seat)||typeof createRenderer!=='function')
      throw new TypeError('PVP_RENDER_BRIDGE_CONFIGURATION_REQUIRED');
    this.canvas=canvas;
    this.seat=seat;
    this.onTilePicked=onTilePicked;
    this.createRenderer=createRenderer;
    this.renderer=null;
    this.revision=-1;
    this.matchId=null;
    this.closed=false;
    this.activatedParent=false;
  }
  /** Caller MUST supply packets only from its authenticated server socket. */
  accept({matchId,seat,revision,snapshot}={}){
    if(this.closed)throw Error('PVP_RENDER_BRIDGE_CLOSED');
    if(seat!==this.seat||typeof matchId!=='string'||!matchId||
       !Number.isSafeInteger(revision)||revision<0)
      throw Error('PVP_RENDER_ENVELOPE_INVALID');
    if(!snapshot||typeof snapshot!=='object'||
       snapshot.revision!==revision||!snapshot.map||
       !Array.isArray(snapshot.map.tiles)||!Array.isArray(snapshot.units)||
       !Array.isArray(snapshot.cores)||!snapshot.presentation)
      throw Error('PVP_RENDER_SNAPSHOT_INVALID');
    if(this.matchId!==null&&this.matchId!==matchId)
      throw Error('PVP_RENDER_MATCH_MISMATCH');
    if(revision<=this.revision)return false; // WebSocket retries/reordering
    // Only the canonical renderer is allowed to create/update 3D meshes.
    if(!this.renderer){
      // The official BabylonRenderer intentionally pauses off-screen. Its
      // render clock requires the canvas immediate parent to be active.
      const parent=this.canvas.parentElement;
      if(!parent?.classList)throw Error('PVP_BATTLE_VIEW_REQUIRED');
      if(!parent.classList.contains('active')){
        parent.classList.add('active');
        this.activatedParent=true;
      }
      const renderer=this.createRenderer(this.canvas,snapshot,{
        onTilePicked:(x,y)=>this.onTilePicked({matchId,seat:this.seat,x,y})
      });
      if(!renderer||typeof renderer.sync!=='function')
        throw Error('OFFICIAL_BABYLON_RENDERER_REQUIRED');
      this.renderer=renderer;
    }
    this.renderer.sync(snapshot);
    this.matchId=matchId;
    this.revision=revision;
    return true;
  }
  close(){
    if(this.closed)return;
    this.closed=true;
    // The official renderer disposes its own WebGL resources and resize hook.
    // Test fakes without dispose() still receive the same lifecycle calls.
    if(this.renderer?.dispose)this.renderer.dispose();
    else{
      this.renderer?.engine?.stopRenderLoop?.();
      this.renderer?.scene?.dispose?.();
      this.renderer?.engine?.dispose?.();
    }
    this.renderer=null;
    if(this.activatedParent){
      this.canvas.parentElement?.classList.remove('active');
      this.activatedParent=false;
    }
  }
}
/** Browser bootstrap. import() is intentionally deferred until the canvas is mounted. */
export async function createOfficialPvpRenderBridge({canvas,seat,onTilePicked}={}){
  if(typeof globalThis.BABYLON?.Engine!=='function')
    throw Error('BABYLON_RUNTIME_NOT_LOADED');
  const {BabylonRenderer}=await import('./babylon-renderer.js');
  return new PvpBattleRenderBridge({canvas,seat,onTilePicked,
    createRenderer:(surface,snapshot,options)=>new BabylonRenderer(surface,snapshot,options)});
}
