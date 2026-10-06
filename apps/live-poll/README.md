# Live Poll

Create a poll, share the link, and watch the results bars move as people vote, live for everyone.

**Live:** https://examples-jfp7kx46kb.apps.excalibase.io/live-poll/

## What it shows

| Excalibase feature | Where |
| --- | --- |
| Publishable key sign-in (anon role) | `signIn()` in [app.js](app.js) |
| REST inserts with `Prefer: return=representation` | creating the poll returns its `id`; options go in as one array insert |
| REST reads with filters and ordering | `GET live_poll_options?poll_id=eq.<id>&order=position.asc` |
| GraphQL aggregates (one request, one alias per option) | vote counts via `publicLivePollVotesAggregate` |
| Realtime: GraphQL subscription over WebSocket (`graphql-transport-ws`) | `subscription { publicLivePollVotesChanges { operation data } }` |
| Column-level permissions | anon inserts only `question`, only `poll_id`/`position`/`label`, only `poll_id`/`option_id`/`voter_id`; it can never read `voter_id` |
| Aggregate permission (`allowAggregations`) | anon may count votes |
| Constraints as the source of truth | `UNIQUE (poll_id, voter_id)` blocks double votes; a composite foreign key makes a vote's option belong to its poll; `position BETWEEN 0 AND 5` caps a poll at 6 options; a trigger refuses options added to a poll older than 2 minutes |
| Container app hosting | served from the `site/` nginx image |

No update or delete permission exists for anon, so nobody can change a question, edit an option or remove a vote.

### How the live results work

The page opens a WebSocket to `wss://api.excalibase.io/<project>/graphql` with the `graphql-transport-ws` protocol. A browser cannot set headers on a WebSocket, so the access token goes in the `connection_init` message. After `connection_ack` it subscribes to `publicLivePollVotesChanges`; each vote insert arrives as an event (with `voter_id` stripped, because anon cannot read it). Events for other polls are ignored; an event for this poll triggers one aggregate request, so the bars always show the server's counts.

**Fallback:** if the socket cannot connect, is refused, never acknowledges within 5 seconds or drops, the page switches to polling the counts every 3 seconds (the badge reads "Updating every 3 s") and tries the socket again every 15 seconds.

Realtime is opt-in per table: `live_poll_votes` must be added to the project's realtime publication (Studio, Realtime). Without it the socket connects but no events arrive, and only the reconnect catch-up keeps the page fresh.

### One vote per browser

Each browser gets a random `voter_id` (a UUID in `localStorage`). The database's unique key on `(poll_id, voter_id)` is what actually refuses a second vote; the page also remembers your choice to show it with a check mark. Clearing site data gives you a new voter id, so this is a fair-play limit, not an identity check.

All user text (questions and options) is rendered with `textContent`, never `innerHTML`.

## Files

- [schema.sql](schema.sql): the migration applied to the project
- [permissions.json](permissions.json): the six anon permissions
- [index.html](index.html), [app.js](app.js), [style.css](style.css): the page, no dependencies

## Run it on your own project in 5 steps

1. **Create a project** at [app.excalibase.io](https://app.excalibase.io) and create a publishable key (Studio, API keys, or the `create_publishable_key` MCP tool).
2. **Apply the schema**: paste [schema.sql](schema.sql) into the Studio SQL editor, or ask your AI tool to `apply_migration` it.
3. **Set the permissions** in [permissions.json](permissions.json) (Studio, Permissions, or one `set_permission` call each), then **turn on realtime** for `live_poll_votes` in Studio, Realtime.
4. **Point the page at your project**: edit `site/config.js` with your project id and publishable key. To try it locally, add `http://localhost:8080` to the project's CORS list in Studio and run `docker build -f site/Dockerfile -t examples . && docker run -p 8080:8080 examples`.
5. **Host it**: create a container app (`create_app`, port 8080, health check `/healthz`), then push and let the workflow in `.github/workflows/deploy.yml` deploy it, or call `deploy_app`.

### With an AI tool

Connect the Excalibase MCP server (see the [root README](../../README.md#build-your-own-with-your-ai-tool)) and ask:

> Apply apps/live-poll/schema.sql to my project, set the permissions in apps/live-poll/permissions.json for the anon role, then check every request app.js makes with test_api_request, including that anon cannot update or delete, cannot vote twice and cannot vote for another poll's option.

Realtime has no MCP tool yet, so switch it on for `live_poll_votes` in Studio.
