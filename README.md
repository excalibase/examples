# Excalibase Examples

Small, dependency-free apps built on [Excalibase](https://excalibase.io): a Postgres database with generated REST and GraphQL APIs, permissions per role, and container hosting.

**Gallery:** https://examples-jfp7kx46kb.apps.excalibase.io

Every app is a plain HTML page that signs in with a publishable key (the anon role) and talks to the project's APIs straight from the browser. All apps share one project; each app's tables are prefixed with its name.

## Apps

| App | What it is | Excalibase features |
| --- | --- | --- |
| [Feedback Board](apps/feedback-board/) ([live](https://examples-jfp7kx46kb.apps.excalibase.io/feedback-board/)) | Post ideas, bugs and questions; upvote once per browser | REST reads/inserts, GraphQL aggregates, column-level insert permissions, `allowAggregations`, constraints as rules |
| [Live Poll](apps/live-poll/) ([live](https://examples-jfp7kx46kb.apps.excalibase.io/live-poll/)) | Create a poll, share the link, watch results update live; one vote per browser | Realtime GraphQL subscriptions (polling fallback), GraphQL aggregates, composite foreign keys, unique keys, column-level permissions |
| [Kanban](apps/kanban/) ([live](https://examples-jfp7kx46kb.apps.excalibase.io/kanban/)) | Personal boards with sign-up, drag and drop, and live sync across tabs | End-user auth, row permissions on `X-Excalibase-User-Id`, session presets, GraphQL subscriptions |
| [Link Shortener](apps/link-shortener/) ([live](https://examples-jfp7kx46kb.apps.excalibase.io/link-shortener/)) | Paste a long URL, get a short link, count its clicks | Tracked Postgres functions over GraphQL and REST `rpc/`, function permissions, atomic click counts, validation and a rate cap in the database, REST `in.()` reads |

Each app folder has:

- `index.html` (+ `app.js`, `style.css`): the page
- `schema.sql`: the migration applied to the project
- `permissions.json`: the API permissions the page needs
- `README.md`: what it shows and how to run it on your own project

## How it is hosted

`site/` builds one nginx image (non-root, port 8080) that serves every `apps/<name>/` at `/<name>/`, a gallery at `/` generated from the app READMEs, and a shared `/config.js` with the project URL, id and publishable key. On every push to `main` that touches `apps/` or `site/`, [the workflow](.github/workflows/deploy.yml) builds the image, pushes it to Docker Hub and deploys it by digest to an Excalibase container app with [excalibase/deploy-action](https://github.com/excalibase/deploy-action).

Build and run it locally:

```sh
docker build -f site/Dockerfile -t examples-site .
docker run --rm -p 8080:8080 examples-site
```

The live project only accepts browser calls from the gallery's own origin, so to use the pages locally point `site/config.js` at your own project and add `http://localhost:8080` to its CORS list.

## Build your own with your AI tool

Excalibase has a hosted MCP server, so a coding agent can create tables, set permissions, test API calls as your page would, and deploy, all from your editor.

1. In Studio, create a personal access token (Account, Access tokens). Bind it to one project if you like.
2. Add the server `https://app.excalibase.io/mcp` with the header `Authorization: Bearer <your token>`:
   - **Claude Code:** `claude mcp add --transport http excalibase https://app.excalibase.io/mcp --header "Authorization: Bearer <token>"`
   - **Cursor:** in `.cursor/mcp.json`: `{"mcpServers": {"excalibase": {"url": "https://app.excalibase.io/mcp", "headers": {"Authorization": "Bearer <token>"}}}}`
   - **Codex:** in `~/.codex/config.toml`: `[mcp_servers.excalibase]` with `url = "https://app.excalibase.io/mcp"` and `bearer_token_env_var = "EXCALIBASE_TOKEN"`
3. Ask for an app, for example: *"Build a feedback board like apps/feedback-board in my Excalibase project: apply the schema, set anon permissions, test every request with test_api_request, then host it as a container app."*

The tools it will use: `apply_migration`, `set_permission`, `test_api_request`, `create_app`, `get_ci_snippet`, `deploy_app`, `get_deploy_status`, `get_logs`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the conventions every app follows.

## License

[Apache-2.0](LICENSE)
