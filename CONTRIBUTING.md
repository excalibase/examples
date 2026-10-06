# Contributing an example

Every app lives in its own folder and touches nothing else, so several apps can be added in parallel.

## Layout

```
apps/<name>/          # <name>: lowercase-kebab, becomes the URL path /<name>/
  index.html          # the page; loads /config.js, then its own files
  app.js, style.css   # optional, any other static files you need
  schema.sql          # exactly the SQL applied with apply_migration
  permissions.json    # the set_permission calls: [{table, role, operation, permission}]
  README.md           # see below
```

Do not edit `site/`, `.github/` or another app's folder in the same change as a new app. If the gallery or the root README needs a new row, add one line to the apps table in the root README.

## Database

- All apps share one project. Prefix every table, view, function and index with the app name in snake_case, in schema `public` (e.g. `feedback_posts`, `live_poll_votes`).
- Put the rules in the database: `CHECK` constraints, foreign keys, unique keys. The page validates for a nicer message, the database decides.
- `schema.sql` must be re-runnable on an empty project and must match what was applied. Never drop another app's tables.

## Permissions

- The page runs as the `anon` role with the publishable key. Give it only the columns and operations the page uses.
- Insert permissions list the columns a visitor may set; leave out server-owned columns (`id`, `status`, `created_at`, ...).
- Counting rows (GraphQL `...Aggregate`, REST `Prefer: count=exact`) needs `allowAggregations: true` on the select permission.
- Before shipping, run every request the page makes through the `test_api_request` MCP tool with the gallery origin `https://examples-jfp7kx46kb.apps.excalibase.io`, and probe that the forbidden writes (other columns, update, delete) are refused.

## Page

- Plain HTML, CSS and JavaScript. No build step, no frameworks, no CDN scripts.
- Load `<script src="/config.js"></script>` and read `window.EXCALIBASE = { url, projectId, key }`; never hard-code the project or key in the app.
- The site sends a strict Content-Security-Policy: `script-src 'self'; style-src 'self'`. No inline `<script>`, no `style="..."` attributes, no `on...=` handlers. `connect-src` allows only `https://api.excalibase.io` and `wss://api.excalibase.io`.
- Render user text with `textContent` (or escape it). Never put user text into `innerHTML`.
- Link back to the gallery (`<a href="/">All examples</a>`), support light and dark (`prefers-color-scheme`), and work at phone width.
- Sign in: `POST {url}/auth/default/{projectId}/token` with `{"grant_type":"api_key","api_key":key}`; send `Authorization: Bearer <accessToken>` and `X-Excalibase-Publishable-Key: <key>` on every call; sign in again on a 401.
- REST: `{url}/{projectId}/api/v1/<table>`. GraphQL: `{url}/{projectId}/graphql`, root fields are schema-prefixed camelCase (`publicFeedbackPosts`, `publicFeedbackVotesAggregate`).

## README.md of an app

- First line `# <Title>`: the gallery card title.
- First plain paragraph after it (one line, starting with a letter): the gallery card summary.
- Then: a live link, a table of the Excalibase features it shows, its files, and "Run it on your own project in 5 steps", including the AI-tool route through the MCP server.

## Commits and PRs

- One-line conventional commits: `feat: live poll example`, `fix: feedback board vote count`.
- Open a pull request against `main`. Merging to `main` builds the site and deploys it.
