// Link shortener: the API calls both pages use (the shortener and the go/ redirect page).
// window.EXCALIBASE comes from /config.js: { url, projectId, key }.
(function () {
  "use strict";

  const CONFIG = window.EXCALIBASE;
  const REST = CONFIG.url + "/" + CONFIG.projectId + "/api/v1";
  const GRAPHQL = CONFIG.url + "/" + CONFIG.projectId + "/graphql";
  const TOKEN_URL = CONFIG.url + "/auth/default/" + CONFIG.projectId + "/token";
  const CODE = /^[0-9A-Za-z]{7}$/;
  const MAX_URL_LENGTH = 2048;

  let accessToken = null;

  async function signIn() {
    const answer = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "api_key", api_key: CONFIG.key }),
    });
    if (!answer.ok) throw new Error("Sign-in failed (" + answer.status + ")");
    accessToken = (await answer.json()).accessToken;
  }

  // Signs in on first use and once more if the token has expired.
  async function call(url, options, retried) {
    if (!accessToken) await signIn();
    const headers = Object.assign(
      { Authorization: "Bearer " + accessToken, "X-Excalibase-Publishable-Key": CONFIG.key },
      (options && options.headers) || {}
    );
    const answer = await fetch(url, Object.assign({}, options, { headers: headers }));
    if (answer.status === 401 && !retried) {
      accessToken = null;
      return call(url, options, true);
    }
    return answer;
  }

  async function readJson(answer) {
    const text = await answer.text();
    const body = text ? JSON.parse(text) : {};
    if (!answer.ok) throw new Error(body.message || body.error || "Request failed (" + answer.status + ")");
    return body;
  }

  // A database RAISE arrives as "ERROR: <text>\n  Where: ..."; keep only the sentence meant for people.
  function databaseMessage(raw) {
    const firstLine = String(raw || "").split("\n")[0].replace(/^ERROR:\s*/, "").trim();
    return firstLine || "The request failed.";
  }

  async function graphql(query, variables) {
    const body = await readJson(await call(GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: variables }),
    }));
    if (body.errors && body.errors.length) throw new Error(databaseMessage(body.errors[0].message));
    return body.data;
  }

  // The tracked function public.link_shortener_create: the database picks the code.
  async function createLink(url) {
    const data = await graphql(
      "mutation Create($url: String!) { publicLinkShortenerCreate(url: $url) { code target_url clicks created_at } }",
      { url: url }
    );
    return data.publicLinkShortenerCreate;
  }

  // The tracked function public.link_shortener_hit over REST: one click, counted atomically.
  // A single-row function answers its row, or no row for an unknown code.
  async function hitLink(code) {
    const body = await readJson(await call(REST + "/rpc/link_shortener_hit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ short_code: code }),
    }));
    return body.data && body.data.code ? body.data : null;
  }

  async function fetchLinks(codes) {
    const safe = codes.filter(function (code) { return CODE.test(code); });
    if (safe.length === 0) return [];
    const query = new URLSearchParams({
      select: "code,target_url,clicks,created_at",
      code: "in.(" + safe.join(",") + ")",
      order: "created_at.desc",
    });
    return (await readJson(await call(REST + "/link_shortener_links?" + query))).data || [];
  }

  // Mirrors the database rules for a quick message; the database still decides.
  function checkUrl(text) {
    if (!text) return "Enter a URL to shorten.";
    if (text.length > MAX_URL_LENGTH) return "That URL is longer than 2048 characters.";
    let parsed = null;
    try { parsed = new URL(text); } catch (ignored) { return "That does not look like a URL. Start it with https://"; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Only http:// and https:// URLs can be shortened.";
    if (parsed.username || parsed.password) return "URLs with a user name or password cannot be shortened.";
    return null;
  }

  // Only ever navigate to, or link, an http(s) URL, even though the database already guarantees it.
  function isWebUrl(text) {
    try {
      const protocol = new URL(text).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch (ignored) {
      return false;
    }
  }

  window.LinkShortener = {
    CODE: CODE,
    createLink: createLink,
    hitLink: hitLink,
    fetchLinks: fetchLinks,
    checkUrl: checkUrl,
    isWebUrl: isWebUrl,
  };
})();
