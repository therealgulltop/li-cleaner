// ==UserScript==
// @name         LI Cleaner
// @version      5
// @namespace    https://github.com/therealgulltop/li-cleaner
// @description  Hides LinkedIn feed posts that only show up because someone liked, loved, celebrated or commented on them, unless you're connected to the poster.
// @updateURL    https://raw.githubusercontent.com/therealgulltop/li-cleaner/main/li-cleaner.user.js
// @downloadURL  https://raw.githubusercontent.com/therealgulltop/li-cleaner/main/li-cleaner.user.js
// @match        https://www.linkedin.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (window.__liCleaner) return;
    window.__liCleaner = true;

    var VERBS = /\s((likes?|loves?|celebrates?) this|commented( on this)?)$/i;
    var DONE = 'data-lrh';
    var labels = {};
    var undone = {};
    var seen = {};
    var stats = { reactions: 0, comments: 0 };
    var badge = null;

    function idOf(card) {
        var m = (card.id || '').match(/^expanded(.+?)FeedType_/);
        return m ? m[1] : null;
    }

    function author(card, headerP) {
        var links = card.querySelectorAll('a');
        for (var i = 0; i < links.length; i++) {
            var a = links[i];
            if (headerP.contains(a)) continue;
            if (/^Visit/.test(a.getAttribute('aria-label') || '')) continue;
            var t = a.innerText.replace(/\s+/g, ' ').trim();
            if (!t) continue;
            var name = t.split('•')[0].trim();
            var deg = t.match(/\b(1st|2nd|3rd\+?)(?!\w)/);
            return { name: name, degree: deg ? deg[1] : '' };
        }
        return null;
    }

    function processCard(card) {
        if (card.hasAttribute(DONE)) return;
        var id = idOf(card);
        if (!id) return;
        seen[id] = 1;
        var x = card.querySelector('button[aria-label^="Hide post by"]');
        if (!x) return;
        var anchor = card.querySelector('[data-sdui-anchor-id^="feed-header-"]');
        if (!anchor) { card.setAttribute(DONE, '1'); return; }
        var p = anchor.closest('p');
        var who = author(card, p);
        if (!p || !x || !who) return;
        card.setAttribute(DONE, '1');
        if (undone[id]) return;
        var header = p.textContent.replace(/\s+/g, ' ').trim();
        var vm = header.match(VERBS);
        if (!vm) return;
        if (who.degree === '1st') return;
        labels[id] = header + ': ' + who.name + (who.degree ? ' - ' + who.degree : '');
        if (/^commented/i.test(vm[1])) stats.comments++; else stats.reactions++;
        x.click();
    }

    function compact(panel) {
        if (panel.hasAttribute(DONE)) return;
        var id = (panel.getAttribute('componentkey') || '').replace('feed.confirmation_confirmation-', '');
        var label = labels[id];
        if (!label) return;
        var rows = panel.children;
        if (rows.length < 2) return;
        panel.setAttribute(DONE, '1');
        for (var i = 1; i < rows.length; i++) rows[i].style.display = 'none';
        var msg = rows[0].querySelector('p');
        if (msg) {
            msg.textContent = 'Post hidden in feed: ' + label;
            msg.style.fontStyle = 'italic';
            msg.style.fontSize = '12px';
            msg.style.color = '#ffb6c1';
        }
        var undo = rows[0].querySelector('button');
        if (undo) undo.addEventListener('click', function () {
            undone[id] = 1;
            delete labels[id];
        }, true);
    }

    function updateBadge() {
        if (!badge) {
            badge = document.createElement('div');
            badge.style.cssText = 'position:fixed;right:76px;bottom:56px;z-index:9999;padding:6px 10px;border-radius:8px;background:rgba(0,0,0,0.7);color:#fff;font:12px/1.4 system-ui,sans-serif;pointer-events:none;';
            document.body.appendChild(badge);
        }
        var posts = Object.keys(seen).length;
        var hidden = stats.reactions + stats.comments;
        var pct = posts ? Math.round(hidden * 100 / posts) : 0;
        var txt = 'Reactions ' + stats.reactions + ' + Comments ' + stats.comments + ' / Posts ' + posts + ' -- ' + pct + '%';
        if (badge.textContent !== txt) badge.textContent = txt;
        var disp = location.pathname.indexOf('/feed') === 0 ? '' : 'none';
        if (badge.style.display !== disp) badge.style.display = disp;
    }

    function scan() {
        if (location.pathname.indexOf('/feed') === 0) {
            document.querySelectorAll('[data-testid="mainFeed"] [id^="expanded"]:not([' + DONE + '])').forEach(processCard);
            document.querySelectorAll('[componentkey^="feed.confirmation_confirmation-"]:not([' + DONE + '])').forEach(compact);
        }
        updateBadge();
    }

    var timer = null;
    new MutationObserver(function () {
        if (timer) return;
        timer = setTimeout(function () { timer = null; scan(); }, 200);
    }).observe(document.body, { childList: true, subtree: true });

    scan();
})();
