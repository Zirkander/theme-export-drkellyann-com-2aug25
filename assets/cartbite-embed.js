(async function () {
  window.growAppEmbedLoaded=true;
  let addScriptTag=async ()=> {
    if(window.growClient){
      return
    }
    if (!window.cartbiteMainJsUrl) {
      await new Promise(res => {
        setTimeout(() => {
          res()
        }, 1000)
      })
    }
    if (!window.cartbiteMainJsUrl) {
      window.cartbiteMainJsUrl = `https://s1.staq-cdn.com/grow/api/js/main.js?sId=${encodeURIComponent(Shopify.shop)}&v=${new Date().valueOf()}&cfs=skip`;
    }

    let mainJsScriptTag = document.createElement('script');
    mainJsScriptTag.src = window.cartbiteMainJsUrl;
    mainJsScriptTag.async = true;
    document.getElementsByTagName('head')[0].appendChild(mainJsScriptTag);
  }
  await addScriptTag();
  setTimeout(async ()=>{
    let isActive=false;
    try {
      isActive = window.growClient || (await (await fetch(`https://s1.staq-cdn.com/api/status`)).json()).isActive
    } catch (e) {
      console.error("Error in getting script from cdn", e)
    }
    if(!isActive){
      window.cartbiteMainJsUrl=  window.cartbiteMainJsUrl.replace('https://s1.staq-cdn.com','https://js-server.staqlab.com')
      await addScriptTag();
    }
  },1000);
})()
