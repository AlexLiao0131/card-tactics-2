import { PackDatabase } from './pack-database.js';
import { CardDatabase } from './card-database.js';
import { DeckEngine } from './deck-engine.js';

const pack=document.getElementById('pvpTestDeckPack');
const save=document.getElementById('pvpTestDeckBuild');
const summary=document.getElementById('pvpTestDeckSummary');
const show=()=>{
  const ids=DeckEngine.getActive(),valid=DeckEngine.validate(ids);
  summary.textContent=valid.valid
    ?`目前出戰牌組：${valid.deck.length} 張｜${valid.deck.map(id=>CardDatabase.get(id)?.name||id).join('、')}`
    :'目前沒有合法出戰牌組；你可以回到「卡牌整理」，或按上方按鈕直接建立。';
};
for(const item of PackDatabase.list()){
  const option=document.createElement('option');option.value=item.id;option.textContent=item.name;pack.appendChild(option);
}
pack.value='IMPERIAL';
save.addEventListener('click',()=>{
  try{
    const proposed=DeckEngine.autoBuild(pack.value);
    const checked=DeckEngine.validate(proposed);
    if(!checked.valid)throw new Error(checked.errors.join('；'));
    DeckEngine.setActive(checked.deck);
    show();
  }catch(error){summary.textContent=`無法建立牌組：${String(error?.message||error)}`;}
});
show();
