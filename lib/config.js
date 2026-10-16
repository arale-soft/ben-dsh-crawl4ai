/**
 * This plugin row's configuration: the schema the settings service projects
 * into a form, and the reads that turn the live references into one
 * operation's options.
 *
 * Every field is `.volatile()`. That is not a style choice: the settings
 * service refuses to write a field that is not (`Config field "…" is not
 * volatile`) and refuses an entry with none at all (`has no volatile
 * fields`), so a non-volatile field would be invisible to the configuration
 * page. Volatility also means the value is handed to `apply` as a live
 * reference rather than a snapshot, so an edit reaches the NEXT web_fetch
 * without a restart — which is why the provider re-reads per call instead of
 * capturing options at registration.
 *
 * @module ben-dsh-crawl4ai/config
 */
import z from '@deepseek-ai/schemastery'
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
} from './crawl4ai.js'

export { DEFAULT_MAX_CONTENT_CHARS, DEFAULT_TIMEOUT_MS }

/**
 * A schema accepting exactly the listed string choices.
 *
 * Each choice is wrapped in `z.const`, so a value outside the list is refused
 * rather than coerced: the settings service validates a write against this
 * schema, which is what keeps a hand-edited patch from configuring a crawl the
 * server would reject.
 *
 * @param list - the accepted values.
 * @param fallback - the value used when none is configured.
 * @returns the schema for one choice field.
 */
function choice(list, fallback) {
  return z.union(list.map((value) => z.const(value))).default(fallback)
}

/**
 * The profile entry id this plugin's settings are written under.
 *
 * The settings service addresses a plugin by its profile ENTRY id, so this
 * must equal the row id `cordis.patch.yml` inserts: renaming one without the
 * other makes every save fail with `No configurable plugin entry`, and makes
 * the browser half's `ctx.configForms.get(...)` bind a namespace that never
 * appears.
 */
export const SETTINGS_NAMESPACE = 'ben-crawl4ai'

/**
 * The row's configuration.
 *
 * `crawl4aiUrl`, `authHeaderName` and `authHeaderValue` are the three fields a
 * deployment always edits; both header fields are independent so a deployment
 * can name `X-API-Key`, `Authorization`, or nothing at all.
 *
 * `fetchMode` selects the endpoint, and the three option fields are named
 * exactly as Crawl4AI names them, so a hand-edited patch reads like the API it
 * configures. Only the group belonging to the selected mode reaches the
 * server: `content_source` and `only_text` configure the two crawl endpoints,
 * `f` configures `/md`. Each still carries a default equal to Crawl4AI's own,
 * so an unset field is a no-op rather than an error.
 *
 * `timeoutMs` and `maxContentChars` stay off the page — they are deployment
 * concerns, and a card that showed every knob would bury the ones a person
 * actually tunes.
 */
export const Config = z.object({
  crawl4aiUrl: z.string().volatile(),
  authHeaderName: z.string().volatile(),
  authHeaderValue: z.string().volatile(),
  fetchMode: choice(Object.values(FETCH_MODES), DEFAULT_FETCH_MODE).volatile(),
  content_source: choice(CONTENT_SOURCES, DEFAULT_CONTENT_SOURCE).volatile(),
  only_text: z.boolean().default(DEFAULT_ONLY_TEXT).volatile(),
  f: choice(MD_FILTERS, DEFAULT_MD_FILTER).volatile(),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS).volatile(),
  maxContentChars: z.number().step(1).min(1).default(DEFAULT_MAX_CONTENT_CHARS).volatile(),
})

/** Every key the schema declares, in the order a snapshot reads them. */
export const CONFIG_KEYS = [
  'crawl4aiUrl',
  'authHeaderName',
  'authHeaderValue',
  'fetchMode',
  'content_source',
  'only_text',
  'f',
  'timeoutMs',
  'maxContentChars',
]

/**
 * Read one configuration field, whichever shape the loader handed us.
 *
 * A field declared volatile arrives as a stable reference whose `get()`
 * returns the current snapshot; anything else arrives as the plain value. The
 * provider reads through this so it works under both projections — and so a
 * direct caller in a test can pass plain values.
 *
 * @param field - the live field, or an already-resolved value.
 * @returns the field's current value, or `undefined` when unset.
 */
export function readField(field) {
  if (field !== null && typeof field === 'object' && typeof field.get === 'function') return field.get()
  return field
}

/**
 * Read every live field once, dropping the unset ones, so one operation sees
 * one consistent section even if an edit lands mid-flight.
 *
 * @param live - the config `apply` received.
 * @returns the section as it stands now.
 */
export function snapshotConfig(live) {
  const section = {}
  for (const key of CONFIG_KEYS) {
    const value = readField(live?.[key])
    if (value !== undefined) section[key] = value
  }
  return section
}

/**
 * Project one resolved section into the options a crawl runs with.
 *
 * Defaults are applied HERE rather than once at `apply`, so a value the
 * settings service starts supplying later takes effect without the plugin
 * holding a stale copy. Every mode's options are passed through regardless of
 * the selected mode: `crawl()` reads only the group its endpoint accepts, so
 * the unused group is inert rather than needing a branch here.
 *
 * @param config - the currently authoritative section.
 * @returns the options for one crawl.
 */
export function resolveOptions(config) {
  return {
    baseURL: config.crawl4aiUrl,
    authHeaderName: config.authHeaderName,
    authHeaderValue: config.authHeaderValue,
    fetchMode: config.fetchMode ?? DEFAULT_FETCH_MODE,
    content_source: config.content_source ?? DEFAULT_CONTENT_SOURCE,
    only_text: config.only_text ?? DEFAULT_ONLY_TEXT,
    f: config.f ?? DEFAULT_MD_FILTER,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxContentChars: config.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
  }
}
