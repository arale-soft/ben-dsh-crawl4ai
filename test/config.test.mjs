/**
 * Tests for the configuration layer: the schema the settings service projects
 * into a form, and the reads that turn the live references into one operation's
 * options.
 *
 * `lib/config.js` imports `@deepseek-ai/schemastery`, which is a harness package
 * rather than a registry dependency. A checkout that has not run
 * `scripts/link-harness-deps.mjs` cannot resolve it, so the load is guarded and
 * the suite skips there instead of failing for a reason that is not this
 * plugin's:
 *
 *   node scripts/link-harness-deps.mjs
 *   node --test test/config.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CONTENT_SOURCES,
  DEFAULT_CONTENT_SOURCE,
  DEFAULT_FETCH_MODE,
  DEFAULT_MAX_CONTENT_CHARS,
  DEFAULT_MD_FILTER,
  DEFAULT_ONLY_TEXT,
  DEFAULT_TIMEOUT_MS,
  FETCH_MODES,
  MD_FILTERS,
} from '../lib/crawl4ai.js'

/** The config module, or `undefined` when schemastery is not reachable. */
const config = await import('../lib/config.js').catch(() => undefined)

/** The harness packages the config layer needs, for the skip message. */
const SKIP = 'run `node scripts/link-harness-deps.mjs` so @deepseek-ai/schemastery resolves'

test('the schema declares every config key and nothing else', { skip: config === undefined ? SKIP : false }, () => {
  const { CONFIG_KEYS, Config } = config
  const instance = Config({})
  assert.deepEqual(Object.keys(instance).sort(), [...CONFIG_KEYS].sort())
  // The two limits stay off the configuration page but remain configurable in
  // YAML, so they are declared even though no card control edits them.
  assert.ok(CONFIG_KEYS.includes('timeoutMs'))
  assert.ok(CONFIG_KEYS.includes('maxContentChars'))
  for (const key of ['fetchMode', 'content_source', 'only_text', 'f']) {
    assert.ok(CONFIG_KEYS.includes(key), `${key} must be part of the section`)
  }
})

test('every field is volatile, which is what the settings service writes', { skip: config === undefined ? SKIP : false }, () => {
  const { Config } = config
  const instance = Config({ crawl4aiUrl: 'https://ca.example:1443/' })
  // A non-volatile field is invisible to the configuration page, and an entry
  // with none at all is refused outright; the live reference is also what lets
  // an edit reach the next fetch without a restart.
  for (const key of Object.keys(instance)) {
    assert.equal(typeof instance[key]?.get, 'function', `${key} must arrive as a live reference`)
  }
  assert.equal(instance.crawl4aiUrl.get(), 'https://ca.example:1443/')
})

test('the schema accepts each documented choice and refuses anything else', { skip: config === undefined ? SKIP : false }, () => {
  const { Config } = config
  const choices = {
    fetchMode: Object.values(FETCH_MODES),
    content_source: [...CONTENT_SOURCES],
    f: [...MD_FILTERS],
  }
  for (const [field, values] of Object.entries(choices)) {
    for (const value of values) {
      const instance = Config({ [field]: value })
      assert.equal(instance[field].get(), value, `${field}=${value} must be accepted`)
    }
    // A hand-edited patch can hold a typo. The settings service validates a
    // write against this schema, so it must be refused at write time rather
    // than forwarded to the server as an endpoint or a value it would reject.
    assert.throws(() => Config({ [field]: 'not-a-choice' }), `${field} must refuse an unknown value`)
  }
})

test('an unset field resolves to Crawl4AI\'s own default', { skip: config === undefined ? SKIP : false }, () => {
  const { Config, resolveOptions, snapshotConfig } = config
  const options = resolveOptions(snapshotConfig(Config({})))
  assert.equal(options.fetchMode, DEFAULT_FETCH_MODE)
  assert.equal(options.fetchMode, 'crawl_stream')
  assert.equal(options.content_source, DEFAULT_CONTENT_SOURCE)
  assert.equal(options.content_source, 'cleaned_html')
  assert.equal(options.only_text, DEFAULT_ONLY_TEXT)
  assert.equal(options.only_text, false)
  assert.equal(options.f, DEFAULT_MD_FILTER)
  assert.equal(options.f, 'fit')
  assert.equal(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  assert.equal(options.maxContentChars, DEFAULT_MAX_CONTENT_CHARS)
})

test('resolveOptions carries the configured values and the auth header', { skip: config === undefined ? SKIP : false }, () => {
  const { Config, resolveOptions, snapshotConfig } = config
  const options = resolveOptions(snapshotConfig(Config({
    crawl4aiUrl: 'https://ca.example:1443/',
    authHeaderName: 'X-API-Key',
    authHeaderValue: 'secret',
    fetchMode: 'md',
    content_source: 'raw_html',
    only_text: true,
    f: 'raw',
    timeoutMs: 1_000,
    maxContentChars: 50,
  })))
  assert.deepEqual(options, {
    baseURL: 'https://ca.example:1443/',
    authHeaderName: 'X-API-Key',
    authHeaderValue: 'secret',
    fetchMode: 'md',
    content_source: 'raw_html',
    only_text: true,
    f: 'raw',
    timeoutMs: 1_000,
    maxContentChars: 50,
  })
})

test('snapshotConfig reads through live references and drops the unset ones', { skip: config === undefined ? SKIP : false }, () => {
  const { snapshotConfig } = config
  // What the loader hands `apply` for a volatile field is a live reference, so
  // the provider reads through it per call rather than capturing a snapshot.
  let current = {}
  const reference = (read) => ({ get: read })
  const live = {
    crawl4aiUrl: reference(() => current.crawl4aiUrl),
    fetchMode: reference(() => current.fetchMode),
    only_text: reference(() => current.only_text),
    f: reference(() => current.f),
  }
  assert.deepEqual(snapshotConfig(live), {})

  current = { crawl4aiUrl: 'https://ca.example:1443/', fetchMode: 'crawl', only_text: false, f: 'raw' }
  assert.deepEqual(snapshotConfig(live), current)
  // Plain values work too, which is what lets a direct caller in a test — or
  // the seam integration test — pass an already-resolved section.
  assert.deepEqual(snapshotConfig({ crawl4aiUrl: 'https://x.example', f: 'fit' }), {
    crawl4aiUrl: 'https://x.example',
    f: 'fit',
  })
})
