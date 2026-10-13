/**
 * Crawl4AI-backed `WebFetchProvider` for the DeepSeek Harness web capability
 * seam (`ctx.web`).
 *
 * This is an implementation package: it registers a provider with the seam and
 * does NOT register a model-facing tool. `@deepseek-ai/dsh-tool-web` owns
 * `web_fetch` — its schema, its prompt guidance, and its result card — so
 * installing this package makes that existing tool render pages through
 * Crawl4AI instead of a plain HTTP fetch.
 *
 * @module ben-dsh-crawl4ai
 */
import { Config, SETTINGS_NAMESPACE, resolveOptions, snapshotConfig } from './config.js'
import { Crawl4aiFetchProvider, CRAWL4AI_FETCH_PROVIDER_ID } from './provider.js'

export {
  Config,
  DEFAULT_MAX_CONTENT_CHARS,
  DEFAULT_TIMEOUT_MS,
  SETTINGS_NAMESPACE,
  resolveOptions,
  snapshotConfig,
} from './config.js'
export {
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
} from './crawl4ai.js'
export { CRAWL4AI_FETCH_PROVIDER_ID, Crawl4aiFetchProvider, toWebError } from './provider.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'ben-crawl4ai'

/** The web seam this provider registers into. */
export const inject = ['web']

/**
 * Register the Crawl4AI fetch provider with `ctx.web`.
 *
 * The options thunk reads the row's live references per crawl, so a settings
 * edit reaches the next `web_fetch` without a restart. The registration
 * disposer is deliberately not captured: registration is effect-scoped and
 * unregisters with the calling fiber, so plugin disposal and HMR clean up on
 * their own.
 *
 * @param ctx - plugin context carrying the web seam.
 * @param config - this plugin row's live config.
 */
export function apply(ctx, config) {
  const readOptions = () => resolveOptions(snapshotConfig(config))
  ctx.web.registerFetchProvider(new Crawl4aiFetchProvider(readOptions))
}
