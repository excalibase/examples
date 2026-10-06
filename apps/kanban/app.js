// Kanban: plain browser JavaScript against Excalibase end-user auth, REST and GraphQL subscriptions.
// window.EXCALIBASE comes from /config.js: { url, projectId, key }.
(function () {
  "use strict";

  const CONFIG = window.EXCALIBASE;
  const AUTH = CONFIG.url + "/auth/default/" + CONFIG.projectId;
  const REST = CONFIG.url + "/" + CONFIG.projectId + "/api/v1";
  const REALTIME = CONFIG.url.replace(/^http/, "ws") + "/" + CONFIG.projectId + "/graphql";
  const SESSION_KEY = "kanban.session." + CONFIG.projectId;
  const BOARD_KEY = "kanban.board." + CONFIG.projectId;
  const STATUSES = ["todo", "doing", "done"];
  const STATUS_LABELS = { todo: "To do", doing: "Doing", done: "Done" };
  const CARD_COLUMNS = "id,board_id,title,description,status,position,updated_at";
  const STEP = 1024;

  const state = { session: null, boards: [], boardId: null, cards: new Map(), editing: null, dragId: null };
  const $ = function (id) { return document.getElementById(id); };

  // ---- Storage (a private window may refuse it; the page still works) ----

  function readStored(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (ignored) { return null; }
  }
  function writeStored(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (ignored) { /* storage unavailable: the session lasts for this tab only */ }
  }

  // ---- End-user auth ------------------------------------------------------

  async function authPost(path, body) {
    const answer = await fetch(AUTH + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await answer.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (ignored) { data = {}; }
    if (!answer.ok) {
      const error = new Error(authErrorMessage(answer.status, data));
      error.status = answer.status;
      throw error;
    }
    return data;
  }

  function authErrorMessage(status, data) {
    if (status === 401) return "Wrong email or password.";
    if (status === 409) return "That email already has an account. Sign in instead.";
    if (status === 403) return data.error || "Please verify your email address first.";
    if (status === 429) return "Too many attempts. Wait a minute and try again.";
    return data.error || data.message || "Something went wrong (" + status + ").";
  }

  function adoptSession(data) {
    if (!data.accessToken) throw new Error(data.message || "Check your inbox to verify your email, then sign in.");
    const session = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + (data.expiresIn || 3600) * 1000,
      user: data.user || (state.session && state.session.user),
    };
    state.session = session;
    writeStored(SESSION_KEY, session);
    return session;
  }

  // Refresh tokens rotate, so only one tab refreshes at a time and the others pick up its result.
  async function refreshSession() {
    const used = state.session && state.session.refreshToken;
    const run = async function () {
      const stored = readStored(SESSION_KEY);
      if (stored && stored.refreshToken !== used && stored.expiresAt > Date.now() + 30000) {
        state.session = stored;
        return stored;
      }
      return adoptSession(await authPost("/token", { grant_type: "refresh_token", refresh_token: used }));
    };
    if (navigator.locks) return navigator.locks.request("kanban-refresh", run);
    return run();
  }

  async function validToken() {
    if (!state.session) throw new Error("Signed out");
    if (state.session.expiresAt - Date.now() < 60000) {
      try { await refreshSession(); } catch (error) { signedOut("Your session ended. Please sign in again."); throw error; }
    }
    return state.session.accessToken;
  }

  // ---- REST ---------------------------------------------------------------

  async function api(method, path, body, retried) {
    const token = await validToken();
    const answer = await fetch(REST + "/" + path, {
      method: method,
      headers: {
        Authorization: "Bearer " + token,
        "X-Excalibase-Publishable-Key": CONFIG.key,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (answer.status === 401 && !retried) {
      state.session.expiresAt = 0;
      return api(method, path, body, true);
    }
    const text = await answer.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (ignored) { data = {}; }
    if (!answer.ok) throw new Error(data.message || data.error || "Request failed (" + answer.status + ")");
    const rows = data.data;
    return Array.isArray(rows) ? rows : rows ? [rows] : [];
  }

  const db = {
    boards: function () { return api("GET", "kanban_boards?select=id,title,created_at&order=created_at.asc,id.asc"); },
    createBoard: function (title) { return api("POST", "kanban_boards", { title: title }); },
    renameBoard: function (id, title) { return api("PATCH", "kanban_boards?id=eq." + id, { title: title }); },
    deleteBoard: function (id) { return api("DELETE", "kanban_boards?id=eq." + id); },
    cards: function (boardId) {
      return api("GET", "kanban_cards?select=" + CARD_COLUMNS + "&board_id=eq." + boardId + "&order=position.asc,id.asc&limit=500");
    },
    createCard: function (card) { return api("POST", "kanban_cards", card); },
    updateCard: function (id, changes) { return api("PATCH", "kanban_cards?id=eq." + id, changes); },
    deleteCard: function (id) { return api("DELETE", "kanban_cards?id=eq." + id); },
  };

  // ---- Realtime (graphql-transport-ws) -------------------------------------
  // Row permissions apply to events too: a socket only hears about its own user's rows.

  const live = { socket: null, retry: 0, timer: null, wanted: false };
  const SUBSCRIPTIONS = {
    cards: "subscription { publicKanbanCardsChanges { operation data } }",
    boards: "subscription { publicKanbanBoardsChanges { operation data } }",
  };

  async function connectLive() {
    disconnectLive();
    live.wanted = true;
    let token;
    try { token = await validToken(); } catch (ignored) { return; }
    const socket = new WebSocket(REALTIME, "graphql-transport-ws");
    live.socket = socket;
    socket.onopen = function () {
      send(socket, { type: "connection_init", payload: { Authorization: "Bearer " + token, headers: { "X-Excalibase-Publishable-Key": CONFIG.key } } });
    };
    socket.onmessage = function (event) { onLiveMessage(socket, event); };
    socket.onclose = function () { onLiveClosed(socket); };
  }

  function send(socket, message) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function onLiveMessage(socket, event) {
    let message;
    try { message = JSON.parse(event.data); } catch (ignored) { return; }
    if (message.type === "connection_ack") {
      Object.keys(SUBSCRIPTIONS).forEach(function (id) {
        send(socket, { type: "subscribe", id: id, payload: { query: SUBSCRIPTIONS[id] } });
      });
      const reconnected = live.retry > 0;
      live.retry = 0;
      setLive(true);
      if (reconnected) reloadAll();
    } else if (message.type === "ping") {
      send(socket, { type: "pong" });
    } else if (message.type === "next" && message.payload && message.payload.data) {
      const change = message.payload.data[message.id === "cards" ? "publicKanbanCardsChanges" : "publicKanbanBoardsChanges"];
      if (change) applyChange(message.id, change);
    }
  }

  function onLiveClosed(socket) {
    if (live.socket !== socket) return;
    live.socket = null;
    setLive(false);
    if (!live.wanted) return;
    live.retry += 1;
    const delay = Math.min(30000, 1000 * Math.pow(2, live.retry - 1));
    live.timer = setTimeout(connectLive, delay);
  }

  function disconnectLive() {
    live.wanted = false;
    clearTimeout(live.timer);
    if (live.socket) {
      const socket = live.socket;
      live.socket = null;
      socket.close(1000);
    }
    setLive(false);
  }

  function setLive(on) {
    const badge = $("live");
    badge.textContent = on ? "live" : "offline";
    badge.classList.toggle("on", on);
  }

  function applyChange(kind, change) {
    const op = change.operation;
    if (op !== "INSERT" && op !== "UPDATE" && op !== "DELETE") return;
    const row = op === "UPDATE" ? change.data && change.data.new : change.data;
    if (!row || row.id === undefined) return;
    if (kind === "boards") {
      loadBoards().catch(showBoardError);
      return;
    }
    if (op === "DELETE") {
      if (state.cards.delete(Number(row.id))) renderCards();
    } else if (Number(row.board_id) === state.boardId) {
      mergeCard(row);
      renderCards();
    }
  }

  // ---- State --------------------------------------------------------------

  function mergeCard(row) {
    const id = Number(row.id);
    const current = state.cards.get(id) || {};
    state.cards.set(id, Object.assign({}, current, row, { id: id, board_id: Number(row.board_id), position: Number(row.position) }));
  }

  function cardsIn(status) {
    return Array.from(state.cards.values())
      .filter(function (card) { return card.status === status; })
      .sort(function (a, b) { return a.position - b.position || a.id - b.id; });
  }

  async function loadBoards() {
    let boards = await db.boards();
    if (boards.length === 0) boards = await db.createBoard("My board");
    state.boards = boards.map(function (board) { return Object.assign({}, board, { id: Number(board.id) }); });
    const remembered = readStored(BOARD_KEY);
    const keep = state.boards.find(function (board) { return board.id === state.boardId; }) ||
      state.boards.find(function (board) { return board.id === remembered; }) || state.boards[0];
    renderBoards();
    if (keep.id !== state.boardId) await selectBoard(keep.id);
  }

  async function selectBoard(id) {
    state.boardId = id;
    writeStored(BOARD_KEY, id);
    $("board-select").value = String(id);
    state.cards = new Map();
    renderCards();
    const rows = await db.cards(id);
    if (state.boardId !== id) return;
    rows.forEach(mergeCard);
    renderCards();
  }

  async function reloadAll() {
    try {
      await loadBoards();
      if (state.boardId !== null) await selectBoard(state.boardId);
    } catch (error) { showBoardError(error); }
  }

  // ---- Rendering (user text only ever goes through textContent) -------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderBoards() {
    const select = $("board-select");
    select.replaceChildren.apply(select, state.boards.map(function (board) {
      const option = el("option", "", board.title);
      option.value = String(board.id);
      return option;
    }));
    if (state.boardId !== null) select.value = String(state.boardId);
    $("board-delete").disabled = state.boards.length <= 1;
  }

  function renderCards() {
    const focusedId = document.activeElement && document.activeElement.closest(".kcard") &&
      document.activeElement.closest(".kcard").dataset.id;
    const focusedAction = document.activeElement && document.activeElement.dataset.action;
    STATUSES.forEach(function (status) {
      const list = document.querySelector('ol.cards[data-status="' + status + '"]');
      const cards = cardsIn(status);
      list.replaceChildren.apply(list, cards.map(function (card, index) { return cardNode(card, index, cards.length); }));
      document.querySelector('[data-count="' + status + '"]').textContent = String(cards.length);
    });
    if (focusedId) restoreFocus(focusedId, focusedAction);
  }

  function restoreFocus(id, action) {
    const card = document.querySelector('.kcard[data-id="' + id + '"]');
    if (!card) return;
    const target = (action && card.querySelector('[data-action="' + action + '"]:not(:disabled)')) || card.querySelector(".kcard-open");
    if (target) target.focus();
  }

  function cardNode(card, index, total) {
    const item = el("li", "kcard");
    item.dataset.id = String(card.id);
    item.draggable = true;
    const open = el("button", "kcard-open");
    open.type = "button";
    open.dataset.action = "edit";
    open.appendChild(el("span", "kcard-title", card.title));
    if (card.description) open.appendChild(el("span", "kcard-notes", card.description));
    item.appendChild(open);
    item.appendChild(cardActions(card, index, total));
    return item;
  }

  function cardActions(card, index, total) {
    const column = STATUSES.indexOf(card.status);
    const actions = el("div", "kcard-actions");
    actions.appendChild(actionButton("left", "←", "Move to " + (STATUS_LABELS[STATUSES[column - 1]] || ""), column === 0));
    actions.appendChild(actionButton("up", "↑", "Move up", index === 0));
    actions.appendChild(actionButton("down", "↓", "Move down", index === total - 1));
    actions.appendChild(actionButton("right", "→", "Move to " + (STATUS_LABELS[STATUSES[column + 1]] || ""), column === STATUSES.length - 1));
    actions.appendChild(actionButton("delete", "×", "Delete card", false));
    actions.querySelectorAll("button").forEach(function (button) {
      button.setAttribute("aria-label", button.title + ": " + card.title);
    });
    return actions;
  }

  function actionButton(action, symbol, label, disabled) {
    const button = el("button", "icon", symbol);
    button.type = "button";
    button.dataset.action = action;
    button.title = label;
    button.disabled = disabled;
    return button;
  }

  // ---- Moving cards ---------------------------------------------------------

  // A position between the neighbours at `index` of `status`, ignoring the moving card itself.
  function positionAt(status, index, movingId) {
    const others = cardsIn(status).filter(function (card) { return card.id !== movingId; });
    const before = others[index - 1];
    const after = others[index];
    if (!before && !after) return STEP;
    if (!before) return after.position - STEP;
    if (!after) return before.position + STEP;
    return (before.position + after.position) / 2;
  }

  async function moveCard(id, status, index) {
    const card = state.cards.get(id);
    if (!card) return;
    const position = positionAt(status, index, id);
    if (card.status === status && card.position === position) return;
    const previous = Object.assign({}, card);
    mergeCard(Object.assign({}, card, { status: status, position: position }));
    renderCards();
    try {
      (await db.updateCard(id, { status: status, position: position })).forEach(mergeCard);
    } catch (error) {
      state.cards.set(id, previous);
      showBoardError(error);
    }
    renderCards();
  }

  function moveBy(id, action) {
    const card = state.cards.get(id);
    const column = STATUSES.indexOf(card.status);
    const index = cardsIn(card.status).findIndex(function (other) { return other.id === id; });
    if (action === "up") return moveCard(id, card.status, index - 1);
    if (action === "down") return moveCard(id, card.status, index + 1);
    const target = STATUSES[column + (action === "left" ? -1 : 1)];
    return moveCard(id, target, cardsIn(target).length);
  }

  function dropIndex(list, clientY) {
    const items = Array.from(list.querySelectorAll(".kcard")).filter(function (item) {
      return Number(item.dataset.id) !== state.dragId;
    });
    const next = items.findIndex(function (item) {
      const box = item.getBoundingClientRect();
      return clientY < box.top + box.height / 2;
    });
    return next === -1 ? items.length : next;
  }

  function clearDragMarks() {
    state.dragId = null;
    document.querySelectorAll(".dragging, .drop-target").forEach(function (node) {
      node.classList.remove("dragging", "drop-target");
    });
  }

  function wireDragAndDrop() {
    const columns = $("columns");
    columns.addEventListener("dragstart", function (event) {
      const item = event.target.closest && event.target.closest(".kcard");
      if (!item) return;
      state.dragId = Number(item.dataset.id);
      item.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.dataset.id);
    });
    // The dragged card may be re-rendered before dragend fires, so listen on the document.
    document.addEventListener("dragend", clearDragMarks);
    columns.addEventListener("dragover", function (event) {
      const column = event.target.closest(".column");
      if (!column || state.dragId === null) return;
      event.preventDefault();
      document.querySelectorAll(".drop-target").forEach(function (node) { node.classList.remove("drop-target"); });
      column.classList.add("drop-target");
    });
    columns.addEventListener("drop", function (event) {
      const column = event.target.closest(".column");
      if (!column || state.dragId === null) return;
      event.preventDefault();
      const list = column.querySelector("ol.cards");
      const id = state.dragId;
      const index = dropIndex(list, event.clientY);
      clearDragMarks();
      moveCard(id, column.dataset.status, index);
    });
  }

  // ---- Card editing ---------------------------------------------------------

  function openEditor(id) {
    const card = state.cards.get(id);
    if (!card) return;
    state.editing = id;
    $("editor-card-title").value = card.title;
    $("editor-card-description").value = card.description || "";
    $("editor-card-status").value = card.status;
    $("editor-message").textContent = "";
    $("editor").showModal();
    $("editor-card-title").focus();
  }

  async function saveEditor(event) {
    event.preventDefault();
    const id = state.editing;
    const card = state.cards.get(id);
    const title = $("editor-card-title").value.trim();
    if (!title) { $("editor-message").textContent = "A card needs a title."; return; }
    const status = $("editor-card-status").value;
    const changes = { title: title, description: $("editor-card-description").value.trim() || null };
    if (card && status !== card.status) {
      changes.status = status;
      changes.position = positionAt(status, cardsIn(status).length, id);
    }
    $("editor-save").disabled = true;
    try {
      (await db.updateCard(id, changes)).forEach(mergeCard);
      renderCards();
      $("editor").close();
    } catch (error) {
      $("editor-message").textContent = error.message;
    } finally {
      $("editor-save").disabled = false;
    }
  }

  async function removeCard(id) {
    const card = state.cards.get(id);
    if (!card || !window.confirm('Delete "' + card.title + '"?')) return false;
    try {
      await db.deleteCard(id);
      state.cards.delete(id);
      renderCards();
      return true;
    } catch (error) {
      showBoardError(error);
      return false;
    }
  }

  async function addCard(event) {
    event.preventDefault();
    const form = event.target;
    const input = form.querySelector("input");
    const title = input.value.trim();
    if (!title) return;
    const status = form.dataset.status;
    input.disabled = true;
    try {
      const rows = await db.createCard({ board_id: state.boardId, title: title, status: status, position: positionAt(status, cardsIn(status).length) });
      rows.forEach(mergeCard);
      renderCards();
      input.value = "";
    } catch (error) {
      showBoardError(error);
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  // ---- Boards ---------------------------------------------------------------

  async function newBoard() {
    const title = (window.prompt("Name the new board", "New board") || "").trim();
    if (!title) return;
    try {
      const rows = await db.createBoard(title.slice(0, 80));
      await loadBoards();
      if (rows[0]) await selectBoard(Number(rows[0].id));
    } catch (error) { showBoardError(error); }
  }

  async function renameBoard() {
    const board = state.boards.find(function (item) { return item.id === state.boardId; });
    if (!board) return;
    const title = (window.prompt("Rename the board", board.title) || "").trim();
    if (!title || title === board.title) return;
    try {
      await db.renameBoard(board.id, title.slice(0, 80));
      await loadBoards();
    } catch (error) { showBoardError(error); }
  }

  async function deleteBoard() {
    const board = state.boards.find(function (item) { return item.id === state.boardId; });
    if (!board || !window.confirm('Delete the board "' + board.title + '" and all its cards?')) return;
    try {
      await db.deleteBoard(board.id);
      state.boardId = null;
      await loadBoards();
    } catch (error) { showBoardError(error); }
  }

  function showBoardError(error) {
    $("board-message").textContent = error && error.message ? error.message : "Something went wrong.";
  }

  // ---- Screens ----------------------------------------------------------------

  let signUpMode = false;

  function setMode(signUp) {
    signUpMode = signUp;
    $("tab-sign-in").setAttribute("aria-selected", String(!signUp));
    $("tab-sign-up").setAttribute("aria-selected", String(signUp));
    $("name-field").hidden = !signUp;
    $("password").autocomplete = signUp ? "new-password" : "current-password";
    $("auth-submit").textContent = signUp ? "Create account" : "Sign in";
    $("auth-message").textContent = "";
  }

  async function submitAuth(event) {
    event.preventDefault();
    const email = $("email").value.trim();
    const password = $("password").value;
    const fullName = $("full-name").value.trim();
    const message = $("auth-message");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { message.textContent = "Enter a valid email address."; return; }
    if (password.length < 8) { message.textContent = "Use a password of at least 8 characters."; return; }
    if (signUpMode && !fullName) { message.textContent = "Enter your name."; return; }
    $("auth-submit").disabled = true;
    message.textContent = signUpMode ? "Creating your account..." : "Signing in...";
    try {
      const data = signUpMode
        ? await authPost("/register", { email: email, password: password, fullName: fullName })
        : await authPost("/token", { grant_type: "password", email: email, password: password });
      adoptSession(data);
      $("password").value = "";
      await signedIn();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      $("auth-submit").disabled = false;
    }
  }

  async function signedIn() {
    $("auth").hidden = true;
    $("workspace").hidden = false;
    $("account").hidden = false;
    const user = state.session.user || {};
    $("who").textContent = user.fullName || user.email || "Signed in";
    $("board-message").textContent = "";
    connectLive();
    try { await loadBoards(); } catch (error) { showBoardError(error); }
  }

  function signedOut(reason) {
    disconnectLive();
    state.session = null;
    state.boards = [];
    state.boardId = null;
    state.cards = new Map();
    writeStored(SESSION_KEY, null);
    $("workspace").hidden = true;
    $("account").hidden = true;
    $("auth").hidden = false;
    setMode(false);
    $("auth-message").textContent = reason || "";
  }

  async function signOut() {
    const refreshToken = state.session && state.session.refreshToken;
    signedOut("You are signed out.");
    if (refreshToken) authPost("/logout", { refreshToken: refreshToken }).catch(function () { /* already signed out locally */ });
  }

  // Another tab signed in, refreshed or signed out.
  function onStorage(event) {
    if (event.key !== SESSION_KEY) return;
    const stored = readStored(SESSION_KEY);
    if (!stored) { if (state.session) signedOut("You signed out in another tab."); return; }
    const wasSignedIn = Boolean(state.session);
    state.session = stored;
    if (!wasSignedIn) signedIn();
  }

  // ---- Wiring -----------------------------------------------------------------

  function cardIdFrom(target) {
    const item = target.closest(".kcard");
    return item ? Number(item.dataset.id) : null;
  }

  function onColumnsClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;
    const id = cardIdFrom(button);
    if (id === null) return;
    const action = button.dataset.action;
    if (action === "edit") openEditor(id);
    else if (action === "delete") removeCard(id);
    else moveBy(id, action);
  }

  function wire() {
    $("tab-sign-in").addEventListener("click", function () { setMode(false); });
    $("tab-sign-up").addEventListener("click", function () { setMode(true); });
    $("auth-form").addEventListener("submit", submitAuth);
    $("sign-out").addEventListener("click", signOut);
    $("board-select").addEventListener("change", function (event) {
      selectBoard(Number(event.target.value)).catch(showBoardError);
    });
    $("board-new").addEventListener("click", newBoard);
    $("board-rename").addEventListener("click", renameBoard);
    $("board-delete").addEventListener("click", deleteBoard);
    document.querySelectorAll("form.add-card").forEach(function (form) { form.addEventListener("submit", addCard); });
    $("columns").addEventListener("click", onColumnsClick);
    $("editor-form").addEventListener("submit", saveEditor);
    $("editor-cancel").addEventListener("click", function () { $("editor").close(); });
    $("editor-delete").addEventListener("click", async function () {
      if (await removeCard(state.editing)) $("editor").close();
    });
    window.addEventListener("storage", onStorage);
    wireDragAndDrop();
  }

  wire();
  state.session = readStored(SESSION_KEY);
  if (state.session && state.session.refreshToken) signedIn();
  else signedOut("");
})();
