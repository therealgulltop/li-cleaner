// ==UserScript==
// @name         LI Cleaner
// @version      7
// @namespace    https://github.com/therealgulltop/li-cleaner
// @description  Hides LinkedIn feed posts that only show up because someone reacted to or commented on them, unless you're connected to the poster.
// @updateURL    https://raw.githubusercontent.com/therealgulltop/li-cleaner/main/li-cleaner.user.js
// @downloadURL  https://raw.githubusercontent.com/therealgulltop/li-cleaner/main/li-cleaner.user.js
// @match        https://www.linkedin.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// ==/UserScript==
// Works on LinkedIn's computer and phone layouts (for example Quetta on Android).
// Uses LinkedIn's own hide button, then shrinks LinkedIn's "Post hidden" panel to one line.  Undo is respected.
// Click the LI Cleaner logo (bottom-left on a computer, bottom-right on a phone) for settings; they're remembered in this browser.
(() => {
  if (document.documentElement.dataset.licRunning) return; // another copy of this script is already running
  document.documentElement.dataset.licRunning = '7';
  // ---- stale-copy check: a browser can keep running the old copy after an update until the tab is closed, so compare with GitHub ----
  const checkLatest = () => {
    if (typeof GM_xmlhttpRequest !== 'function') return;
    const VER = 7, KEY = 'lic-latest-li-cleaner.user.js';
    const tell = latest => {
      if (!(latest > VER) || document.querySelector('.lic-stale')) return;
      try { if (localStorage.getItem(KEY + '-dismissed') === String(latest)) return; } catch (e) {}
      const b = document.createElement('div');
      b.className = 'lic-stale';
      b.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:10001;max-width:560px;margin:0 auto;padding:12px 14px;border-radius:10px;background:#242526;color:#e4e6eb;font:14px/1.4 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.6);display:flex;gap:12px;align-items:center';
      // LinkedIn's Trusted Types policy blocks innerHTML, so build with DOM calls
      const msg = document.createElement('div'), x = document.createElement('span');
      msg.style.flex = '1';
      x.setAttribute('role', 'button'); x.title = 'Dismiss'; x.textContent = '✕';
      x.style.cssText = 'flex:none;cursor:pointer;color:#b0b3b8;font-size:18px;padding:0 4px';
      b.append(msg, x);
      b.firstChild.textContent = 'LI Cleaner v' + latest + ' is out, but this tab is running v' + VER + '.  Update it in Tampermonkey if it hasn’t already, then close this tab and reopen LinkedIn.';
      b.lastChild.addEventListener('click', () => { b.remove(); try { localStorage.setItem(KEY + '-dismissed', String(latest)); } catch (e) {} });
      document.body.appendChild(b);
    };
    let c = null;
    try { c = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (c && Date.now() - c.at < 5 * 60000) return tell(c.v);
    GM_xmlhttpRequest({ method: 'GET', url: 'https://raw.githubusercontent.com/therealgulltop/li-cleaner/main/li-cleaner.user.js', onload: r => {
      const m = /@version\s+(\d+)/.exec(r.responseText || ''); if (!m) return;
      try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), v: +m[1] })); } catch (e) {}
      tell(+m[1]);
    } });
  };
  // once shortly after loading, then every 10 minutes, since the update usually lands while the tab is already open
  setTimeout(checkLatest, 5000);
  setInterval(checkLatest, 10 * 60000);

  // ---- settings ----
  const DEFAULTS = { reactions: true, comments: true, debug: false };
  const load = () => { try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('lic-settings') || '{}')); } catch (e) { return Object.assign({}, DEFAULTS); } };
  const save = () => { try { localStorage.setItem('lic-settings', JSON.stringify(opt)); } catch (e) {} };
  const opt = load();

  // phone layout: controls go bottom-right; on a computer LinkedIn's messaging bar is there, so they go bottom-left
  const phone = /Mobi|Android/i.test(navigator.userAgent) || innerWidth < 768;
  const side = phone ? 'right' : 'left';

  // ---- state ----
  // every LinkedIn reaction (Like, Celebrate, Support, Love, Insightful, Funny), plus comments
  const VERBS = /\s((likes?|loves?|celebrates?|supports?) this|finds? this (insightful|funny)|commented( on this)?)$/i;
  const DONE = 'data-lic';
  const labels = {};   // post id -> one-line label for LinkedIn's "Post hidden" panel
  const kinds = {};    // post id -> 'reactions' | 'comments', for posts we hid
  const undoBtn = {};  // post id -> LinkedIn's Undo button for posts we hid
  const undone = {};   // post id -> 1 once you click Undo; we leave that post alone
  const seen = {};
  const count = { reactions: 0, comments: 0 };

  const idOf = card => { const m = (card.id || '').match(/^expanded(.+?)FeedType_/); return m ? m[1] : null; };
  const author = (card, headerP) => {
    for (const a of card.querySelectorAll('a')) {
      if (headerP.contains(a)) continue;
      if (/^Visit/.test(a.getAttribute('aria-label') || '')) continue;
      const t = a.innerText.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const deg = t.match(/\b(1st|2nd|3rd\+?)(?!\w)/);
      return { name: t.split('•')[0].trim(), degree: deg ? deg[1] : '' };
    }
    return null;
  };

  // ---- debug labels ----
  const tag = (card, msg) => {
    if (!opt.debug) return;
    let d = card.querySelector(':scope > .lic-dbg');
    if (!d) { d = document.createElement('div'); d.className = 'lic-dbg'; d.style.cssText = 'font:10px/1.3 monospace;color:#ff0;background:#600;padding:1px 4px;white-space:pre-wrap'; card.prepend(d); }
    if (d.textContent !== msg) d.textContent = msg;
  };

  const check = card => {
    if (card.hasAttribute(DONE)) return;
    const id = idOf(card);
    if (!id) return;
    seen[id] = 1;
    const x = card.querySelector('button[aria-label^="Hide post by"]');
    if (!x) return; // not drawn yet
    const anchor = card.querySelector('[data-sdui-anchor-id^="feed-header-"]');
    if (!anchor) { card.setAttribute(DONE, 'plain'); tag(card, 'KEEP  no header'); return; }
    const p = anchor.closest('p');
    const who = p && author(card, p);
    if (!who) return;
    const header = p.textContent.replace(/\s+/g, ' ').trim();
    const vm = header.match(VERBS);
    if (!vm) { card.setAttribute(DONE, 'plain'); tag(card, 'KEEP  header: ' + header); return; }
    const kind = /^commented/i.test(vm[1]) ? 'comments' : 'reactions';
    card.dataset.licKind = kind;
    if (who.degree === '1st') { card.setAttribute(DONE, 'kept'); tag(card, 'KEEP  ' + who.name + ' is 1st'); return; }
    if (undone[id]) { card.setAttribute(DONE, 'undone'); tag(card, 'KEEP  you clicked Undo'); return; }
    if (!opt[kind]) { card.setAttribute(DONE, 'off'); tag(card, 'OFF  ' + kind + ' setting is off'); return; }
    card.setAttribute(DONE, 'hidden');
    labels[id] = header + ': ' + who.name + (who.degree ? ' - ' + who.degree : '');
    if (!kinds[id]) count[kind]++;
    kinds[id] = kind;
    x.click();
  };

  // ---- the same compact, low-key card FB Cleaner uses:  [x] Post hidden · who/what ............ [Undo] ----
  // match LinkedIn's light or dark theme by the hidden-post panel's own background
  const palette = el => {
    const bg = getComputedStyle(el).backgroundColor;
    const m = (bg && !/^rgba\(.*,\s*0\)$|transparent/.test(bg) && bg.match(/\d+/g)) || [255, 255, 255];
    const dark = (+m[0] * 299 + +m[1] * 587 + +m[2] * 114) / 1000 < 128;
    return dark ? { card: bg || '#1b1f23', sub: '#b0b3b8', dim: '#7c7f84', icon: '#4e4f52', btn: '#303132', dark }
                : { card: bg || '#ffffff', sub: '#65676b', dim: '#8a8d91', icon: '#c6c9cd', btn: '#eef0f2', dark };
  };
  const makeBar = (c, label, sub, onUndo) => {
    const bar = document.createElement('div'), icon = document.createElement('span'), text = document.createElement('span'), btn = document.createElement('button');
    bar.className = 'lic-bar';
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 6px 4px 10px;background:' + c.card + ';border-radius:8px;font:13px/20px system-ui,sans-serif;color:' + c.sub;
    icon.style.cssText = 'flex:none;width:12px;height:12px;border-radius:3px;text-align:center;font:bold 8px/12px system-ui,sans-serif;background:' + c.icon + ';color:' + c.card;
    icon.textContent = '✕';
    text.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;font-style:italic;color:' + c.dim; // dimmer than the rest of the card
    text.textContent = label + (sub ? ' · ' + sub : '');
    btn.type = 'button';
    btn.style.cssText = 'flex:none;border:0;border-radius:6px;padding:1px 7px;font:600 11px/16px system-ui,sans-serif;cursor:pointer;background:' + c.btn + ';color:' + c.dim;
    btn.textContent = 'Undo';
    btn.addEventListener('click', e => { e.stopPropagation(); onUndo(); });
    bar.append(icon, text, btn);
    return bar;
  };

  // LinkedIn swaps the post for a big "Post hidden in feed" panel; cover it with the compact card (LinkedIn's Undo still does the undoing)
  const compact = panelEl => {
    if (panelEl.hasAttribute(DONE)) return;
    const id = (panelEl.getAttribute('componentkey') || '').replace('feed.confirmation_confirmation-', '');
    const label = labels[id];
    if (!label) return;
    const undo = [...panelEl.querySelectorAll('button')].find(b => /^Undo$/.test(b.textContent.trim()));
    if (!undo) return; // not drawn yet
    panelEl.setAttribute(DONE, '1');
    const c = palette(panelEl);
    const kids = [...panelEl.children];
    kids.forEach(k => { k.dataset.licDisp = k.style.display; k.style.display = 'none'; });
    const saved = { padding: panelEl.style.padding, background: panelEl.style.background, border: panelEl.style.border };
    panelEl.style.padding = '0'; panelEl.style.background = 'transparent'; panelEl.style.border = '0';
    const bar = makeBar(c, 'Post hidden', label, () => {
      bar.remove();
      kids.forEach(k => { k.style.display = k.dataset.licDisp || ''; delete k.dataset.licDisp; });
      Object.assign(panelEl.style, saved);
      undo.click();
    });
    panelEl.prepend(bar);
    undoBtn[id] = undo;
    undo.addEventListener('click', () => {
      if (undo.dataset.licAuto) return; // turned off in settings, not you
      undone[id] = 1;
      if (kinds[id]) { count[kinds[id]] = Math.max(0, count[kinds[id]] - 1); delete kinds[id]; delete labels[id]; delete undoBtn[id]; }
    }, true);
  };

  // ---- counter ----
  const GLASS = 'background:rgba(36,37,38,.6);-webkit-backdrop-filter:blur(14px) saturate(160%);backdrop-filter:blur(14px) saturate(160%);border:1px solid rgba(255,255,255,.14)';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;' + side + ':56px;bottom:8px;min-height:36px;box-sizing:border-box;display:flex;align-items:center;max-width:calc(100vw - 68px);z-index:9999;padding:4px 10px;border-radius:8px;' + GLASS + ';color:#fff;font:12px/1.4 system-ui,sans-serif;pointer-events:none';
  const show = () => {
    if (!box.isConnected) document.body.appendChild(box);
    const posts = Object.keys(seen).length, n = count.reactions + count.comments;
    const pct = `${posts ? Math.round(100 * n / posts) : 0}%`;
    // on a phone, just the percentage until the menu is open
    const s = !phone || panel.style.display === 'block' ? `Reactions ${count.reactions} + Comments ${count.comments} / Posts ${posts} -- ${pct}` : pct;
    if (box.textContent !== s) box.textContent = s;
  };

  const OPTIONS = [['reactions', 'Hide posts others reacted to'], ['comments', 'Hide posts others commented on'], ['debug', 'Debug labels']];
  // ---- settings button (the LI Cleaner logo) + panel ----
  // built with DOM calls because LinkedIn's Trusted Types policy blocks innerHTML
  const logo = () => {
    const NS = 'http://www.w3.org/2000/svg', el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const svg = el('svg', { viewBox: '0 0 100 100', width: '100%', height: '100%', style: 'display:block' });
    svg.append(
      el('circle', { cx: 50, cy: 50, r: 42, fill: 'none', stroke: '#e0245e', 'stroke-width': 9 }),
      el('line', { x1: 69, y1: 31, x2: 31, y2: 69, stroke: '#e0245e', 'stroke-width': 9, 'stroke-linecap': 'round' }),
      el('circle', { cx: 34, cy: 36, r: 8, fill: 'none', stroke: '#8a8d91', 'stroke-width': 6 }),
      el('circle', { cx: 66, cy: 64, r: 8, fill: 'none', stroke: '#8a8d91', 'stroke-width': 6 }));
    return svg;
  };
  const gear = document.createElement('div');
  gear.title = 'LI Cleaner settings';
  gear.appendChild(logo());
  gear.style.cssText = 'position:fixed;' + side + ':12px;bottom:8px;z-index:10000;width:36px;height:36px;padding:3px;box-sizing:border-box;border-radius:50%;' + GLASS + ';box-shadow:0 1px 4px rgba(0,0,0,.5);cursor:pointer;user-select:none';
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;' + side + ':12px;bottom:52px;z-index:10000;box-sizing:border-box;max-width:calc(100vw - 24px);padding:10px 14px;border-radius:10px;' + GLASS + ';color:#e4e6eb;font:15px/2 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.6);display:none';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:2px 0 8px;margin-bottom:4px;border-bottom:1px solid #3e4042;font:600 16px/1.2 system-ui,sans-serif';
  const hLogo = document.createElement('span'), hName = document.createElement('span'), hVer = document.createElement('span');
  hLogo.style.cssText = 'flex:none;width:24px;height:24px'; hLogo.appendChild(logo());
  hName.textContent = 'LI Cleaner';
  hVer.style.cssText = 'font-weight:400;font-size:12px;color:#b0b3b8'; hVer.textContent = 'v7';
  head.append(hLogo, hName, hVer);
  panel.appendChild(head);
  const boxes = {};
  OPTIONS.forEach(([k, text]) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;cursor:pointer;color:#e4e6eb;margin:0';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!opt[k]; cb.style.cssText = 'width:20px;height:20px;margin:0;opacity:1;position:static;appearance:auto;-webkit-appearance:checkbox';
    cb.addEventListener('change', () => { opt[k] = cb.checked; save(); applySettings(k); });
    row.append(cb, document.createTextNode(text));
    panel.appendChild(row);
    boxes[k] = cb;
  });
  // ---- Debug labels are for the author: the option stays hidden unless you press Ctrl+Alt+D (or tap the version number 5 times) ----
  const dev = () => { try { return localStorage.getItem('fbc-dev') === '1'; } catch (e) { return false; } };
  const syncDev = init => {
    boxes.debug.parentElement.style.display = dev() ? 'flex' : 'none';
    if (!dev() && opt.debug) { opt.debug = false; boxes.debug.checked = false; save(); if (!init) applySettings('debug'); }
  };
  const toggleDev = () => { try { localStorage.setItem('fbc-dev', dev() ? '0' : '1'); } catch (e) {} syncDev(); };
  addEventListener('keydown', e => { if (e.ctrlKey && e.altKey && /^d$/i.test(e.key)) { e.preventDefault(); if (e.fbcDev) syncDev(); else { e.fbcDev = 1; toggleDev(); } } });
  let taps = [];
  head.lastElementChild.addEventListener('click', () => { const now = Date.now(); taps = taps.filter(t => now - t < 2000).concat(now); if (taps.length >= 5) { taps = []; toggleDev(); } });
  syncDev(true);
  gear.addEventListener('click', e => { e.stopPropagation(); panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; show(); });
  const applySettings = k => {
    if (k === 'debug') {
      if (!opt.debug) document.querySelectorAll('.lic-dbg').forEach(d => d.remove());
      else document.querySelectorAll('[' + DONE + ']:not([' + DONE + '="hidden"])').forEach(c => { if (idOf(c)) c.removeAttribute(DONE); });
    } else if (opt[k]) {
      // turned on: look at the posts we skipped for this setting again
      document.querySelectorAll('[' + DONE + '="off"][data-lic-kind="' + k + '"]').forEach(c => c.removeAttribute(DONE));
    } else {
      // turned off: bring back the posts we hid for it, using LinkedIn's own Undo
      Object.keys(kinds).forEach(id => {
        if (kinds[id] !== k) return;
        const u = undoBtn[id];
        if (u && u.isConnected) { u.dataset.licAuto = '1'; u.click(); }
        delete kinds[id]; delete labels[id]; delete undoBtn[id];
        count[k] = Math.max(0, count[k] - 1);
      });
    }
    tick();
  };

  // ---- main pass ----
  const scan = () => {
    if (!gear.isConnected) document.body.append(gear, panel);
    // only show our controls on the feed: on a single post they'd cover LinkedIn's comment box
    const onFeed = /^\/feed(\/|$)/.test(location.pathname) && !/^\/feed\/update\//.test(location.pathname);
    [gear, panel, box].forEach(e => { e.style.visibility = onFeed ? '' : 'hidden'; });
    if (!onFeed) panel.style.display = 'none';
    if (onFeed) {
      document.querySelectorAll('[data-testid="mainFeed"] [id^="expanded"]:not([' + DONE + '])').forEach(check);
      document.querySelectorAll('[componentkey^="feed.confirmation_confirmation-"]:not([' + DONE + '])').forEach(compact);
    }
    show();
  };

  let t = 0;
  const tick = () => { if (!t) t = setTimeout(() => { t = 0; scan(); }, 200); };
  new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
  ['popstate', 'focus'].forEach(ev => addEventListener(ev, tick));
  setInterval(tick, 1500);
  tick();
})();
