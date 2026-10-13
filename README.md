# ben-dsh-crawl4ai

A [Crawl4AI](https://github.com/unclecode/crawl4ai)-backed `WebFetchProvider` for the
[DeepSeek Harness](https://github.com/deepseek-ai) web capability seam (`ctx.web`).

Crawl4AI drives a real browser, so a page that a plain HTTP fetch sees as an empty
`<div id="app">` arrives here as rendered Markdown — including the code blocks, tables, and
lazily-loaded text that only exist after JavaScript runs.

This is an **implementation** package: it registers a provider into `ctx.web` and does **not**
register a model-facing tool. `@deepseek-ai/dsh-tool-web` owns `web_fetch` — its schema, its
prompt guidance, and its result card — so installing this package makes that existing tool
render pages through Crawl4AI instead of a plain fetch.

| | |
|---|---|
| Provider id | `ben-crawl4ai` |
| Registers | `ctx.web.registerFetchProvider(...)` |
| Configures | on the Plugins page, on this package's `ben-crawl4ai` row |
| Requires | a reachable Crawl4AI server (0.9.x tested) |

English | [中文](README.zh.md)

## Install

```bash
dsh plugin --profile <name> add github:you/ben-dsh-crawl4ai   # or an absolute path
```

The package declares `dsh.bundle`, so the install also activates it: the bundle patch inserts
the provider row and selects it on the `web` row.

### Developing in place (`link:` installs need one extra step)

`dsh plugin add <absolute path>` records the dependency as `link:<path>`, which makes
`node_modules/ben-dsh-crawl4ai` inside the profile a **junction** back to your working copy.
Node resolves a module's import specifiers from its **real** path, so the walk up for
`@deepseek-ai/…` starts in your working copy and never reaches the profile's resolution root —
and a published plugin, which pnpm materializes *inside* the profile, does not have this
problem.

One command reproduces that reachability:

```bash
node scripts/link-harness-deps.mjs
```

It junctions each package named in `peerDependencies` from the harness's own install into this
directory's `node_modules`, preferring the profile tier so this plugin shares the harness's
module **instances** rather than copies. Re-run it after changing `peerDependencies`. It
defaults to `$DSH_PROFILE_DIR/../node_modules`, which the harness sets for its child processes;
pass `--root <node_modules>` otherwise.

## Configuration

Everything lives on **Plugins → this package → the `ben-crawl4ai` row → Configure**. The page
stages what you type and writes only on **Save**, through the shell's own settings surface
(`ctx.configForms`), so an edit reaches the next `web_fetch` without a restart.

| Field | Meaning |
|---|---|
| **Crawl4AI URL** | Server root, e.g. `http://crawl4ai.internal:11235`. Unset or not `http(s)` makes the provider report unavailable, and `web_fetch` says so instead of failing every call. |
| **Auth header name** | e.g. `Authorization` or `X-API-Key`. Blank sends no authenticating header. |
| **Auth header value** | Sent as that header's value. Rendered masked; **blank sends no authenticating header** — the name and the value take effect together. |

Both header fields are independent, so a deployment can use any header name or none at all.

The values are stored in the active profile's patch
(`$DSH_HOME/profiles/<profile>/cordis.patch.yml`), **in plain text**. This is a fetch back end
reading its own token, not a per-user credential, and the masked control keeps it off the screen
rather than out of the file. Two further fields stay off the page because they are deployment
concerns, edited in YAML instead:

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `60000` | Resource backstop for one crawl. Keep it below the model-facing tool budget (`tool-web`'s `timeoutMs`) so a slow server surfaces as a provider failure. |
| `maxContentChars` | `200000` | Cap on the Markdown returned for one page; a longer page sets `truncated`. |

A patch row **replaces the targeted row's whole `config`**, so restate every key you want to
keep.

## Provider selection is required

The bundle patch sets `web.fetchProvider: ben-crawl4ai`, and that is not politeness:
`@deepseek-ai/dsh-web-fetch-http` is mounted alongside this package and its `available()` is
unconditionally `true`, so **two** fetch providers are usable at once. The seam auto-selects only
when exactly one is, and otherwise fails every call with `WEB_PROVIDER_AMBIGUOUS`.

A patch replaces the whole `config` of the row it targets, and a profile patch is applied after
every bundle layer — so if you also pin `searchProvider` on the `web` row, restate
`fetchProvider: ben-crawl4ai` there too.

## The server contract

One fetch is `POST <base>/crawl` with `{"urls": ["<url>"]}` and the configured header. The
response is Crawl4AI's `{ success, results: [ … ] }`, and the first result supplies the final URL
(`redirected_url` over `url`), the target's own `status_code`, and its `markdown` object, from
which `fit_markdown` is preferred and an **empty** `fit_markdown` falls through to
`raw_markdown` (the server returns `fit_markdown: ""` unless a fit filter was requested).

A server that does not serve `/crawl` (an older build, or a proxy that exposes only part of the
API) answers 404/405 and is retried once against `/md`, which returns the same content without
the target's status or final URL.

A **non-2xx target page is a result, not an error** — the status is part of the fetched
resource, so it is returned with whatever body Crawl4AI extracted. A throw is reserved for
failing to retrieve the page at all.

## Errors

Failures are `WebError`s the tool layer renders in a tool result.

| Situation | Code |
|---|---|
| Caller cancelled | `WEB_ABORTED` |
| `timeoutMs` elapsed | `WEB_FETCH_TIMEOUT` |
| Requested URL is not absolute `http(s)` | `WEB_INVALID_URL` |
| No Crawl4AI URL configured | `WEB_PROVIDER_ERROR` (and `available()` is false) |
| Server refused the request (401/403) | `WEB_PROVIDER_ERROR`, naming the auth header |
| Server unreachable, 5xx, or a non-JSON body | `WEB_PROVIDER_ERROR` |
| Server produced no result or no content | `WEB_PROVIDER_ERROR` |

## Tests

```bash
node --test test/crawl4ai.test.mjs test/client.test.mjs   # offline
```

`crawl4ai.test.mjs` covers the HTTP contract and mapping against a stubbed `fetch`.
`client.test.mjs` evaluates the browser bundle with the module loader stubbed, so a stray
`@deepseek-ai/*` import, an unknown primitive name, or a slot key that does not match the
inserted row fails the suite instead of breaking the Web UI.

Two suites need a live server and skip without one:

```bash
$env:CRAWL4AI_URL='https://ca.example:1443'
$env:CRAWL4AI_AUTH_HEADER_NAME='Authorization'
$env:CRAWL4AI_AUTH_HEADER_VALUE='Bearer …'
node --test test/seam.test.mjs          # registers into the REAL ctx.web and fetches
node --test test/crawl4ai.test.mjs      # includes a live crawl
```

`seam.test.mjs` is the end-to-end one: it mounts `@deepseek-ai/dsh-web`, applies this plugin, and
dispatches a fetch through the seam, covering selection by id, the unavailable gate, and that a
volatile row edit reaches the very next call.

## Known limitations

- **Markdown only.** The seam's body kinds are `html` and `text`; this provider always returns
  `text`, so `dsh-tool-web`'s HTML-to-Markdown step is skipped rather than applied twice.
- **No crawl tuning.** `crawler_config` is not exposed: scan depth, caching, filters, and
  screenshots are Crawl4AI features this seam's request shape has nowhere to put.
- **The Crawl4AI server holds the page cache.** `cache` is left at its default, so a repeat fetch
  may answer from the server's cache.
- **`/md` loses the target's status.** On the fallback path a successful conversion is reported
  as HTTP 200 by construction.

## License

MIT
