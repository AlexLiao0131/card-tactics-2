/**
 * Presentation-only engagement gate for LOCAL/Gemini. It synchronizes the
 * existing official BattleResolution with the Babylon scene clock:
 * close confirmation UI -> draw the unobstructed battlefield -> commit once
 * -> drain the official character/VFX queues -> allow the turn to advance.
 *
 * No timers, invented skill delays, parallel combat rules, or state snapshots.
 * BattleResolution is still authoritative and is called exactly once.
 */
export function createBattleEngagementPlayback({afterFrame,hasPendingVisuals}={}){
  if(typeof afterFrame!=='function'||typeof hasPendingVisuals!=='function')
    throw Error('ENGAGEMENT_PLAYBACK_CALLBACKS_REQUIRED');
  let active=null,serial=0;
  const isActive=()=>active!==null;
  const state=()=>active?.stage||null;
  function cancel(){active=null;}
  function begin({participants=[],close,commit,complete,failed}={}){
    if(active||!Array.isArray(participants)||
       ![close,commit,complete].every(fn=>typeof fn==='function'))return false;
    const ticket={id:++serial,stage:'CLOSING',participants:new Set(participants.map(String))};
    active=ticket;
    const fail=error=>{
      if(active!==ticket)return;
      active=null;
      if(typeof failed==='function')failed(error);
      else throw error;
    };
    const finish=success=>{
      if(active!==ticket)return;
      active=null;
      complete(success);
    };
    const schedule=cb=>{
      try{afterFrame(cb)}catch(error){fail(error);}
    };
    const observe=()=>{
      if(active!==ticket)return;
      try{
        if(hasPendingVisuals(ticket.participants))schedule(observe);
        else finish(true);
      }catch(error){fail(error)}
    };
    try{close()}catch(error){fail(error);return false;}
    // This callback runs AFTER a real battlefield frame was rendered with the
    // engagement modal already removed (not a guessed millisecond timeout).
    schedule(()=>{
      if(active!==ticket)return;
      try{
        ticket.stage='COMMITTING';
        if(commit()===false){finish(false);return;}
        ticket.stage='PLAYING';
        // Wait for one post-commit scene frame before inspecting live Babylon
        // queues, which receive combat events during presentationFrameSync.
        schedule(observe);
      }catch(error){fail(error)}
    });
    return true;
  }
  return Object.freeze({begin,cancel,isActive,state});
}
