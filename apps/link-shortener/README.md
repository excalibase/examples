# Link Shortener

Paste a long URL, get a short link with a copy button, and watch this browser's links count their clicks.

**Live:** https://examples-jfp7kx46kb.apps.excalibase.io/link-shortener/

## What it shows

| Excalibase feature | Where |
| --- | --- |
| Publishable key sign-in (anon role) | `signIn()` in [shared.js](shared.js) |
| Tracked Postgres function as a GraphQL mutation | `publicLinkShortenerCreate(url:)` creates a link; the database picks the code |
| Tracked Postgres function over REST | `POST rpc/link_shortener_hit` counts a click and returns the link, in one statement |
| Function permissions | anon may call exactly these two functions; the code generator `link_shortener_new_code()` is not tracked, so nobody can call it |
| REST reads with `in.()` filters | `GET link_shortener_links?code=in.(...)&order=created_at.desc` for this browser's links |
| Column-level select permission with a row limit | anon reads `code`, `target_url`, `clicks`, `created_at`, at most 50 rows a request |
| Constraints as the source of truth | `CHECK`s on the code shape, the URL scheme and length, `clicks >= 0`; the primary key makes codes unique |
| Container app hosting | served from the `site/` nginx image |

Anon has no insert, update or delete permission on `link_shortener_links`. The only way in is
`link_shortener_create`, so a visitor can neither choose a code nor point an existing code
somewhere else, and the only way to change `clicks` is `link_shortener_hit`, one at a time.

### How a short link works

A short link is `https://examples-jfp7kx46kb.apps.excalibase.io/link-shortener/go/?c=<code>`.
The `go/` page calls `link_shortener_hit`, which runs
`UPDATE ... SET clicks = clicks + 1 WHERE code = $1 RETURNING *`: two visitors at the same moment
both count, and an unknown code answers no row. The page then checks the target is `http(s)` once
more and leaves with `location.replace`, so the back button skips it. It is a page, not an HTTP
302, because the site is static (see [Why not an edge function](#why-not-an-edge-function)).

### The rules, enforced by the database

`link_shortener_create(url)` trims the URL and refuses it, with a message the page shows, when:

- it is not `http://` or `https://` (so `javascript:`, `data:`, `ftp:` and friends are out);
- it is longer than 2048 characters, has spaces or control characters, or has no host;
- it carries a user name or password (`https://user:pass@...`), a common phishing disguise;
- it is already a short link: the host is `api.excalibase.io` or this gallery, or the path is a
  `/link-shortener/go` page on any host, so links cannot loop;
- the app has already made 30 links in the last minute. An advisory lock serializes creators, so
  the count cannot be raced. The cap is for the whole app, not per visitor: the database never
  sees the visitor's address.

The code is 7 characters of base62 drawn from `gen_random_uuid()` (a CSPRNG), with rejection
sampling so every character is equally likely; on the rare collision it retries.

The page checks the same rules first for a quicker message; the database decides. Targets are
rendered with `textContent` and linked only when they are `http(s)`, never through `innerHTML`.

Links are public: anyone who can read the table (anon, up to 50 rows a request) can list them,
as with any public shortener. Do not shorten private URLs.

### Why not an edge function

The obvious design is an edge function that makes the code and answers a real `302`. On the hosted
platform today a function (or a container app) cannot call its own project's REST or GraphQL API:
the request to `api.excalibase.io` times out inside the cluster, and functions have no other way to
reach the project's SQL tables. Postgres functions do the same job with fewer moving parts:
server-side codes, one-statement click counts and no secret key to store.

## Files

- [schema.sql](schema.sql): the migration applied to the project
- [permissions.json](permissions.json): the anon select permission, and the two functions to track and grant to anon
- [index.html](index.html), [app.js](app.js), [shared.js](shared.js), [style.css](style.css): the shortener page
- [go/index.html](go/index.html), [go/go.js](go/go.js): the redirect page

## Run it on your own project in 5 steps

1. **Create a project** at [app.excalibase.io](https://app.excalibase.io) and create a publishable key (Studio, API keys, or the `create_publishable_key` MCP tool).
2. **Apply the schema**: paste [schema.sql](schema.sql) into the Studio SQL editor, or ask your AI tool to `apply_migration` it. Change the two hosts in `link_shortener_create` to your own.
3. **Set the permissions**: the select permission in [permissions.json](permissions.json) (Studio, Permissions, or `set_permission`). Then in Studio, Database, Functions, track `public.link_shortener_create` and `public.link_shortener_hit` and allow the `anon` role to call both.
4. **Point the page at your project**: edit `site/config.js` with your project id and publishable key. To try it locally, add `http://localhost:8080` to the project's CORS list in Studio and run `docker build -f site/Dockerfile -t examples . && docker run -p 8080:8080 examples`.
5. **Host it**: create a container app (`create_app`, port 8080, health check `/healthz`), then push and let the workflow in `.github/workflows/deploy.yml` deploy it, or call `deploy_app`.

### With an AI tool

Connect the Excalibase MCP server (see the [root README](../../README.md#build-your-own-with-your-ai-tool)) and ask:

> Apply apps/link-shortener/schema.sql to my project, set the select permission in apps/link-shortener/permissions.json for the anon role, then check with test_api_request that anon can read link_shortener_links but cannot insert, update or delete it, and that the GraphQL mutation publicLinkShortenerCreate refuses a javascript: URL.

Tracking functions and granting them to a role have no MCP tool yet, so do step 3's second half in Studio. `test_api_request` cannot call `rpc/` paths either; try `rpc/link_shortener_hit` with `curl` or from the page.
