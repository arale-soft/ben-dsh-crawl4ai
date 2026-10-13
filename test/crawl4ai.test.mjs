/**
 * Tests for the pure Crawl4AI half. Runs with `node --test test/` and needs no
 * harness: `lib/crawl4ai.js` imports nothing, so the mapping is exercised
 * directly instead of only through a booted profile.
 *
 * The last case is a live smoke test against a real server. It is skipped
 * unless `CRAWL4AI_URL` is set (and optional `CRAWL4AI_AUTH_HEADER_NAME` /
 * `CRAWL4AI_AUTH_HEADER_VALUE`), so the suite stays offline by default:
 *
 *   $env:CRAWL4AI_URL='https://ca.example:1443'
 *   node --test test/
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CRAWL4AI_ERROR_CODES,
  Crawl4aiError,
  assertFetchableURL,
  buildHeaders,
  capContent,
  crawl,
  mapCrawlResponse,
  mapMarkdownResponse,
  normalizeBaseURL,
  resolveEndpointURL,
  selectMarkdown,
} from '../lib/crawl4ai.js'

/** A JSON response stub for the fetch implementation. */
function jsonResponse(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(payload),
  }
}

/** A response whose body is not JSON, as a reverse proxy's error page would be. */
function textResponse(status, body) {
  return { status, ok: false, text: async () => body }
}

/** One `/crawl` success body, shaped like Crawl4AI server 0.9.4. */
function crawlBody(overrides = {}) {
  return {
    success: true,
    results: [{
      url: 'https://example.com',
      status_code: 200,
      success: true,
      markdown: { raw_markdown: '# Title\n\nBody', fit_markdown: '' },
      ...overrides,
    }],
  }
}

const BASE_OPTIONS = {
  baseURL: 'https://ca.example:1443',
  timeoutMs: 5_000,
  maxContentChars: 1_000,
}

test('normalizeBaseURL accepts http(s) roots and rejects everything else', () => {
  assert.equal(normalizeBaseURL('https://ca.example:1443').origin, 'https://ca.example:1443')
  assert.equal(normalizeBaseURL('  http://localhost:11235/  ').origin, 'http://localhost:11235')
  assert.equal(normalizeBaseURL(undefined), undefined)
  assert.equal(normalizeBaseURL('   '), undefined)
  assert.equal(normalizeBaseURL('not a url'), undefined)
  assert.equal(normalizeBaseURL('ftp://ca.example'), undefined)
  // Embedded credentials would ride alongside the configured header.
  assert.equal(normalizeBaseURL('https://user:secret@ca.example'), undefined)
})

test('resolveEndpointURL keeps a reverse-proxy path prefix', () => {
  assert.equal(resolveEndpointURL(new URL('https://ca.example:1443/'), '/crawl'), 'https://ca.example:1443/crawl')
  assert.equal(resolveEndpointURL(new URL('https://ca.example/crawl4ai/'), '/md'), 'https://ca.example/crawl4ai/md')
  assert.equal(resolveEndpointURL(new URL('https://ca.example/x?y=1#z'), '/crawl'), 'https://ca.example/x/crawl')
})

test('assertFetchableURL refuses what the seam must not fetch', () => {
  assert.equal(assertFetchableURL('https://example.com/a'), 'https://example.com/a')
  assert.equal(assertFetchableURL('https://example.com'), 'https://example.com/')
  assert.throws(() => assertFetchableURL('nonsense'), (error) => {
    assert.equal(error.code, CRAWL4AI_ERROR_CODES.invalidUrl)
    return true
  })
  assert.throws(() => assertFetchableURL('file:///etc/passwd'), (error) => {
    assert.equal(error.code, CRAWL4AI_ERROR_CODES.invalidUrl)
    return true
  })
})

test('buildHeaders sends the auth header only when name and value are both set', () => {
  assert.deepEqual(buildHeaders({ authHeaderName: 'Authorization', authHeaderValue: 'Bearer t' }), {
    'content-type': 'application/json',
    'accept': 'application/json',
    'authorization': 'Bearer t',
  })
  assert.deepEqual(buildHeaders({ authHeaderName: 'X-API-Key', authHeaderValue: ' k ' }), {
    'content-type': 'application/json',
    'accept': 'application/json',
    'x-api-key': 'k',
  })
  // A name with no value is a configuration mistake, not an empty header.
  assert.equal('authorization' in buildHeaders({ authHeaderName: 'Authorization' }), false)
  assert.equal('authorization' in buildHeaders({ authHeaderValue: 'Bearer t' }), false)
})

test('selectMarkdown prefers fit, falls through an EMPTY fit, then citations', () => {
  assert.equal(selectMarkdown({ fit_markdown: 'fit', raw_markdown: 'raw' }), 'fit')
  assert.equal(selectMarkdown({ fit_markdown: '', raw_markdown: 'raw' }), 'raw')
  assert.equal(selectMarkdown({ markdown_with_citations: 'cited' }), 'cited')
  assert.equal(selectMarkdown('plain'), 'plain')
  assert.equal(selectMarkdown(''), undefined)
  assert.equal(selectMarkdown(null), undefined)
})

test('capContent cuts only past the cap and reports it', () => {
  assert.deepEqual(capContent('abc', 3), { content: 'abc', truncated: false })
  assert.deepEqual(capContent('abcd', 3), { content: 'abc', truncated: true })
  assert.deepEqual(capContent('abcd', undefined), { content: 'abcd', truncated: false })
})

test('mapCrawlResponse returns the final URL, the target status, and capped Markdown', () => {
  const result = mapCrawlResponse(crawlBody(), 'https://example.com', 1_000)
  assert.equal(result.url, 'https://example.com')
  assert.equal(result.statusCode, 200)
  assert.deepEqual(result.body, { kind: 'text', content: '# Title\n\nBody' })
  assert.equal(result.truncated, false)

  const redirected = mapCrawlResponse(
    crawlBody({ redirected_url: 'https://www.example.com/', status_code: 301 }),
    'https://example.com',
    1_000,
  )
  assert.equal(redirected.url, 'https://www.example.com/')
  assert.equal(redirected.statusCode, 301)

  const capped = mapCrawlResponse(crawlBody(), 'https://example.com', 4)
  assert.equal(capped.body.content, '# Ti')
  assert.equal(capped.truncated, true)
})

test('mapCrawlResponse returns a non-2xx TARGET as a result, not a throw', () => {
  const result = mapCrawlResponse(
    crawlBody({ status_code: 404, markdown: { raw_markdown: 'Not found' } }),
    'https://example.com/missing',
    1_000,
  )
  assert.equal(result.statusCode, 404)
  assert.equal(result.body.content, 'Not found')
})

test('mapCrawlResponse throws only when no page could be retrieved', () => {
  assert.throws(() => mapCrawlResponse({ success: true, results: [] }, 'https://example.com', 1_000), (error) => {
    assert.ok(error instanceof Crawl4aiError)
    assert.equal(error.code, CRAWL4AI_ERROR_CODES.provider)
    assert.match(error.message, /no result/)
    return true
  })
  assert.throws(() => mapCrawlResponse(
    { success: false, results: [{ success: false, error_message: 'browser crashed' }] },
    'https://example.com',
    1_000,
  ), (error) => {
    assert.match(error.message, /browser crashed/)
    return true
  })
  assert.throws(() => mapCrawlResponse(crawlBody({ markdown: {} }), 'https://example.com', 1_000), (error) => {
    assert.match(error.message, /no content/)
    return true
  })
})

test('mapCrawlResponse falls back to cleaned HTML when no Markdown was produced', () => {
  const result = mapCrawlResponse(
    crawlBody({ markdown: {}, cleaned_html: '<p>hi</p>' }),
    'https://example.com',
    1_000,
  )
  assert.equal(result.body.content, '<p>hi</p>')
})

test('mapMarkdownResponse maps the /md shape', () => {
  const result = mapMarkdownResponse({ url: 'https://example.com', markdown: '# Hi', success: true }, 'https://example.com', 1_000)
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.content, '# Hi')
  assert.throws(() => mapMarkdownResponse({ success: false, detail: 'nope' }, 'https://example.com', 1_000), (error) => {
    assert.match(error.message, /nope/)
    return true
  })
})

test('crawl posts the URL to /crawl and maps the answer', async () => {
  const calls = []
  const fetchImpl = async (endpoint, init) => {
    calls.push({ endpoint, init })
    return jsonResponse(200, crawlBody())
  }
  const result = await crawl({ ...BASE_OPTIONS, url: 'https://example.com', authHeaderName: 'Authorization', authHeaderValue: 'Bearer t' }, undefined, fetchImpl)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].endpoint, 'https://ca.example:1443/crawl')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.authorization, 'Bearer t')
  // The WHATWG URL parser normalizes an empty path to "/", so the form sent to
  // Crawl4AI is the canonical absolute URL.
  assert.deepEqual(JSON.parse(calls[0].init.body), { urls: ['https://example.com/'] })
  assert.equal(result.body.content, '# Title\n\nBody')
})

test('crawl falls back to /md on a server that does not serve /crawl', async () => {
  const seen = []
  const fetchImpl = async (endpoint) => {
    seen.push(endpoint)
    if (endpoint.endsWith('/crawl')) return jsonResponse(405, { detail: 'Method Not Allowed' })
    return jsonResponse(200, { url: 'https://example.com', markdown: '# Via md', success: true })
  }
  const result = await crawl({ ...BASE_OPTIONS, url: 'https://example.com' }, undefined, fetchImpl)
  assert.deepEqual(seen, ['https://ca.example:1443/crawl', 'https://ca.example:1443/md'])
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.content, '# Via md')
})

test('crawl names the auth header when the server refuses the request', async () => {
  const fetchImpl = async () => jsonResponse(403, { detail: 'Forbidden' })
  await assert.rejects(
    () => crawl({ ...BASE_OPTIONS, url: 'https://example.com' }, undefined, fetchImpl),
    (error) => {
      assert.equal(error.code, CRAWL4AI_ERROR_CODES.provider)
      assert.match(error.message, /authenticating header/)
      return true
    },
  )
})

test('crawl reports a non-JSON body with the status and a snippet', async () => {
  const fetchImpl = async () => textResponse(502, '<html>Bad gateway</html>')
  await assert.rejects(
    () => crawl({ ...BASE_OPTIONS, url: 'https://example.com' }, undefined, fetchImpl),
    (error) => {
      assert.equal(error.code, CRAWL4AI_ERROR_CODES.provider)
      assert.match(error.message, /HTTP 502/)
      return true
    },
  )
})

test('crawl refuses to run without a configured URL', async () => {
  await assert.rejects(
    () => crawl({ ...BASE_OPTIONS, baseURL: '', url: 'https://example.com' }, undefined, async () => jsonResponse(200, crawlBody())),
    (error) => {
      assert.equal(error.code, CRAWL4AI_ERROR_CODES.config)
      return true
    },
  )
})

test('crawl reports its own deadline as a timeout, distinct from caller cancellation', async () => {
  const hanging = (endpoint, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
  })
  await assert.rejects(
    () => crawl({ ...BASE_OPTIONS, timeoutMs: 20, url: 'https://example.com' }, undefined, hanging),
    (error) => {
      assert.equal(error.code, CRAWL4AI_ERROR_CODES.timeout)
      return true
    },
  )

  const controller = new AbortController()
  const pending = crawl({ ...BASE_OPTIONS, timeoutMs: 5_000, url: 'https://example.com' }, controller.signal, hanging)
  setTimeout(() => controller.abort(new Error('user cancelled')), 20)
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, CRAWL4AI_ERROR_CODES.aborted)
    return true
  })
})

test('live: crawls a real page through CRAWL4AI_URL when one is configured', async (t) => {
  const baseURL = process.env.CRAWL4AI_URL
  if (baseURL === undefined || baseURL === '') {
    t.skip('set CRAWL4AI_URL to run the live smoke test')
    return
  }
  const result = await crawl({
    baseURL,
    authHeaderName: process.env.CRAWL4AI_AUTH_HEADER_NAME,
    authHeaderValue: process.env.CRAWL4AI_AUTH_HEADER_VALUE,
    timeoutMs: 90_000,
    maxContentChars: 20_000,
    url: process.env.CRAWL4AI_TEST_URL ?? 'https://example.com',
  })
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.kind, 'text')
  assert.ok(result.body.content.length > 0, 'expected non-empty Markdown')
})
