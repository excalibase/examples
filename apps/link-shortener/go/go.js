// Redirect page for a short link (go/?c=<code>): count the click, then go to the target.
(function () {
  "use strict";

  const api = window.LinkShortener;
  const status = document.getElementById("go-status");
  const shown = document.getElementById("go-target");
  const code = new URLSearchParams(location.search).get("c") || "";

  function showTarget(url) {
    const link = document.createElement("a");
    link.textContent = url;
    link.href = url;
    link.rel = "noopener noreferrer nofollow";
    shown.replaceChildren(link);
    shown.hidden = false;
  }

  async function go() {
    if (!api.CODE.test(code)) {
      status.textContent = "This short link is not valid.";
      return;
    }
    try {
      const link = await api.hitLink(code);
      if (!link || !api.isWebUrl(link.target_url)) {
        status.textContent = "This short link does not exist.";
        return;
      }
      status.textContent = "Taking you to";
      showTarget(link.target_url);
      location.replace(link.target_url); // replace: the back button skips this page
    } catch (failure) {
      status.textContent = "Could not open this link right now: " + failure.message;
    }
  }

  go();
})();
