var l = Object.defineProperty;
var S = (e, t, o) => t in e ? l(e, t, { enumerable: !0, configurable: !0, writable: !0, value: o }) : e[t] = o;
var c = (e, t, o) => (S(e, typeof t != "symbol" ? t + "" : t, o), o);
class n {
  static get() {
    let t = null;
    try {
      t = JSON.parse(
        sessionStorage.getItem(this.SESSION_STORAGE_KEY) || "null"
      );
    } catch {
    }
    return t;
  }
  static set(t) {
    try {
      sessionStorage.setItem(this.SESSION_STORAGE_KEY, JSON.stringify(t));
    } catch {
    }
  }
}
c(n, "SESSION_STORAGE_KEY", "as-customer-trigger-data");
function m({
  urlSearchParams: e,
  existingCustomerData: t
}) {
  const o = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_id",
    "utm_content"
  ];
  let s = !1;
  const r = {};
  for (const a of o) {
    const i = e.get(a) || (t == null ? void 0 : t[a]);
    i && (s = !0, r[a] = i);
  }
  return s ? r : null;
}
const g = "https://start.aftersell.app";
function u({ cookie: e, cookieName: t }) {
  const o = new RegExp(`^${t}=`), s = e.split(";").map((a) => a.trim()).find((a) => o.test(a));
  return s ? s.replace(`${t}=`, "") : null;
}
function f({
  cookieName: e,
  onChange: t,
  callbackOnInitialValue: o
}) {
  let r = u({ cookie: document.cookie, cookieName: e });
  o && t(r), setInterval(() => {
    const a = u({ cookie: document.cookie, cookieName: e });
    a !== r && (r = a, t(a));
  }, 500);
}
f({
  cookieName: "cart",
  callbackOnInitialValue: !0,
  onChange: (e) => {
    const t = n.get(), o = m({
      urlSearchParams: new URLSearchParams(window.location.search),
      existingCustomerData: t
    });
    n.set(o), !(typeof e != "string" || !e || !o) && fetch(`${g}/api/v1/storefrontSessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ shop: window.Shopify.shop, cartToken: e, customerTriggerData: o })
    });
  }
});
