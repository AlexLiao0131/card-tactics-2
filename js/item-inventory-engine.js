export const ItemInventoryEngine=(()=>{
  const STORAGE_KEY="cardtactics.itemInventory.v1";
  let battleQueues=new Map(),groundItems=[],groundSerial=0;
  const clone=value=>JSON.parse(JSON.stringify(value));

  function defaults(){return{gold:Number(globalThis.ItemDatabase?.RULES?.startingGold||0),stash:{},preparations:{}}}
  function load(){
    try{
      const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
      return parsed&&typeof parsed==="object"?{...defaults(),...parsed,stash:{...(parsed.stash||{})},preparations:{...(parsed.preparations||{})}}:defaults();
    }catch{return defaults()}
  }
  function save(state){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));return state}
  function state(){return load()}
  function gold(){return Math.max(0,Math.floor(Number(state().gold||0)))}
  function addGold(amount){const s=state();s.gold=Math.max(0,Math.floor(Number(s.gold||0)+Number(amount||0)));save(s);return s.gold}
  function spendGold(amount){const n=Math.max(0,Math.floor(Number(amount||0))),s=state();if(Number(s.gold||0)<n)return false;s.gold-=n;save(s);return true}
  function stashCount(itemId){return Math.max(0,Math.floor(Number(state().stash?.[itemId]||0)))}
  function stash(){return{...state().stash}}
  function grant(itemId,count=1){if(!ItemDatabase.get(itemId))return 0;const n=Math.max(0,Math.floor(Number(count||0))),s=state();s.stash[itemId]=Math.max(0,Math.floor(Number(s.stash[itemId]||0)))+n;save(s);return s.stash[itemId]}
  function consumeOwned(itemId,count=1){
    const n=Math.max(0,Math.floor(Number(count||0))),s=state(),have=Math.max(0,Math.floor(Number(s.stash[itemId]||0)));if(have<n)return false;
    s.stash[itemId]=have-n;if(s.stash[itemId]<=0)delete s.stash[itemId];trimAssignmentsInState(s,itemId);save(s);return true;
  }
  function buy(itemId,count=1){
    const item=ItemDatabase.get(itemId),price=ItemDatabase.price(itemId),n=Math.max(1,Math.floor(Number(count||1)));if(!item||price==null)return{ok:false,reason:"ITEM_NOT_FOR_SALE"};
    const total=price*n;if(!spendGold(total))return{ok:false,reason:"NOT_ENOUGH_GOLD",gold:gold(),price:total};grant(itemId,n);return{ok:true,item,count:n,total,gold:gold(),stash:stashCount(itemId)};
  }

  function deckEntries(deck=[]){
    const seen=new Map(),out=[];
    for(const [deckIndex,cardId] of (deck||[]).entries()){
      const card=CardDatabase.get(cardId);if(!CardDatabase.isCharacter(card))continue;
      const occurrence=(seen.get(cardId)||0)+1;seen.set(cardId,occurrence);
      out.push({key:`${cardId}#${occurrence}`,cardId,occurrence,deckIndex,card});
    }
    return out;
  }
  function slotCountForCard(card){
    const character=globalThis.LoadoutDatabase?.resolveCharacter?.(card?.characterId,card?.loadoutId)||globalThis.CharacterDatabase?.get?.(card?.characterId)||null;
    return Math.max(0,Math.floor(Number(character?.inventorySlots??ItemDatabase.RULES.defaultBattleSlots??3)));
  }
  function syncPreparationsForDeck(deck=[]){
    const valid=new Set(deckEntries(deck).map(entry=>entry.key)),s=state();
    for(const key of Object.keys(s.preparations||{}))if(!valid.has(key))delete s.preparations[key];
    save(s);return [...valid];
  }
  function preparation(key,slots=ItemDatabase.RULES.defaultBattleSlots){
    const s=state(),saved=s.preparations?.[key],arr=Array.isArray(saved?.slots)?saved.slots.slice(0,slots):[];while(arr.length<slots)arr.push(null);return{key,slots:arr};
  }
  function assignedCountInState(s,itemId,excludeKey=null,excludeSlot=-1){
    let count=0;
    for(const [key,prep] of Object.entries(s.preparations||{}))for(const [i,id] of (prep?.slots||[]).entries())if(id===itemId&&!(key===excludeKey&&i===excludeSlot))count++;
    return count;
  }
  function assignedCount(itemId){return assignedCountInState(state(),itemId)}
  function availableCount(itemId,{excludeKey=null,excludeSlot=-1}={}){const s=state();return Math.max(0,Math.floor(Number(s.stash[itemId]||0))-assignedCountInState(s,itemId,excludeKey,excludeSlot))}
  function equip(key,slot,itemId,slotCount=ItemDatabase.RULES.defaultBattleSlots){
    if(!ItemDatabase.get(itemId))return false;slot=Math.floor(Number(slot));if(slot<0||slot>=slotCount)return false;
    const s=state(),current=preparationFromState(s,key,slotCount),old=current.slots[slot];if(old===itemId)return true;
    if(assignedCountInState(s,itemId,key,slot)>=Math.max(0,Math.floor(Number(s.stash[itemId]||0))))return false;
    current.slots[slot]=itemId;s.preparations[key]=current;save(s);return true;
  }
  function unequip(key,slot,slotCount=ItemDatabase.RULES.defaultBattleSlots){const s=state(),current=preparationFromState(s,key,slotCount);slot=Math.floor(Number(slot));if(slot<0||slot>=current.slots.length)return false;current.slots[slot]=null;s.preparations[key]=current;save(s);return true}
  function preparationFromState(s,key,slots){const saved=s.preparations?.[key],arr=Array.isArray(saved?.slots)?saved.slots.slice(0,slots):[];while(arr.length<slots)arr.push(null);return{key,slots:arr}}
  function trimAssignmentsInState(s,itemId){
    let allowed=Math.max(0,Math.floor(Number(s.stash[itemId]||0))),seen=0;
    for(const key of Object.keys(s.preparations||{}).sort()){
      const prep=s.preparations[key];if(!Array.isArray(prep?.slots))continue;
      prep.slots=prep.slots.map(id=>{if(id!==itemId)return id;seen++;return seen<=allowed?id:null});
    }
  }
  function loadoutsForDeck(deck=[]){
    syncPreparationsForDeck(deck);
    const result={};for(const entry of deckEntries(deck)){const slots=slotCountForCard(entry.card),prep=preparation(entry.key,slots),items=prep.slots.filter(id=>id&&ItemDatabase.get(id));(result[entry.cardId]??=[]).push({key:entry.key,items});}return result;
  }
  /**
   * Transport-safe version of the SAME single-player preparation and slot rules.
   * A browser stash is an ownership *claim*, not an authenticated server account.
   * PvP test rooms may use it only when their experimental inventory mode is enabled.
   */
  function validateMatchPreparation(deck=[],submitted=null){
    const fail=reason=>({valid:false,reason});
    if(submitted==null){
      const byCard={};
      for(const entry of deckEntries(deck))
        (byCard[entry.cardId]??=[]).push({key:entry.key,items:[]});
      return{valid:true,preparation:{stash:{},loadouts:byCard}};
    }
    if(!submitted||typeof submitted!=="object"||Array.isArray(submitted)||
       Object.keys(submitted).sort().join("|")!=="loadouts|stash")return fail("INVALID_ITEM_PREPARATION");
    const {stash:claimed,loadouts:entries}=submitted;
    if(!claimed||typeof claimed!=="object"||Array.isArray(claimed)||
       !entries||typeof entries!=="object"||Array.isArray(entries))return fail("INVALID_ITEM_PREPARATION");
    const checkedStash={};
    for(const [id,count] of Object.entries(claimed)){
      if(!ItemDatabase.get(id)||!Number.isSafeInteger(count)||count<0)
        return fail("INVALID_ITEM_STASH");
      checkedStash[id]=count;
    }
    const expected=deckEntries(deck),byCard=new Map(),seen=new Map(),used={};
    for(const entry of expected){
      const array=byCard.get(entry.cardId)||[];array.push(entry);byCard.set(entry.cardId,array);
    }
    for(const cardId of Object.keys(entries))if(!byCard.has(cardId))return fail("FOREIGN_ITEM_CARD");
    const normalized={};
    for(const [cardId,occurrences] of byCard){
      const provided=entries[cardId];
      if(!Array.isArray(provided)||provided.length!==occurrences.length)
        return fail("INVALID_ITEM_OCCURRENCES");
      normalized[cardId]=[];
      for(let i=0;i<occurrences.length;i++){
        const specified=provided[i],entry=occurrences[i];
        if(!specified||typeof specified!=="object"||Array.isArray(specified)||
           Object.keys(specified).sort().join("|")!=="items|key"||
           specified.key!==entry.key||!Array.isArray(specified.items)||
           specified.items.length>slotCountForCard(entry.card))return fail("INVALID_ITEM_SLOTS");
        for(const id of specified.items){
          if(typeof id!=="string"||!ItemDatabase.get(id))return fail("INVALID_ITEM_ID");
          used[id]=(used[id]||0)+1;
          if(used[id]>(checkedStash[id]||0))return fail("ITEM_COUNT_EXCEEDS_STASH");
        }
        normalized[cardId].push({key:entry.key,items:[...specified.items]});
      }
    }
    return{valid:true,preparation:{stash:checkedStash,loadouts:normalized}};
  }
  function matchPreparationForDeck(deck=[]){
    const prepared={stash:stash(),loadouts:loadoutsForDeck(deck)};
    const result=validateMatchPreparation(deck,prepared);
    if(!result.valid)throw Error(result.reason);
    return result.preparation;
  }
  /** Idempotent local profile reconciliation from the seat-private authority view. */
  function reconcileMatchConsumption(matchId,seat,counts={}){
    if(typeof matchId!=="string"||!matchId||![0,1].includes(seat)||
       !counts||typeof counts!=="object"||Array.isArray(counts))return false;
    const s=state();s.pvpItemReceipts??={};
    const key=`${matchId}:${seat}`,previous=s.pvpItemReceipts[key]||{},next={...previous};
    for(const [id,total] of Object.entries(counts)){
      if(!ItemDatabase.get(id)||!Number.isSafeInteger(total)||total<0)return false;
      if(total<Number(previous[id]||0))return false;
      const delta=total-Number(previous[id]||0);
      if(delta>0){
        s.stash[id]=Math.max(0,Number(s.stash[id]||0)-delta);
        if(s.stash[id]===0)delete s.stash[id];
        trimAssignmentsInState(s,id);
      }
      next[id]=total;
    }
    s.pvpItemReceipts[key]=next;
    save(s);return true;
  }
  function beginBattle(loadouts={}){battleQueues=new Map();for(const[cardId,entries]of Object.entries(loadouts||{}))battleQueues.set(cardId,(entries||[]).map(entry=>clone(entry)));groundItems=[];groundSerial=0;return true}
  function claimBattleLoadout(cardId){const q=battleQueues.get(cardId)||[];if(!q.length)return[];const entry=q.shift();battleQueues.set(cardId,q);return[...(entry?.items||[])].filter(id=>ItemDatabase.get(id))}
  function makePayload(itemId,{owned=false,source="BATTLE"}={}){const item=ItemDatabase.get(itemId);if(!item)return null;return{id:`item_${Date.now().toString(36)}_${groundSerial++}`,itemId:item.id,type:"ITEM",kind:"ITEM",owned:owned===true,source}}
  function spawnGroundItem(itemId,x,y,{owned=false,source="DEBUG"}={}){const payload=makePayload(itemId,{owned,source});if(!payload)return null;const entry={...payload,x:Number(x),y:Number(y)};groundItems.push(entry);return entry}
  function dropPayload(payload,x,y){if(!payload?.itemId||!ItemDatabase.get(payload.itemId))return null;const entry={...clone(payload),x:Number(x),y:Number(y)};groundItems.push(entry);return entry}
  function groundAt(x,y){return groundItems.filter(item=>item.x===Number(x)&&item.y===Number(y)).map(clone)}
  function takeGround(id,x,y){const index=groundItems.findIndex(item=>item.id===id&&item.x===Number(x)&&item.y===Number(y));if(index<0)return null;return groundItems.splice(index,1)[0]||null}
  function removeGround(id){const index=groundItems.findIndex(item=>item.id===id);if(index<0)return null;return groundItems.splice(index,1)[0]||null}
  function battleGroundItems(){return groundItems.map(clone)}
  function restoreBattleGroundItems(items=[]){groundItems=(items||[]).map(clone);groundSerial=Math.max(groundSerial,groundItems.length);return battleGroundItems()}
  function withBattleGroundState(items,callback){
    if(!Array.isArray(items)||typeof callback!=="function")throw Error("INVALID_BATTLE_GROUND_SCOPE");
    const previousItems=groundItems,previousSerial=groundSerial;
    groundItems=clone(items);groundSerial=Math.max(groundSerial,groundItems.length);
    try{
      const result=callback();
      if(result&&typeof result.then==="function")throw Error("BATTLE_GROUND_SCOPE_MUST_BE_SYNCHRONOUS");
      return{result,groundItems:battleGroundItems()};
    }finally{groundItems=previousItems;groundSerial=previousSerial;}
  }
  function resetProfile(){localStorage.removeItem(STORAGE_KEY);return defaults()}

  return Object.freeze({
    state,gold,addGold,spendGold,stash,stashCount,grant,consumeOwned,buy,
    deckEntries,slotCountForCard,syncPreparationsForDeck,preparation,assignedCount,availableCount,equip,unequip,loadoutsForDeck,
    validateMatchPreparation,matchPreparationForDeck,reconcileMatchConsumption,
    beginBattle,claimBattleLoadout,makePayload,spawnGroundItem,dropPayload,groundAt,takeGround,removeGround,battleGroundItems,restoreBattleGroundItems,withBattleGroundState,resetProfile
  });
})();

globalThis.ItemInventoryEngine=ItemInventoryEngine;
