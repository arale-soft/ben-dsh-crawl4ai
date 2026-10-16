/**
 * The Crawl4AI HTTP contract: request construction, response mapping, and the
 * single network call.
 *
 * This module deliberately imports nothing from the harness. Everything here
 * is a plain function over `fetch`, so the mapping can be exercised directly
 * with `node --test` against a live server instead of only through a booted
 * profile. `provider.js` is the thin adapter that turns these errors into the
 * `WebError`s the web seam expects.
 *
 * Verified against Crawl4AI server 0.9.x. `/crawl` answers `{ success,
 * results: [{ url, status_code, redirected_url, markdown: { raw_markdown,
 * fit_markdown, markdown_with_citations, … }, … }] }`; `/crawl/stream`
 * answers the same results as NDJSON, one per line, closed by a
 * `{"status": "completed"}` marker; `/md` answers `{ url, filter, markdown,
 * success }` for the `f` filter it was given.
 *
 * @module ben-dsh-crawl4ai/crawl4ai
 */

/** Resource backstop for one crawl, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 60_000

/** Cap on the Markdown characters handed to the model for one page. */
export const DEFAULT_MAX_CONTENT_CHARS = 200_000

/**
 * The ways this plugin can ask Crawl4AI for one page.
 *
 * `crawlStream` and `crawl` post the same `crawler_config` to the two crawl
 * endpoints — the streaming one answers NDJSON — and therefore share the
 * `content_source` and `only_text` options. `md` posts to the markdown-only
 * endpoint, which takes its own `f` filter instead.
 */
export const FETCH_MODES = Object.freeze({
  crawlStream: 'crawl_stream',
  crawl: 'crawl',
  md: 'md',
})

/** The mode used when the row configures none. */
export const DEFAULT_FETCH_MODE = FETCH_MODES.crawlStream

/**
 * The HTML sources `DefaultMarkdownGenerator` can generate Markdown from.
 *
 * `content_source` is not a `CrawlerRunConfig` field: it belongs to the
 * Markdown generator, so `buildCrawlerConfig` sends it nested inside that
 * generator's `{ type, params }` envelope.
 */
export const CONTENT_SOURCES = Object.freeze(['cleaned_html', 'raw_html', 'fit_html'])

/** The source used when the row configures none, matching Crawl4AI's own default. */
export const DEFAULT_CONTENT_SOURCE = 'cleaned_html'

/** The `only_text` used when the row configures none, matching Crawl4AI's own default. */
export const DEFAULT_ONLY_TEXT = false

/** The `/md` filters this plugin offers. Crawl4AI also serves `bm25` and `llm`. */
export const MD_FILTERS = Object.freeze(['fit', 'raw'])

/** The `/md` filter used when the row configures none, matching the endpoint's default. */
export const DEFAULT_MD_FILTER = 'fit'

/** Path of the streaming crawl endpoint: one NDJSON result line per URL. */
const CRAWL_STREAM_PATH = '/crawl/stream'

/** Path of the full crawl endpoint, which reports the target's own status. */
const CRAWL_PATH = '/crawl'

/** Path of the markdown-only endpoint. */
const MARKDOWN_PATH = '/md'

/** The `status` a streaming response carries on its terminal failure line. */
const STREAM_ERROR_STATUS = 'error'

/** Statuses that name an authentication refusal rather than a crawl failure. */
const AUTH_STATUSES = new Set([401, 403])

/** Machine-routable failure kinds; `provider.js` maps them onto `WebError` codes. */
export const CRAWL4AI_ERROR_CODES = Object.freeze({
  invalidUrl: 'invalid-url',
  config: 'config',
  timeout: 'timeout',
  aborted: 'aborted',
  provider: 'provider',
})

/**
 * A crawl failure carrying a machine-routable `code`.
 *
 * Codes are this module's own vocabulary, not the seam's: keeping them
 * separate is what lets the pure half stay free of harness imports.
 */
export class Crawl4aiError extends Error {
  /**
   * @param message - what a person reads.
   * @param code - one of {@link CRAWL4AI_ERROR_CODES}.
   * @param options - standard `Error` options; `cause` is preserved.
   */
  constructor(message, code, options) {
    super(message, options)
    this.name = 'Crawl4aiError'
    this.code = code
  }
}

/**
 * Parse the configured base URL.
 *
 * A deployment that has not set one is a configuration problem rather than a
 * crawl failure, so this returns `undefined` instead of throwing: the provider
 * reports itself unavailable, and the seam says so before any call is made.
 *
 * @param input - the configured URL, possibly unset or padded.
 * @returns the parsed base URL, or `undefined` when it is unusable.
 */
export function normalizeBaseURL(input) {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (raw === '') return undefined
  let url
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  // Embedded credentials would be sent as a basic-auth header alongside the
  // one this plugin is configured with; refuse rather than silently do both.
  if (url.username !== '' || url.password !== '') return undefined
  return url
}

/**
 * Join an endpoint path onto the base URL, preserving any path prefix the
 * deployment serves the server under (a reverse proxy at `/crawl4ai`, say).
 *
 * @param base - the parsed base URL.
 * @param path - the endpoint path, leading slash included.
 * @returns the absolute endpoint URL.
 */
export function resolveEndpointURL(base, path) {
  const url = new URL(base.toString())
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

/**
 * Validate the URL the model asked to fetch.
 *
 * @param input - the requested URL.
 * @returns the normalized URL string.
 * @throws {Crawl4aiError} `invalid-url` when it is not absolute http(s).
 */
export function assertFetchableURL(input) {
  let url
  try {
    url = new URL(input)
  } catch (error) {
    throw new Crawl4aiError(`invalid URL: ${input}`, CRAWL4AI_ERROR_CODES.invalidUrl, { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Crawl4aiError(
      `unsupported URL scheme "${url.protocol}" (only http and https are allowed)`,
      CRAWL4AI_ERROR_CODES.invalidUrl,
    )
  }
  return url.toString()
}

/**
 * Build the request headers, adding the configured authenticating header.
 *
 * Both halves must be present: a named header with no value is a
 * configuration mistake, and sending it empty would turn a missing token into
 * an authentication refusal the person has to decode.
 *
 * @param options - the crawl options.
 * @returns the header map for the request.
 */
export function buildHeaders(options) {
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/json',
  }
  const name = typeof options.authHeaderName === 'string' ? options.authHeaderName.trim() : ''
  const value = typeof options.authHeaderValue === 'string' ? options.authHeaderValue.trim() : ''
  if (name !== '' && value !== '') headers[name.toLowerCase()] = value
  return headers
}

/**
 * Coerce a configured value to its option's default when it is not one of the
 * accepted choices.
 *
 * A configuration field is a plain YAML value a person can edit by hand, and a
 * typo there must not become a crawl that silently asked for something else:
 * an unrecognized choice falls back to the documented default instead of being
 * forwarded, so the request always carries a value the server accepts.
 *
 * @param list - the accepted values.
 * @param fallback - the value used when `value` is not accepted.
 * @returns a function coercing one configured value.
 */
function oneOf(list, fallback) {
  return (value) => (list.includes(value) ? value : fallback)
}

/** Coerce `fetchMode`; an unrecognized mode behaves as the default. */
export const resolveFetchMode = oneOf(Object.values(FETCH_MODES), DEFAULT_FETCH_MODE)

/** Coerce `content_source`; an unrecognized source behaves as the default. */
export const resolveContentSource = oneOf(CONTENT_SOURCES, DEFAULT_CONTENT_SOURCE)

/** Coerce `f`; an unrecognized filter behaves as the endpoint's own default. */
export const resolveMdFilter = oneOf(MD_FILTERS, DEFAULT_MD_FILTER)

/**
 * Coerce `only_text` to a boolean.
 *
 * Unlike the string options a non-boolean is never forwarded: a YAML `false`
 * is a boolean, but `"false"` is a truthy string, and sending it as a flag
 * would flip the option it was meant to turn off.
 *
 * @param value - the configured value.
 * @returns the boolean to send.
 */
export function resolveOnlyText(value) {
  return typeof value === 'boolean' ? value : DEFAULT_ONLY_TEXT
}

/**
 * Build the `crawler_config` sent to either crawl endpoint.
 *
 * Both crawl endpoints take the same body, so they share this. Only two fields
 * are set, and both are set explicitly rather than left out: the server layer
 * fills a missing key from its own defaults, so naming them keeps the request
 * self-describing and independent of a deployment's base config.
 *
 * `content_source` is NOT a `CrawlerRunConfig` field. It is read off the
 * Markdown generator (`getattr(markdown_generator, 'content_source', …)`), so
 * it travels inside that generator's `{ type, params }` envelope; sending it
 * as a top-level key would be silently dropped by the server's untrusted
 * field allowlist.
 *
 * @param options - the crawl options.
 * @returns the `crawler_config` object.
 */
export function buildCrawlerConfig(options) {
  return {
    only_text: resolveOnlyText(options.only_text),
    markdown_generator: {
      type: 'DefaultMarkdownGenerator',
      params: { content_source: resolveContentSource(options.content_source) },
    },
  }
}

/**
 * Build the request body for one endpoint and the URL already normalized.
 *
 * @param mode - one of {@link FETCH_MODES}.
 * @param target - the normalized target URL.
 * @param options - the crawl options.
 * @returns the JSON body to post.
 */
export function buildRequestBody(mode, target, options) {
  if (mode === FETCH_MODES.md) {
    // `/md` takes a single `url` plus its own filter; it has no crawler_config,
    // which is why the crawl options do not apply to it.
    return { url: target, f: resolveMdFilter(options.f) }
  }
  return { urls: [target], crawler_config: buildCrawlerConfig(options) }
}

/**
 * Parse an NDJSON body into the records it carried.
 *
 * `/crawl/stream` answers one JSON object per line — a serialized result, and
 * a terminal `{"status": "completed"}` marker — so the body is not valid JSON
 * as a whole and cannot go through {@link readJSON}.
 *
 * @param text - the response body.
 * @param endpoint - the endpoint URL, for the message.
 * @returns the parsed records, blank lines dropped.
 * @throws {Crawl4aiError} `provider` when a line is not JSON.
 */
export function parseStreamBody(text, endpoint) {
  const records = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      records.push(JSON.parse(trimmed))
    } catch (error) {
      const snippet = trimmed.slice(0, 200)
      throw new Crawl4aiError(
        `Crawl4AI answered ${endpoint} with a non-JSON line: ${snippet}`,
        CRAWL4AI_ERROR_CODES.provider,
        { cause: error },
      )
    }
  }
  return records
}

/**
 * Map a streamed NDJSON body onto the seam's fetch result.
 *
 * The stream is read to its end rather than abandoned at the first result: the
 * request carries exactly one URL, so there is one result to find and the
 * server closes the stream immediately after it.
 *
 * @param records - the parsed records, in arrival order.
 * @param requestURL - the URL that was requested.
 * @param maxContentChars - cap on the returned content length.
 * @returns the fetch result.
 * @throws {Crawl4aiError} `provider` when the stream carried no result.
 */
export function mapStreamResponse(records, requestURL, maxContentChars) {
  // A stream can fail after it has opened, in which case the failure arrives as
  // a terminal marker instead of an HTTP status. It is reported as the crawl
  // failure it is rather than being mistaken for a missing result.
  for (const record of records) {
    if (record?.status === STREAM_ERROR_STATUS) {
      throw new Crawl4aiError(
        `Crawl4AI could not crawl ${requestURL}: ${describeFailure(record)}`,
        CRAWL4AI_ERROR_CODES.provider,
      )
    }
  }
  // The terminal marker carries only a status, so anything describing a page is
  // a result. Keying off the fields rather than off "not a marker" keeps this
  // correct if the server adds further marker statuses.
  const result = records.find(
    (record) => record !== null && typeof record === 'object' && (record.url !== undefined || record.markdown !== undefined),
  )
  if (result === undefined) {
    throw new Crawl4aiError(
      `Crawl4AI returned no result for ${requestURL}: ${describeFailure(records.at(-1))}`,
      CRAWL4AI_ERROR_CODES.provider,
    )
  }
  return mapResult(result, requestURL, maxContentChars)
}

/**
 * Pick the richest Markdown Crawl4AI returned for one result.
 *
 * `fit_markdown` is present but EMPTY unless the server was asked for a fit
 * filter, so an empty string must fall through to `raw_markdown` rather than
 * be returned as "no content".
 *
 * @param markdown - the result's `markdown` field: a string on `/md`, an
 * object on `/crawl`.
 * @returns the Markdown to return, or `undefined` when none was produced.
 */
export function selectMarkdown(markdown) {
  if (typeof markdown === 'string') return markdown.trim() === '' ? undefined : markdown
  if (markdown === null || typeof markdown !== 'object') return undefined
  for (const key of ['fit_markdown', 'raw_markdown', 'markdown_with_citations']) {
    const value = markdown[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

/**
 * Apply the character cap.
 *
 * @param content - the decoded content.
 * @param maxContentChars - the cap.
 * @returns the content to return and whether it was cut.
 */
export function capContent(content, maxContentChars) {
  if (!Number.isFinite(maxContentChars) || content.length <= maxContentChars) {
    return { content, truncated: false }
  }
  return { content: content.slice(0, maxContentChars), truncated: true }
}

/**
 * Best available one-line explanation of a failure payload.
 *
 * @param payload - the failing response or result object.
 * @returns the server's own words, or a generic fallback.
 */
export function describeFailure(payload) {
  const detail = payload?.error_message ?? payload?.detail ?? payload?.error
  if (typeof detail === 'string' && detail.trim() !== '') return detail
  return 'no diagnostic was returned'
}

/**
 * Whether a crawl result carries the target's HTTP status.
 *
 * A non-2xx target page is a RESULT in this seam, not a throw: the status is
 * part of the fetched resource, so it is returned with whatever body Crawl4AI
 * managed to extract. The throw is reserved for failures to retrieve the page
 * at all — which the server signals by omitting a status.
 *
 * @param result - one entry of the crawl response's `results`.
 * @returns the status code when the server reported one.
 */
function reportedStatusCode(result) {
  const value = result?.status_code
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Map one CrawlResult onto the seam's fetch result.
 *
 * Both crawl endpoints report a page the same way — `/crawl/stream` differs
 * only in how it frames the records — so the per-result mapping lives here and
 * each response shape has its own thin reader around it.
 *
 * @param result - one crawl result.
 * @param requestURL - the URL that was requested, used when the server reports none.
 * @param maxContentChars - cap on the returned content length.
 * @returns the fetch result: final URL, target status, body, truncation flag.
 * @throws {Crawl4aiError} `provider` when the result carries no usable content.
 */
function mapResult(result, requestURL, maxContentChars) {
  const statusCode = reportedStatusCode(result)
  const content = selectMarkdown(result.markdown)
    ?? (typeof result.cleaned_html === 'string' && result.cleaned_html.trim() !== '' ? result.cleaned_html : undefined)
  if (result.success === false && statusCode === undefined) {
    throw new Crawl4aiError(
      `Crawl4AI could not crawl ${requestURL}: ${describeFailure(result)}`,
      CRAWL4AI_ERROR_CODES.provider,
    )
  }
  if (content === undefined) {
    const status = statusCode === undefined ? '' : ` (HTTP ${statusCode})`
    throw new Crawl4aiError(
      `Crawl4AI returned no content for ${requestURL}${status}: ${describeFailure(result)}`,
      CRAWL4AI_ERROR_CODES.provider,
    )
  }
  const capped = capContent(content, maxContentChars)
  const redirected = typeof result.redirected_url === 'string' && result.redirected_url !== ''
  const returned = typeof result.url === 'string' && result.url !== ''
  return {
    url: redirected ? result.redirected_url : returned ? result.url : requestURL,
    statusCode: statusCode ?? 200,
    body: { kind: 'text', content: capped.content },
    truncated: capped.truncated,
  }
}

/**
 * Map a `/crawl` response body onto the seam's fetch result.
 *
 * @param payload - the parsed response body.
 * @param requestURL - the URL that was requested, used when the server reports none.
 * @param maxContentChars - cap on the returned content length.
 * @returns the fetch result: final URL, target status, body, truncation flag.
 * @throws {Crawl4aiError} `provider` when the server produced no usable result.
 */
export function mapCrawlResponse(payload, requestURL, maxContentChars) {
  if (payload === null || typeof payload !== 'object') {
    throw new Crawl4aiError('Crawl4AI returned a non-object body', CRAWL4AI_ERROR_CODES.provider)
  }
  const [result] = Array.isArray(payload.results) ? payload.results : []
  if (result === undefined) {
    throw new Crawl4aiError(
      `Crawl4AI returned no result for ${requestURL}: ${describeFailure(payload)}`,
      CRAWL4AI_ERROR_CODES.provider,
    )
  }
  return mapResult(result, requestURL, maxContentChars)
}

/**
 * Map a `/md` response body onto the seam's fetch result.
 *
 * The markdown endpoint reports no target status, so a successful call is a
 * 200 by construction.
 *
 * @param payload - the parsed response body.
 * @param requestURL - the URL that was requested.
 * @param maxContentChars - cap on the returned content length.
 * @returns the fetch result.
 * @throws {Crawl4aiError} `provider` when the server returned no Markdown.
 */
export function mapMarkdownResponse(payload, requestURL, maxContentChars) {
  if (payload === null || typeof payload !== 'object') {
    throw new Crawl4aiError('Crawl4AI returned a non-object body', CRAWL4AI_ERROR_CODES.provider)
  }
  if (payload.success === false) {
    throw new Crawl4aiError(
      `Crawl4AI could not convert ${requestURL}: ${describeFailure(payload)}`,
      CRAWL4AI_ERROR_CODES.provider,
    )
  }
  const content = selectMarkdown(payload.markdown)
  if (content === undefined) {
    throw new Crawl4AIError(`Crawl4AI returned no content for ${requestURL}`, CRAWL4AI_ERROR_CODES.provider)
  }
  const capped = capContent(content, maxContentChars)
  const returned = typeof payload.url === 'string' && payload.url !== ''
  return {
    url: returned ? payload.url : requestURL,
    statusCode: 200,
    body: { kind: 'text', content: capped.content },
    truncated: capped.truncated,
  }
}

/**
 * Read a response body as JSON, keeping the raw text for the diagnostic when
 * it is not JSON.
 *
 * A reverse proxy in front of Crawl4AI answers an HTML error page rather than
 * JSON, and "Unexpected token <" tells a person nothing; the status together
 * with a snippet of what actually arrived does.
 *
 * @param response - the fetch response.
 * @param endpoint - the endpoint URL, for the message.
 * @returns the parsed body.
 * @throws {Crawl4aiError} `provider` when the body is not JSON.
 */
async function readJSON(response, endpoint) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch (error) {
    const snippet = text.trim().slice(0, 200)
    throw new Crawl4aiError(
      `Crawl4AI answered ${endpoint} with a non-JSON body${snippet === '' ? '' : `: ${snippet}`}`,
      CRAWL4AI_ERROR_CODES.provider,
      { cause: error },
    )
  }
}

/**
 * Crawl one URL through a Crawl4AI server, over the endpoint the row selected.
 *
 * The endpoint is exactly the one configured — there is no fallback between
 * them. A silent retry would answer from a different endpoint than the person
 * chose, which is worst where the endpoints differ: `/md` reports no target
 * status, so falling back to it turns a page the server could not retrieve
 * into a success, and it ignores `content_source` and `only_text` entirely.
 * A server that does not serve the chosen endpoint therefore reports its own
 * 404/405 rather than quietly fetching another way.
 *
 * @param options - the crawl options: `url`, `baseURL`, `fetchMode`,
 * `content_source`, `only_text`, `f`, `authHeaderName`, `authHeaderValue`,
 * `timeoutMs`, `maxContentChars`.
 * @param signal - caller cancellation, forwarded to the request.
 * @param fetchImpl - the fetch implementation, overridden only by tests.
 * @returns the fetch result for the seam.
 * @throws {Crawl4aiError} with a code from {@link CRAWL4AI_ERROR_CODES}.
 */
export async function crawl(options, signal, fetchImpl = globalThis.fetch) {
  const base = normalizeBaseURL(options.baseURL)
  if (base === undefined) {
    throw new Crawl4aiError(
      'the Crawl4AI URL is not configured (set it on this plugin\'s configuration page)',
      CRAWL4AI_ERROR_CODES.config,
    )
  }
  const target = assertFetchableURL(options.url)
  if (signal?.aborted) {
    throw new Crawl4aiError('web fetch aborted', CRAWL4AI_ERROR_CODES.aborted, { cause: signal.reason })
  }
  const headers = buildHeaders(options)
  const mode = resolveFetchMode(options.fetchMode)
  const maxContentChars = Number.isFinite(options.maxContentChars)
    ? options.maxContentChars
    : DEFAULT_MAX_CONTENT_CHARS
  // A missing or nonsensical bound must not become a 0 ms timer, which would
  // abort every crawl the instant it started.
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS

  // One controller carries both cancellations, so the request is torn down by
  // whichever fires first while `timedOut` records which one it was: an outer
  // deadline and our own resource backstop must not be reported alike.
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error(`Crawl4AI did not answer within ${String(timeoutMs)}ms`))
  }, timeoutMs)

  const path = mode === FETCH_MODES.md
    ? MARKDOWN_PATH
    : mode === FETCH_MODES.crawl
      ? CRAWL_PATH
      : CRAWL_STREAM_PATH

  try {
    const endpoint = resolveEndpointURL(base, path)
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildRequestBody(mode, target, options)),
      signal: controller.signal,
    })
    if (AUTH_STATUSES.has(response.status)) {
      throw new Crawl4aiError(
        `Crawl4AI refused the request (HTTP ${String(response.status)}); check the authenticating header configured for this plugin`,
        CRAWL4AI_ERROR_CODES.provider,
      )
    }
    if (!response.ok) {
      // The failing response is read for its own diagnostic; a body that is not
      // JSON leaves `describeFailure` with the generic fallback rather than
      // masking the status code behind a parse error.
      const payload = await readJSON(response, endpoint).catch(() => undefined)
      throw new Crawl4aiError(
        `Crawl4AI answered ${endpoint} with HTTP ${String(response.status)}: ${describeFailure(payload)}`,
        CRAWL4AI_ERROR_CODES.provider,
      )
    }
    if (mode === FETCH_MODES.md) {
      return mapMarkdownResponse(await readJSON(response, endpoint), target, maxContentChars)
    }
    if (mode === FETCH_MODES.crawl) {
      return mapCrawlResponse(await readJSON(response, endpoint), target, maxContentChars)
    }
    // NDJSON, so the body is read whole and parsed line by line rather than as
    // one JSON document.
    return mapStreamResponse(parseStreamBody(await response.text(), endpoint), target, maxContentChars)
  } catch (error) {
    if (error instanceof Crawl4aiError) throw error
    if (timedOut) {
      throw new Crawl4aiError(
        `Crawl4AI did not answer within ${String(timeoutMs)}ms`,
        CRAWL4AI_ERROR_CODES.timeout,
        { cause: error },
      )
    }
    if (signal?.aborted) {
      throw new Crawl4aiError('web fetch aborted', CRAWL4AI_ERROR_CODES.aborted, { cause: error })
    }
    throw new Crawl4aiError(
      `could not reach the Crawl4AI server at ${base.origin}: ${error instanceof Error ? error.message : String(error)}`,
      CRAWL4AI_ERROR_CODES.provider,
      { cause: error },
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
