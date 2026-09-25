export const AudioManager=(()=>{
  const settings={bgm:true,se:true,bgmVolume:.55,seVolume:.7};
  const bgm=new Audio(); bgm.loop=true; bgm.preload="auto";
  let current="";
  function apply(){bgm.volume=settings.bgm?settings.bgmVolume:0}
  function playBgm(src){
    if(!src||current===src&&!bgm.paused)return;
    current=src; bgm.src=src; apply();
    bgm.play().catch(()=>{});
  }
  function setBgmEnabled(value){settings.bgm=!!value;apply();if(settings.bgm&&current)bgm.play().catch(()=>{})}
  function setBgmVolume(value){settings.bgmVolume=Math.max(0,Math.min(1,Number(value)||0));apply()}
  function setSeEnabled(value){settings.se=!!value}
  function setSeVolume(value){settings.seVolume=Math.max(0,Math.min(1,Number(value)||0))}
  return{settings,playBgm,setBgmEnabled,setBgmVolume,setSeEnabled,setSeVolume};
})();
globalThis.AudioManager=AudioManager;
