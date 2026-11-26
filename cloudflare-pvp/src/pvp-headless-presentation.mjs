/**
 * Read-only, seat-filtered official BabylonRenderer snapshot for PvP.
 * Existing BattlePresentationController alone owns visibility, lighting,
 * atmospheric masking and scene geometry. It does not run an alternative
 * renderer or accept client-provided unit positions.
 */
import '../../js/battle-presentation-controller.js';
import {StageDatabase} from '../../js/stage-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {withCanonicalEngines} from './pvp-engine-context.mjs';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';
import {canonicalWorldForViewer} from './pvp-perception-controller.mjs';
// Autonomous mass flows have no unit identity. Use the same physical LOS
// rule as the existing enemy movement paths, and expose only terrain facts.
export function projectMassFlowPresentation(event,map,units,viewer,environmentState,previousVisible=new Set()){
  if(!event||!['MASS_FLOW','MASS_FLOW_WARNING'].includes(event.type))return null;
  const path=event.path;
  if(!Array.isArray(path)||path.length<2||!path.every(p=>p&&Number.isSafeInteger(p.x)&&Number.isSafeInteger(p.y)&&TacticalEngine.tile(map,p.x,p.y)&&TacticalEngine.teamCanSee(map,units,viewer,p,environmentState)))return null;
  const contacts=(Array.isArray(event.contacts)?event.contacts:[]).filter(c=>c&&previousVisible.has(c.unitId)&&path.some(p=>p.x===c.x&&p.y===c.y)).map(c=>({x:c.x,y:c.y}));
  return {type:event.type,sequence:event.sequence,material:event.material,x:path[0].x,y:path[0].y,mass:event.mass,contacts,
    path:path.map(p=>({x:p.x,y:p.y,elevation:p.elevation,elevationBefore:p.elevationBefore,elevationAfter:p.elevationAfter,snowDepthBefore:p.snowDepthBefore,snowDepthAfter:p.snowDepthAfter,erosion:p.erosion,deposit:p.deposit}))};
}
export function projectCanonicalRendererSnapshot(game,seat,revision=0){
  if(seat!==0&&seat!==1)throw new PvpCommandError('BAD_SEAT');
  if(!game?.battlefield?.map||!Array.isArray(game.units))
    throw new PvpCommandError('CANONICAL_WORLD_REQUIRED');
  // Build the existing official presentation against the correct world for
  // this seat; never expose a fake enemy to the unpolluted opponent.
  game=canonicalWorldForViewer(game,seat);
  return withCanonicalEngines(game,engine=>{
    engine.unitRuntime.syncLiveRoster(game.units);
    const stage=StageDatabase.get(game.stageId);
    stage.cores=game.battlefield.cores;
    stage.deploymentPoints=game.battlefield.deploymentPoints;
    const map=game.battlefield.map,cores=game.battlefield.cores;
    const context={
      TEAM:{PLAYER:'P',ENEMY:'E',NEUTRAL:'N'},
      PHASE:{PLAYER:seat===0?'PLAYER_TACTICAL_PHASE':'ENEMY_TACTICAL_PHASE',
        CARD:seat===0?'PLAYER_CARD_PHASE':'ENEMY_CARD_PHASE'},
      viewerTeam:seat===0?'P':'E',
      state:()=>({map,cores,stage,environmentState:game.environmentState,
        units:game.units,round:game.round,phase:game.phase,
        cardState:game.cards[seat],enemyCardState:game.cards[1-seat],
        selected:null,selectedSkill:null,mode:'idle',renderRevision:revision,
        fieldState:game.fieldState,smokeFields:game.fieldState?.smokeFields||[],inspectedTile:null,pendingCard:null}),
      unitAt:(x,y)=>game.units.find(u=>u?.alive&&u.x===x&&u.y===y)||null,
      coreAt:(x,y)=>cores.find(c=>c.hp>0&&c.x===x&&c.y===y)||null
    };
    const snapshot=globalThis.BattlePresentationController.create(context).battleSnapshot();
    const viewer=seat===0?'P':'E';
    // Forest-soul availability is a dynamic gameplay fact. Never expose a
    // hidden opposing Ophi's harvest by revealing resource depletion on a
    // source plant outside this seat's current battlefield vision.
    for(const object of snapshot.map.objects||[]){
      if(!object.ophiForestSoul)continue;
      if(!TacticalEngine.teamCanSee(map,game.units,viewer,
          {x:object.x,y:object.y},game.environmentState))delete object.ophiForestSoul;
    }
    // Never allow presentation to publish an enemy secret card zone. The
    // official snapshot includes only enemy hand/deck COUNTS.
    if(snapshot?.presentation?.enemyHandCount!==game.cards[1-seat].zones.hand.length)
      throw new PvpCommandError('PRESENTATION_PRIVACY_FAILURE');
    const record=game.lastPresentation;
    // Always publish a seat-scoped event contract, including no-event turns.
    // The count below is taken AFTER visibility filtering; no hidden combat
    // event counts or identities leak into the opposing seat's snapshot.
    snapshot.presentation.battleEvents=[];
    snapshot.presentation.battleEventStream='CT2_BATTLE_EVENTS_V1';
    snapshot.presentation.battleEventRevision=revision;
    if(record?.revision===revision&&Array.isArray(record.events)){
      const visible=new Set(snapshot.units.map(u=>u.id));
      const previous=new Set(record.visibleBefore?.[seat]||[]);
      const safe=[];
      for(const event of record.events){
        if(!event)continue;
        // Mass flows are autonomous environmental events, not hidden unit actions.
        // Send only entirely visible paths, whitelisting terrain-only properties.
        if(event.type==='MASS_FLOW'||event.type==='MASS_FLOW_WARNING'){
          const projected=projectMassFlowPresentation(event,map,game.units,viewer,game.environmentState,previous);
          if(projected)safe.push(projected);
          continue;
        }
        if(!previous.has(event.unitId))continue;
        if(event.type==='OPHI_FOREST_SOUL_COLLECT'&&
           !TacticalEngine.teamCanSee(map,game.units,viewer,
             {x:event.x,y:event.y},game.environmentState))continue;
        // Never reproduce actions first discovered after they happened.
        if(event.type==='UNIT_ANIMATION'&&event.state!=='DEATH'&&!visible.has(event.unitId))continue;
        const copy={...event};
        if(copy.targetId&&!previous.has(copy.targetId)){
          delete copy.targetId;delete copy.targetX;delete copy.targetY;
        }
        // BloodBurst carries several independent blast coordinates. A plain
        // copy of this nested field would leak fog-hidden enemy positions.
        // Reuse the authoritative BEFORE-action identification set, as above.
        if(Array.isArray(copy.burstCenters))
          copy.burstCenters=copy.burstCenters
            .filter(center=>center&&previous.has(center.unitId)&&
              Number.isSafeInteger(center.x)&&Number.isSafeInteger(center.y))
            .map(center=>({x:center.x,y:center.y,serverVisibleBefore:true}));
        if(copy.path&&copy.team!==(seat===0?'P':'E')){
          // All waypoints must be in the public scene. Otherwise, do not
          // expose an enemy's intervening route behind fog and terrain.
          if(!copy.path.every(point=>TacticalEngine.teamCanSee(map,game.units,
              seat===0?'P':'E',point,game.environmentState)))continue;
        }
        safe.push(copy);
      }
      snapshot.presentation.battleEvents=safe;
    }
    snapshot.presentation.battleEventCount=snapshot.presentation.battleEvents.length;
    return snapshot;
  });
}
