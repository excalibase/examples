# Feedback Board

Post ideas, bugs and questions, filter by kind, and upvote once per browser. Status badges are set by the team only.

**Live:** https://examples-jfp7kx46kb.apps.excalibase.io/feedback-board/

## What it shows

| Excalibase feature | Where |
| --- | --- |
| Publishable key sign-in (anon role) | `signIn()` in [app.js](app.js) |
| REST reads with filters, ordering and limits | `GET feedback_posts?kind=eq.bug&order=created_at.desc` |
| REST inserts with `Prefer: return=representation` | posting feedback and votes |
| GraphQL aggregates (one request, one alias per post) | vote counts via `publicFeedbackVotesAggregate` |
| Column-level permissions | anon can insert `kind`, `body`, `author_name` but never `status` |
| Aggregate permission (`allowAggregations`) | anon may count votes |
| Constraints as the source of truth | `CHECK`s on kind/status/length; `PRIMARY KEY (feedback_id, voter_id)` blocks double votes |
| Container app hosting | served from the `site/` nginx image |

No update or delete permission exists for anon, so visitors cannot edit posts, change a status or remove votes. The team changes a status from Studio (or with SQL).

All user text is rendered with `textContent`, never `innerHTML`.

## Files

- [schema.sql](schema.sql): the migration applied to the project
- [permissions.json](permissions.json): the four anon permissions
- [index.html](index.html), [app.js](app.js), [style.css](style.css): the page, no dependencies

## Run it on your own project in 5 steps

1. **Create a project** at [app.excalibase.io](https://app.excalibase.io) and create a publishable key (Studio, API keys, or the `create_publishable_key` MCP tool).
2. **Apply the schema**: paste [schema.sql](schema.sql) into the Studio SQL editor, or ask your AI tool to `apply_migration` it.
3. **Set the permissions** in [permissions.json](permissions.json) (Studio, Permissions, or one `set_permission` call each).
4. **Point the page at your project**: edit `site/config.js` with your project id and publishable key. To try it locally, add `http://localhost:8080` to the project's CORS list in Studio and run `docker build -f site/Dockerfile -t examples . && docker run -p 8080:8080 examples`.
5. **Host it**: create a container app (`create_app`, port 8080, health check `/healthz`), then push and let the workflow in `.github/workflows/deploy.yml` deploy it, or call `deploy_app`.

### With an AI tool

Connect the Excalibase MCP server (see the [root README](../../README.md#build-your-own-with-your-ai-tool)) and ask:

> Apply apps/feedback-board/schema.sql to my project, set the permissions in apps/feedback-board/permissions.json for the anon role, then check every request app.js makes with test_api_request, including that anon cannot set status, update or delete.
