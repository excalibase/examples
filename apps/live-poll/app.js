// Live poll: plain browser JavaScript against the Excalibase REST, GraphQL and realtime APIs.
// window.EXCALIBASE comes from /config.js: { url, projectId, key }.
(function () {
  "use strict";

  const CONFIG = window.EXCALIBASE;
  const REST = CONFIG.url + "/" + CONFIG.projectId + "/api/v1";
  const GRAPHQL = CONFIG.url + "/" + CONFIG.projectId + "/graphql";
  const REALTIME = CONFIG.url.replace(/^http/, "ws") + "/" + CONFIG.projectId + "/graphql";
  const TOKEN_URL = CONFIG.url + "/auth/default/" + CONFIG.projectId + "/token";
  const MIN_OPTIONS = 2;
  const MAX_OPTIONS = 6;
  const POLL_EVERY_MS = 3000;
  const RECONNECT_MS = 15000;
  const ACK_TIMEOUT_MS = 5000;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const state = { poll: null, options: [], counts: {}, myChoice: null };
  let accessToken = null;

  // ---- API -------------------------------------------------------------

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

  function postJson(path, body, prefer) {
    const headers = { "Content-Type": "application/json" };
    if (prefer) headers.Prefer = prefer;
    return call(REST + "/" + path, { method: "POST", headers: headers, body: JSON.stringify(body) });
  }

  async function createPoll(question, labels) {
    const created = (await readJson(await postJson("live_poll_polls", { question: question }, "return=representation"))).data;
    const poll = Array.isArray(created) ? created[0] : created;
    const rows = labels.map(function (label, position) {
      return { poll_id: poll.id, position: position, label: label };
    });
    await readJson(await postJson("live_poll_options", rows));
    return poll.id;
  }

  async function fetchPoll(pollId) {
    const pollQuery = new URLSearchParams({ select: "id,question,created_at", id: "eq." + pollId });
    const optionQuery = new URLSearchParams({
      select: "id,position,label", poll_id: "eq." + pollId, order: "position.asc",
    });
    const answers = await Promise.all([
      call(REST + "/live_poll_polls?" + pollQuery).then(readJson),
      call(REST + "/live_poll_options?" + optionQuery).then(readJson),
    ]);
    return { poll: (answers[0].data || [])[0] || null, options: answers[1].data || [] };
  }

  // One GraphQL request with an aliased aggregate per option. Ids are server integers.
  async function fetchCounts(optionIds) {
    if (optionIds.length === 0) return {};
    const fields = optionIds.map(function (id) {
      return "o" + id + ": publicLivePollVotesAggregate(where: {option_id: {eq: " + Number(id) + "}}) { count }";
    });
    const answer = await call(GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ " + fields.join(" ") + " }" }),
    });
    const body = await readJson(answer);
    if (body.errors) throw new Error(body.errors[0].message);
    const counts = {};
    optionIds.forEach(function (id) { counts[id] = body.data["o" + id].count; });
    return counts;
  }

  // UNIQUE (poll_id, voter_id) rejects a second vote from the same browser.
  async function castVote(optionId) {
    const answer = await postJson("live_poll_votes", { poll_id: state.poll.id, option_id: optionId, voter_id: voterId() });
    return answer.ok;
  }

  // ---- This browser: a random voter id and the choices it made -----------

  function stored(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (ignored) {
      return fallback; // storage blocked
    }
  }

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (ignored) { /* keep for this page only */ }
  }

  let sessionVoterId = null;
  function voterId() {
    const KEY = "live-poll.voter-id";
    sessionVoterId = sessionVoterId || stored(KEY, null) || crypto.randomUUID();
    store(KEY, sessionVoterId);
    return sessionVoterId;
  }

  function myChoiceKey(pollId) { return "live-poll.choice." + pollId; }

  // ---- Rendering: user text only ever goes through textContent -----------

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const byId = function (id) { return document.getElementById(id); };

  // Built once per poll; renderPoll() then only updates them, so the bars animate.
  let choiceNodes = {};
  function buildChoices() {
    choiceNodes = {};
    byId("choices").replaceChildren.apply(byId("choices"), state.options.map(function (option) {
      const item = element("li", "choice");
      const button = element("button", "choice-button");
      button.type = "button";
      button.addEventListener("click", function () { onVote(option.id); });
      const bar = element("span", "bar");
      const row = element("span", "choice-row");
      const figures = element("span", "figures");
      row.append(element("span", "label", option.label), figures);
      button.append(bar, row);
      item.append(button);
      choiceNodes[option.id] = { item: item, button: button, bar: bar, figures: figures };
      return item;
    }));
  }

  function renderChoice(option, total, leader) {
    const nodes = choiceNodes[option.id];
    const votes = state.counts[option.id] || 0;
    const percent = total === 0 ? 0 : Math.round((votes / total) * 100);
    const voted = state.myChoice !== null;
    nodes.item.classList.toggle("mine", option.id === state.myChoice);
    nodes.item.classList.toggle("leader", voted && votes === leader && votes > 0);
    nodes.button.disabled = voted;
    nodes.button.setAttribute("aria-label", voted
      ? option.label + ": " + votes + " votes, " + percent + "%"
      : "Vote for " + option.label);
    nodes.bar.style.width = (voted ? percent : 0) + "%"; // CSSOM: allowed by style-src 'self'
    nodes.figures.hidden = !voted;
    nodes.figures.textContent = percent + "% · " + votes;
  }

  function renderPoll() {
    const counts = state.options.map(function (option) { return state.counts[option.id] || 0; });
    const total = counts.reduce(function (sum, count) { return sum + count; }, 0);
    const leader = Math.max.apply(null, counts.concat(0));
    byId("poll-question").textContent = state.poll.question;
    byId("poll-hint").textContent = state.myChoice === null
      ? "Tap an option to vote. You get one vote in this browser."
      : "Thanks for voting. Results update live.";
    state.options.forEach(function (option) { renderChoice(option, total, leader); });
    byId("total").textContent = String(total);
  }

  function setLive(mode) {
    const labels = { live: "Live", polling: "Updating every 3 s", connecting: "Connecting…" };
    byId("live").className = "live is-" + mode;
    byId("live-text").textContent = labels[mode];
  }

  // ---- Live results: a GraphQL subscription, polling as the fallback -----

  let refreshTimer = null;
  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshCounts, 250);
  }

  async function refreshCounts() {
    try {
      state.counts = await fetchCounts(state.options.map(function (option) { return option.id; }));
      renderPoll();
    } catch (failure) {
      byId("poll-message").textContent = "Could not refresh the results: " + failure.message;
    }
  }

  let pollTimer = null;
  function startPolling() {
    setLive("polling");
    if (!pollTimer) pollTimer = setInterval(refreshCounts, POLL_EVERY_MS);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function onSocketMessage(socket, message) {
    if (message.type === "connection_ack") {
      socket.acked = true;
      socket.send(JSON.stringify({
        type: "subscribe", id: "votes",
        payload: { query: "subscription { publicLivePollVotesChanges { operation data } }" },
      }));
      stopPolling();
      setLive("live");
      refreshCounts(); // catch up on votes cast while we were away
    } else if (message.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
    } else if (message.type === "next") {
      const change = message.payload && message.payload.data && message.payload.data.publicLivePollVotesChanges;
      if (change && change.data && change.data.poll_id === state.poll.id) refreshSoon();
    } else if (message.type === "error" || message.type === "connection_error") {
      socket.close();
    }
  }

  // A browser cannot set headers on a WebSocket, so the token goes in connection_init.
  async function connectRealtime() {
    let socket = null;
    try {
      await signIn(); // a fresh token for a long-lived socket
      socket = new WebSocket(REALTIME, "graphql-transport-ws");
    } catch (failure) {
      startPolling();
      setTimeout(connectRealtime, RECONNECT_MS);
      return;
    }
    socket.onopen = function () {
      socket.send(JSON.stringify({
        type: "connection_init",
        payload: { Authorization: "Bearer " + accessToken, headers: { "X-Excalibase-Publishable-Key": CONFIG.key } },
      }));
    };
    socket.onmessage = function (event) {
      let message = null;
      try { message = JSON.parse(event.data); } catch (ignored) { return; }
      onSocketMessage(socket, message);
    };
    // An open socket that never acknowledges must not leave the page frozen.
    setTimeout(function () { if (!socket.acked) startPolling(); }, ACK_TIMEOUT_MS);
    socket.onclose = function () {
      startPolling();
      setTimeout(connectRealtime, RECONNECT_MS);
    };
  }

  // ---- Actions ----------------------------------------------------------

  async function onVote(optionId) {
    if (state.myChoice !== null) return;
    state.myChoice = optionId;
    state.counts[optionId] = (state.counts[optionId] || 0) + 1;
    renderPoll();
    byId("poll-message").textContent = "";
    try {
      if (!(await castVote(optionId))) throw new Error("refused");
      store(myChoiceKey(state.poll.id), String(optionId));
    } catch (failure) {
      state.myChoice = null;
      byId("poll-message").textContent = "Your vote did not go through. If you already voted on this poll in this browser, it still counts once.";
    }
    refreshCounts();
  }

  async function showPoll(pollId) {
    byId("page-message").textContent = "Loading…";
    try {
      const found = await fetchPoll(pollId);
      if (!found.poll) {
        byId("page-message").textContent = "This poll does not exist. Create a new one below.";
        return showCreate();
      }
      state.poll = found.poll;
      state.options = found.options;
      const choice = Number(stored(myChoiceKey(pollId), ""));
      state.myChoice = state.options.some(function (option) { return option.id === choice; }) ? choice : null;
      state.counts = await fetchCounts(state.options.map(function (option) { return option.id; }));
      byId("share-url").value = location.origin + location.pathname + "?p=" + pollId;
      document.title = state.poll.question + " · Live Poll";
      byId("page-message").textContent = "";
      byId("poll-view").hidden = false;
      buildChoices();
      renderPoll();
      setLive("connecting");
      connectRealtime();
    } catch (failure) {
      byId("page-message").textContent = "Could not load the poll: " + failure.message;
    }
  }

  // ---- Create form ------------------------------------------------------

  function addOptionInput(value) {
    const list = byId("option-inputs");
    const item = element("li", "option-input");
    const input = element("input");
    input.type = "text";
    input.maxLength = 80;
    input.value = value || "";
    input.placeholder = "Option " + (list.children.length + 1);
    input.setAttribute("aria-label", "Option " + (list.children.length + 1));
    const remove = element("button", "ghost remove", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove option");
    remove.addEventListener("click", function () { item.remove(); syncOptionButtons(); });
    item.append(input, remove);
    list.append(item);
    syncOptionButtons();
    return input;
  }

  function syncOptionButtons() {
    const items = byId("option-inputs").children;
    byId("add-option").hidden = items.length >= MAX_OPTIONS;
    Array.prototype.forEach.call(items, function (item) {
      item.querySelector(".remove").hidden = items.length <= MIN_OPTIONS;
    });
  }

  function readForm() {
    const question = byId("question").value.trim();
    const labels = Array.prototype.map.call(byId("option-inputs").querySelectorAll("input"), function (input) {
      return input.value.trim();
    }).filter(function (label) { return label.length > 0; });
    if (question.length < 3) return { error: "Write a question of at least 3 characters." };
    if (labels.length < MIN_OPTIONS) return { error: "Add at least two options." };
    if (new Set(labels).size !== labels.length) return { error: "Each option must be different." };
    return { question: question, labels: labels };
  }

  function showCreate() {
    byId("create-view").hidden = false;
    if (byId("option-inputs").children.length === 0) {
      addOptionInput("");
      addOptionInput("");
    }
  }

  byId("add-option").addEventListener("click", function () { addOptionInput("").focus(); });

  byId("create-view").addEventListener("submit", async function (event) {
    event.preventDefault();
    const form = readForm();
    const message = byId("create-message");
    if (form.error) {
      message.textContent = form.error;
      return;
    }
    byId("create").disabled = true;
    message.textContent = "Creating…";
    try {
      const pollId = await createPoll(form.question, form.labels);
      location.assign("?p=" + pollId);
    } catch (failure) {
      message.textContent = "Could not create the poll: " + failure.message;
      byId("create").disabled = false;
    }
  });

  byId("copy").addEventListener("click", async function () {
    const url = byId("share-url");
    try {
      await navigator.clipboard.writeText(url.value);
      byId("copy").textContent = "Copied";
    } catch (ignored) {
      url.select(); // clipboard blocked: leave it selected for a manual copy
    }
  });

  const pollId = new URLSearchParams(location.search).get("p");
  if (pollId && UUID.test(pollId)) {
    showPoll(pollId);
  } else {
    if (pollId) byId("page-message").textContent = "That link is not a valid poll link. Create a new poll below.";
    showCreate();
  }
})();
