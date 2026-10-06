// Link shortener page: create links, copy them, and watch this browser's links collect clicks.
(function () {
  "use strict";

  const api = window.LinkShortener;
  const RECENT_KEY = "link-shortener.recent";
  const MAX_RECENT = 20;
  const byId = function (id) { return document.getElementById(id); };

  // ---- This browser's links: codes only, kept in localStorage -------------

  function recentCodes() {
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter(function (code) { return api.CODE.test(code); }) : [];
    } catch (ignored) {
      return []; // storage blocked or garbled
    }
  }

  function saveRecent(codes) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(codes.slice(0, MAX_RECENT))); } catch (ignored) { /* this page only */ }
  }

  function remember(code) {
    saveRecent([code].concat(recentCodes().filter(function (known) { return known !== code; })));
  }

  // The short link is the go/ page next to this one, so a fork on another host works unchanged.
  function shortUrl(code) {
    return new URL("go/?c=" + code, location.href).href;
  }

  // ---- Rendering: user text only ever goes through textContent -------------

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function targetLink(url) {
    const link = element("a", "target", url);
    if (api.isWebUrl(url)) link.href = url;
    link.rel = "noopener noreferrer nofollow";
    return link;
  }

  async function copyText(text, button, fallbackInput) {
    try {
      await navigator.clipboard.writeText(text);
      const label = button.textContent;
      button.textContent = "Copied";
      setTimeout(function () { button.textContent = label; }, 1500);
    } catch (ignored) {
      if (fallbackInput) fallbackInput.select(); // clipboard blocked: leave it selected for a manual copy
    }
  }

  function clicksLabel(clicks) {
    const count = Number(clicks) || 0;
    return count === 1 ? "1 click" : count + " clicks";
  }

  function renderLink(link) {
    const item = element("li", "link");
    const head = element("div", "link-head");
    const short = element("a", "short", shortUrl(link.code).replace(/^https?:\/\//, ""));
    short.href = shortUrl(link.code);
    const clicks = element("span", "clicks", clicksLabel(link.clicks));
    head.append(short, clicks);
    const row = element("div", "link-row");
    const copy = element("button", "ghost small", "Copy");
    copy.type = "button";
    copy.setAttribute("aria-label", "Copy the short link for " + link.target_url);
    copy.addEventListener("click", function () { copyText(shortUrl(link.code), copy, null); });
    row.append(targetLink(link.target_url), copy);
    item.append(head, row);
    return item;
  }

  async function showRecent() {
    const codes = recentCodes();
    byId("recent-empty").hidden = codes.length > 0;
    byId("forget").hidden = codes.length === 0;
    if (codes.length === 0) {
      byId("recent").replaceChildren();
      return;
    }
    try {
      const links = await api.fetchLinks(codes);
      byId("recent").replaceChildren.apply(byId("recent"), links.map(renderLink));
      byId("recent-message").textContent = "";
    } catch (failure) {
      byId("recent-message").textContent = "Could not load your links: " + failure.message;
    }
  }

  function showResult(link) {
    byId("short-url").value = shortUrl(link.code);
    const target = byId("result-target");
    target.textContent = link.target_url;
    if (api.isWebUrl(link.target_url)) target.href = link.target_url;
    byId("result").hidden = false;
  }

  // ---- Actions ------------------------------------------------------------

  byId("shorten").addEventListener("submit", async function (event) {
    event.preventDefault();
    const url = byId("url").value.trim();
    const message = byId("form-message");
    const problem = api.checkUrl(url);
    if (problem) {
      message.textContent = problem;
      return;
    }
    byId("submit").disabled = true;
    message.textContent = "Shortening…";
    try {
      const link = await api.createLink(url);
      remember(link.code);
      showResult(link);
      byId("url").value = "";
      message.textContent = "";
      showRecent();
    } catch (failure) {
      message.textContent = failure.message;
    } finally {
      byId("submit").disabled = false;
    }
  });

  byId("copy").addEventListener("click", function () {
    copyText(byId("short-url").value, byId("copy"), byId("short-url"));
  });

  byId("refresh").addEventListener("click", showRecent);

  byId("forget").addEventListener("click", function () {
    saveRecent([]);
    byId("result").hidden = true;
    showRecent();
  });

  // Click counts change while the page sits in a background tab.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") showRecent();
  });

  showRecent();
})();
