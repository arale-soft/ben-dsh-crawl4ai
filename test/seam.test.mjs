/**
 * Integration test: this plugin's provider, registered into the harness's REAL
 * web seam (`ctx.web` from `@deepseek-ai/dsh-web`) and dispatched through it.
 *
 * `crawl4ai.test.mjs` proves the HTTP mapping; this proves the wiring — that
 * `apply` registers provider id `ben-crawl4ai`, that the seam selects it by
 * name, that `available()` gates an unconfigured deployment before any request,
 * and that a fetch returns the seam's own result shape.
 *
 * It runs only with a configured server, because the whole point is the round
 * trip:
 *
 *   $env:CRAWL4AI_URL='https://ca.example:1443'
 *   $env:CRAWL4AI_AUTH_HEADER_NAME='Authorization'
 *   $env:CRAWL4AI_AUTH_HEADER_VALUE='Bearer …'
 *   node --test test/seam.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { WebError, WebRuntime } from '@deepseek-ai/dsh-web'

import { Config, CRAWL4AI_FETCH_PROVIDER_ID, apply } from '../lib/index.js'

/** The live server, or `undefined` when the suite should skip. */
const BASE_URL = process.env.CRAWL4AI_URL
const TARGET = process.env.CRAWL4AI_TEST_URL ?? 'https://example.com'

/**
 * Build a folder with the web seam mounted and this plugin applied to it.
 *
 * @param config - the row configuration to hand `apply`.
 * @returns the context and the seam.
 */
function harness(config) {
  const ctx = new Context()
  new WebRuntime(ctx, { fetchProvider: CRAWL4AI_FETCH_PROVIDER_ID })
  // `ctx.web` is the cordis service accessor for the runtime above, not the
  // runtime object itself: nothing here may compare them by identity.
  assert.equal(typeof ctx.web.registerFetchProvider, 'function')
  apply(ctx, config)
  return { ctx }
}

test('the seam resolves the provider by its configured id', async (t) => {
  if (BASE_URL === undefined || BASE_URL === '') {
    t.skip('set CRAWL4AI_URL to run the seam integration test')
    return
  }
  const config = Config({
    crawl4aiUrl: BASE_URL,
    authHeaderName: process.env.CRAWL4AI_AUTH_HEADER_NAME,
    authHeaderValue: process.env.CRAWL4AI_AUTH_HEADER_VALUE,
  })
  const { ctx } = harness(config)
  const result = await ctx.web.fetch({ url: TARGET })

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.kind, 'text')
  assert.ok(result.body.content.length > 0, 'expected non-empty Markdown')
  assert.match(result.url, /^https?:\/\//)
  assert.equal(typeof result.truncated, 'boolean')
})

test('an unconfigured deployment reports the provider unavailable, without a request', async (t) => {
  if (BASE_URL === undefined || BASE_URL === '') {
    t.skip('set CRAWL4AI_URL to run the seam integration test')
    return
  }
  const { ctx } = harness(Config({}))
  await assert.rejects(
    () => ctx.web.fetch({ url: TARGET }),
    (error) => {
      assert.ok(error instanceof WebError, 'the seam reports its own error type')
      assert.equal(error.code, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
      return true
    },
  )
})

test('a target the seam must not fetch is refused with the seam\'s own code', async (t) => {
  if (BASE_URL === undefined || BASE_URL === '') {
    t.skip('set CRAWL4AI_URL to run the seam integration test')
    return
  }
  const { ctx } = harness(Config({ crawl4aiUrl: BASE_URL }))
  await assert.rejects(
    () => ctx.web.fetch({ url: 'file:///etc/passwd' }),
    (error) => {
      assert.ok(error instanceof WebError)
      assert.equal(error.code, 'WEB_INVALID_URL')
      return true
    },
  )
})

test('a volatile row edit reaches the very next fetch', async (t) => {
  if (BASE_URL === undefined || BASE_URL === '') {
    t.skip('set CRAWL4AI_URL to run the seam integration test')
    return
  }
  // What the loader hands `apply` for a volatile field is a live reference, so
  // the provider must read through it per call rather than capture a snapshot.
  let current = {}
  const reference = (read) => ({ get: read })
  const live = {
    crawl4aiUrl: reference(() => current.crawl4aiUrl),
    authHeaderName: reference(() => current.authHeaderName),
    authHeaderValue: reference(() => current.authHeaderValue),
    fetchMode: reference(() => current.fetchMode),
    content_source: reference(() => current.content_source),
    only_text: reference(() => current.only_text),
    f: reference(() => current.f),
    timeoutMs: reference(() => current.timeoutMs),
    maxContentChars: reference(() => current.maxContentChars),
  }
  const { ctx } = harness(live)

  await assert.rejects(() => ctx.web.fetch({ url: TARGET }), { code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })

  current = {
    crawl4aiUrl: BASE_URL,
    authHeaderName: process.env.CRAWL4AI_AUTH_HEADER_NAME,
    authHeaderValue: process.env.CRAWL4AI_AUTH_HEADER_VALUE,
    fetchMode: 'crawl_stream',
    content_source: 'cleaned_html',
    only_text: false,
    f: 'fit',
  }
  const result = await ctx.web.fetch({ url: TARGET })
  assert.equal(result.statusCode, 200)
  assert.ok(result.body.content.length > 0)

  // A second edit reaches the NEXT fetch without moving the registration, and
  // switching to `/md` changes which endpoint answers.
  current = { ...current, fetchMode: 'md' }
  const viaMarkdown = await ctx.web.fetch({ url: TARGET })
  assert.equal(viaMarkdown.body.kind, 'text')
  assert.ok(viaMarkdown.body.content.length > 0)
})
