# Kanban

Sign up, then plan work on your own boards with To do, Doing and Done columns, drag and drop, and live sync across your open tabs.

**Live:** https://examples-jfp7kx46kb.apps.excalibase.io/kanban/

## What it shows

| Excalibase feature | Where |
| --- | --- |
| End-user sign-up and sign-in (not Studio accounts) | `POST /auth/default/<project>/register` and `/token` with `grant_type: password` in [app.js](app.js) |
| Refresh-token rotation, shared safely between tabs | `refreshSession()`: one tab refreshes under a Web Lock, the others pick up its tokens |
| Row permissions on the caller's id | every `user` permission filters `{"owner_id": {"_eq": "X-Excalibase-User-Id"}}` |
| Column presets from the session | inserts `set` `owner_id` from `X-Excalibase-User-Id`; the client cannot send `owner_id` at all |
| Column-level permissions | cards can update `title`, `description`, `status`, `position` only; `owner_id`, `board_id` and timestamps are server-owned |
| Constraints as the source of truth | `CHECK`s on status and lengths; a composite foreign key `(board_id, owner_id)` keeps a card on its owner's board |
| REST reads and writes with `Prefer: return=representation` | boards and cards |
| Realtime: GraphQL subscriptions over WebSocket | `publicKanbanCardsChanges` and `publicKanbanBoardsChanges` (`graphql-transport-ws`); events pass through the same row permissions, so a socket only hears about its own user's rows |
| Container app hosting | served from the `site/` nginx image |

The `anon` role (the publishable key alone) has no permission on either table, so the API answers 404 for them until a user signs in.

All user text is rendered with `textContent`, never `innerHTML`. Cards move with drag and drop, or with the arrow buttons on each card (keyboard and touch friendly).

### About signing up

Sign-up on this demo is real: it creates an end-user account in the shared example project. The project does not require email verification, so you are signed in right away and no email is sent. An address that already has an account is refused with 409, and the page asks you to sign in instead. Accounts and boards are only visible to their owner. Passwords must be at least 8 characters, at most 256 bytes and not only spaces; the auth service enforces this and the page checks the length first.

If your own project requires email verification, sign-up returns no session and the page asks you to check your inbox. The answer is the same whether or not the address already has an account.

## Files

- [schema.sql](schema.sql): the two migrations applied to the project
- [permissions.json](permissions.json): the eight `user` permissions
- [index.html](index.html), [app.js](app.js), [style.css](style.css): the page, no dependencies

## Run it on your own project in 5 steps

1. **Create a project** at [app.excalibase.io](https://app.excalibase.io) and create a publishable key (Studio, API keys, or the `create_publishable_key` MCP tool).
2. **Apply the schema**: paste [schema.sql](schema.sql) into the Studio SQL editor, or ask your AI tool to `apply_migration` it.
3. **Set the permissions** in [permissions.json](permissions.json) (Studio, Permissions, or one `set_permission` call each), then **turn on realtime** for `kanban_boards` and `kanban_cards` in Studio (Realtime). There is no MCP tool for realtime yet.
4. **Point the page at your project**: edit `site/config.js` with your project id and publishable key. To try it locally, add `http://localhost:8080` to the project's CORS list in Studio and run `docker build -f site/Dockerfile -t examples . && docker run -p 8080:8080 examples`.
5. **Host it**: create a container app (`create_app`, port 8080, health check `/healthz`), then push and let the workflow in `.github/workflows/deploy.yml` deploy it, or call `deploy_app`.

### With an AI tool

Connect the Excalibase MCP server (see the [root README](../../README.md#build-your-own-with-your-ai-tool)) and ask:

> Apply apps/kanban/schema.sql to my project and set the permissions in apps/kanban/permissions.json for the user role. Then sign up two test users, and with their tokens check that user B cannot read, update or delete user A's cards.

`test_api_request` signs in with the publishable key, so it probes the `anon` role only; use it to confirm anon gets nothing, and use curl with real user tokens for the per-user checks.
