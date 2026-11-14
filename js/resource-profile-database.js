/** Declarative resource profiles. Character identity never owns an executor.
 * These values are the existing authored balance and skill variants, not logic. */
export const RESOURCE_PROFILES=Object.freeze({
  duality:Object.freeze({
    label:'雙極',max:100,initial:50,naturalRecovery:0,
    polarity:{center:50,blueFull:0,purpleFull:100,roundRecovery:10,holdFullFutureRounds:1,
      skillDeltas:{shadow_step:18,nether_slash:22},fullFormStatBonusRatio:.15,
      corruptionRiskIncreasePerRound:.1},
    berserk:{type:'BERSERK',damageMultiplier:1.25,releaseAt:50},
    manaWells:{recovery:24,perRound:1,maxPerTeam:3},
    spatialDistortion:{durationFutureRounds:2,displaceChance:.35},
    spellForms:{
      nether_slash:{
        blue:{name:'奧義・淨界斬',category:'SPECIAL',target:'TILE',targetType:'AOE',
          range:{min:1,max:4},shape:'FAN',radius:0,
          purifiedSlash:{length:4,powerMultiplier:2.0},support:false,
          description:'【完整型態・淨化奧義】水晶共鳴將黑劍延伸為巨大藍白光刃，對前方扇形範圍敵軍作一次高威力空間斬擊；斬過的地格留下施放後兩個完整回合的空間扭曲，敵軍移入時可能偏移落點。施放後雙極回到中央，完整型態增益結束。'},
        purple:{name:'奧義・幽影連斬',hitCount:4,
          description:'【高維污染解放】四段獨立判定的空間連續斬擊。持續施放可維持紫色滿值，但每回合失控風險會上升。'}},
      shadow_step:{purple:{name:'幽影步・高維解放',
        description:'【高維污染解放】維持空間位移能力；使用後延長紫色滿值期間的恢復停頓，並增加持續污染風險。'}}},
    magicResist:{affix:'MAGIC_RESIST',procChance:.3,damageMultiplier:.5}
  })
});
