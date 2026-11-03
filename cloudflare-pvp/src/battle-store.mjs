/**
 * Cloudflare Durable Object storage adapter for the canonical PvP GameCore.
 *
 * This module is intentionally not connected to worker.mjs until the real
 * shared GameCore can run without DOM/window and server-side replay tests pass.
 * It never accepts the battle state from browser commands.
 */
import {createAuthoritySession,commitAuthorityCommand,projectAuthoritySession}
  from './battle-authority.mjs';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';

export const BATTLE_STORAGE_KEY = 'authoritative-battle-session';

export class DurableBattleStore {
  constructor(storage, core) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.transaction !== 'function') {
      throw new PvpCommandError('DURABLE_STORAGE_REQUIRED');
    }
    this.storage=storage;
    this.core=core;
  }

  async initialize(initialState) {
    return this.storage.transaction(async txn=>{
      if (await txn.get(BATTLE_STORAGE_KEY)) throw new PvpCommandError('BATTLE_ALREADY_INITIALIZED');
      const session=createAuthoritySession({initialState,core:this.core});
      await txn.put(BATTLE_STORAGE_KEY,session);
      return {revision:session.revision};
    });
  }

  async submit({seat,envelope}) {
    return this.storage.transaction(async txn=>{
      const session=await txn.get(BATTLE_STORAGE_KEY);
      if (!session) throw new PvpCommandError('BATTLE_NOT_INITIALIZED');
      const result=commitAuthorityCommand({session,seat,envelope,core:this.core});
      if (!result.duplicate) await txn.put(BATTLE_STORAGE_KEY,result.nextSession);
      return {ack:result.ack,duplicate:result.duplicate,
        snapshot:projectAuthoritySession(result.nextSession,seat,this.core)};
    });
  }

  async snapshot(seat) {
    const session=await this.storage.get(BATTLE_STORAGE_KEY);
    if (!session) throw new PvpCommandError('BATTLE_NOT_INITIALIZED');
    return projectAuthoritySession(session,seat,this.core);
  }
}
