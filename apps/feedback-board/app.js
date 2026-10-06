// Feedback board: plain browser JavaScript against the Excalibase REST and GraphQL APIs.
// window.EXCALIBASE comes from /config.js: { url, projectId, key }.
(function () {
  "use strict";

  const CONFIG = window.EXCALIBASE;
  const REST = CONFIG.url + "/" + CONFIG.projectId + "/api/v1";
  const GRAPHQL = CONFIG.url + "/" + CONFIG.projectId + "/graphql";
  const TOKEN_URL = CONFIG.url + "/auth/default/" + CONFIG.projectId + "/token";
  const PAGE_SIZE = 50;
  const KIND_LABELS = { idea: "Idea", bug: "Bug", question: "Question", other: "Other" };
  const STATUS_LABELS = { open: "Open", planned: "Planned", done: "Done", wontfix: "Won't fix" };

  const state = { kind: "", posts: [], counts: {}, voted: new Set() };
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

  async function fetchPosts(kind) {
    const params = new URLSearchParams({
      select: "id,kind,body,author_name,status,created_at",
      order: "created_at.desc",
      limit: String(PAGE_SIZE),
    });
    if (kind) params.set("kind", "eq." + kind);
    return (await readJson(await call(REST + "/feedback_posts?" + params))).data || [];
  }

  // One GraphQL request with an aliased aggregate per post. Ids are server integers.
  async function fetchCounts(ids) {
    if (ids.length === 0) return {};
    const fields = ids.map(function (id) {
      return "p" + id + ": publicFeedbackVotesAggregate(where: {feedback_id: {eq: " + id + "}}) { count }";
    });
    const answer = await call(GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ " + fields.join(" ") + " }" }),
    });
    const body = await readJson(answer);
    if (body.errors) throw new Error(body.errors[0].message);
    const counts = {};
    ids.forEach(function (id) { counts[id] = body.data["p" + id].count; });
    return counts;
  }

  async function fetchMyVotes(ids) {
    if (ids.length === 0) return [];
    const params = new URLSearchParams({
      select: "feedback_id",
      voter_id: "eq." + voterId(),
      feedback_id: "in.(" + ids.join(",") + ")",
      limit: String(PAGE_SIZE),
    });
    const rows = (await readJson(await call(REST + "/feedback_votes?" + params))).data || [];
    return rows.map(function (row) { return row.feedback_id; });
  }

  async function createPost(post) {
    const answer = await call(REST + "/feedback_posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(post),
    });
    const data = (await readJson(answer)).data;
    return Array.isArray(data) ? data[0] : data;
  }

  // The (feedback_id, voter_id) primary key rejects a second vote from the same browser.
  async function castVote(feedbackId) {
    const answer = await call(REST + "/feedback_votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback_id: feedbackId, voter_id: voterId() }),
    });
    return answer.ok;
  }

  // ---- Voter id: one random uuid per browser -----------------------------

  function voterId() {
    const KEY = "feedback-board.voter-id";
    let id = null;
    try { id = localStorage.getItem(KEY); } catch (ignored) { /* storage blocked */ }
    if (!id) {
      id = crypto.randomUUID();
      try { localStorage.setItem(KEY, id); } catch (ignored) { /* keep for this page only */ }
    }
    return id;
  }

  // ---- Rendering: user text only ever goes through textContent -----------

  const list = document.getElementById("posts");
  const listMessage = document.getElementById("list-message");

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function timeAgo(iso) {
    const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const units = [["y", 31536000], ["mo", 2592000], ["d", 86400], ["h", 3600], ["m", 60]];
    for (const [unit, size] of units) {
      if (seconds >= size) return Math.floor(seconds / size) + unit + " ago";
    }
    return "just now";
  }

  function renderPost(post) {
    const item = element("li", "card post");
    const voted = state.voted.has(post.id);
    const vote = element("button", "vote" + (voted ? " voted" : ""));
    vote.type = "button";
    vote.disabled = voted;
    vote.setAttribute("aria-label", voted ? "You upvoted this" : "Upvote");
    vote.append(element("span", "arrow", "▲"), element("span", "count", String(state.counts[post.id] || 0)));
    vote.addEventListener("click", function () { onVote(post.id); });

    const content = element("div", "content");
    const meta = element("div", "meta");
    meta.append(
      element("span", "badge kind-" + post.kind, KIND_LABELS[post.kind] || post.kind),
      element("span", "badge status-" + post.status, STATUS_LABELS[post.status] || post.status)
    );
    const by = element("p", "byline");
    const time = element("time", "", timeAgo(post.created_at));
    time.dateTime = post.created_at;
    time.title = new Date(post.created_at).toLocaleString();
    by.append(document.createTextNode((post.author_name || "Anonymous") + " · "), time);

    content.append(meta, element("p", "body", post.body), by);
    item.append(vote, content);
    return item;
  }

  function render() {
    list.replaceChildren.apply(list, state.posts.map(renderPost));
    listMessage.textContent = state.posts.length === 0 ? "Nothing here yet. Be the first to post." : "";
  }

  // ---- Actions ----------------------------------------------------------

  async function load() {
    listMessage.textContent = "Loading…";
    try {
      const posts = await fetchPosts(state.kind);
      const ids = posts.map(function (post) { return post.id; });
      const results = await Promise.all([fetchCounts(ids), fetchMyVotes(ids)]);
      state.posts = posts;
      state.counts = results[0];
      state.voted = new Set(results[1]);
      render();
    } catch (failure) {
      listMessage.textContent = "Could not load feedback: " + failure.message;
    }
  }

  async function onVote(feedbackId) {
    if (state.voted.has(feedbackId)) return;
    state.voted.add(feedbackId);
    state.counts[feedbackId] = (state.counts[feedbackId] || 0) + 1;
    render();
    try {
      if (await castVote(feedbackId)) return;
      // Refused: either this browser already voted, or the post is gone. Ask the server.
      const mine = await fetchMyVotes([feedbackId]);
      if (mine.indexOf(feedbackId) === -1) throw new Error("vote refused");
      const counts = await fetchCounts([feedbackId]);
      state.counts[feedbackId] = counts[feedbackId];
    } catch (failure) {
      state.voted.delete(feedbackId);
      state.counts[feedbackId] = Math.max(0, state.counts[feedbackId] - 1);
      listMessage.textContent = "Your vote did not go through. Please try again.";
    }
    render();
  }

  const form = document.getElementById("post-form");
  const bodyInput = document.getElementById("body");
  const counter = document.getElementById("counter");
  const formMessage = document.getElementById("form-message");
  const submit = document.getElementById("submit");

  bodyInput.addEventListener("input", function () {
    counter.textContent = bodyInput.value.length + " / 1000";
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const body = bodyInput.value.trim();
    const author = form.author_name.value.trim();
    if (body.length < 3) {
      formMessage.textContent = "Write at least 3 characters.";
      return;
    }
    submit.disabled = true;
    formMessage.textContent = "Posting…";
    try {
      const post = await createPost({ kind: form.kind.value, body: body, author_name: author || null });
      form.reset();
      counter.textContent = "0 / 1000";
      formMessage.textContent = "Thanks! Your post is live.";
      if (!state.kind || state.kind === post.kind) {
        state.posts = [post].concat(state.posts);
        state.counts[post.id] = 0;
        render();
      }
    } catch (failure) {
      formMessage.textContent = "Could not post: " + failure.message;
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelectorAll(".filters button").forEach(function (button) {
    button.addEventListener("click", function () {
      document.querySelectorAll(".filters button").forEach(function (other) {
        other.classList.toggle("active", other === button);
      });
      state.kind = button.dataset.kind;
      load();
    });
  });

  load();
})();
