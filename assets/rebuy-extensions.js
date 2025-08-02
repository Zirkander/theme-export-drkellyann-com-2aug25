if (window.Rebuy && window.Rebuy._status === 'initialized') {
    // Already initialized!
} else {
    window.Rebuy = {};

    const rebuyJs = document.createElement('script');
    rebuyJs.type = 'text/javascript';
    rebuyJs.async = true;
    rebuyJs.src = `https://cdn.rebuyengine.com/onsite/js/rebuy.js?shop=${Shopify.shop}`;

    document.getElementsByTagName('head')[0].appendChild(rebuyJs);
}
