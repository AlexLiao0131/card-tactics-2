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
        smokeFields:game.fieldState?.smokeFields||[],inspectedTile:null,pendingCard:null}),
      unitAt:(x,y)=>game.units.find(u=>u?.alive&&u.x===x&&u.y===y)||null,
      coreAt:(x,y)=>cores.find(c=>c.hp>0&&c.x===x&&c.y===y)||null
    };
    const snapshot=globalThis.BattlePresentationController.create(context).battleSnapshot();
    // Never allow presentation to publish an enemy secret card zone. The
    // official snapshot includes only enemy hand/deck COUNTS.
    if(snapshot?.presentation?.enemyHandCount!==game.cards[1-seat].zones.hand.length)
      throw new PvpCommandError('PRESENTATION_PRIVACY_FAILURE');
    const record=game.lastPresentation;
    if(record?.revision===revision&&Array.isArray(record.events)){
      const visible=new Set(snapshot.units.map(u=>u.id));
      const previous=new Set(record.visibleBefore?.[seat]||[]);
      const safe=[];
      for(const event of record.events){
        if(!event||!previous.has(event.unitId))continue;
        // Never reproduce actions first discovered after they happened.
        if(event.type==='UNIT_ANIMATION'&&event.state!=='DEATH'&&!visible.has(event.unitId))continue;
        const copy={...event};
        if(copy.targetId&&!previous.has(copy.targetId)){
          delete copy.targetId;delete copy.targetX;delete copy.targetY;
        }
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
    return snapshot;
  });
}
