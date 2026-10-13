/**
 * The web seam's fetch provider, backed by a Crawl4AI server.
 *
 * This is the thin adapter layer: it owns the provider id and the mapping from
 * this module's own failure vocabulary onto the `WebError` codes the seam
 * documents, while all HTTP and parsing lives in `crawl4ai.js`.
 *
 * @module ben-dsh-crawl4ai/provider
 */
import { WebError } from '@deepseek-ai/dsh-web'
import { CRAWL4AI_ERROR_CODES, crawl, normalizeBaseURL } from './crawl4ai.js'

/**
 * Stable id this provider registers under.
 *
 * A deployment selects it with `fetchProvider: ben-crawl4ai` on the `web` row;
 * it is also the row id this plugin's configuration page edits, so one name
 * identifies the provider everywhere a person meets it.
 */
export const CRAWL4AI_FETCH_PROVIDER_ID = 'ben-crawl4ai'

/** Map this module's failure codes onto the seam's `WebError` codes. */
const WEB_ERROR_CODES = {
  [CRAWL4AI_ERROR_CODES.invalidUrl]: 'WEB_INVALID_URL',
  [CRAWL4AI_ERROR_CODES.config]: 'WEB_PROVIDER_ERROR',
  [CRAWL4AI_ERROR_CODES.timeout]: 'WEB_FETCH_TIMEOUT',
  [CRAWL4AI_ERROR_CODES.aborted]: 'WEB_ABORTED',
  [CRAWL4AI_ERROR_CODES.provider]: 'WEB_PROVIDER_ERROR',
}

/**
 * Translate a crawl failure into the seam's error type.
 *
 * @param error - whatever the crawl threw.
 * @returns the `WebError` the seam and its tool layer expect.
 */
export function toWebError(error) {
  const code = WEB_ERROR_CODES[error?.code] ?? 'WEB_PROVIDER_ERROR'
  return new WebError(error instanceof Error ? error.message : String(error), code, { cause: error })
}

/**
 * Crawl4AI-backed fetch provider.
 *
 * Options are read through `readOptions` on every call rather than captured at
 * registration: the row's fields are volatile, so an edit on the configuration
 * page must reach the next fetch without moving the registration (which would
 * make provider selection flicker while a person types).
 */
export class Crawl4aiFetchProvider {
  /** The registry key this provider is stored under. */
  id = CRAWL4AI_FETCH_PROVIDER_ID

  /**
   * @param readOptions - thunk returning the options for one crawl.
   */
  constructor(readOptions) {
    this.readOptions = readOptions
  }

  /**
   * Whether this provider can run right now.
   *
   * A cheap synchronous parse of the configured URL, as the seam requires —
   * it never touches the network. An unset or unusable URL reports the
   * provider unavailable, which the seam surfaces before any fetch is made,
   * rather than failing every call.
   *
   * @returns true when a crawl could be attempted.
   */
  available() {
    return normalizeBaseURL(this.readOptions().baseURL) !== undefined
  }

  /**
   * Retrieve one URL as Markdown.
   *
   * @param request - the fetch request; only `url` is used.
   * @param signal - caller cancellation, forwarded to the request.
   * @returns the retrieval outcome; a non-2xx target page resolves descriptively.
   * @throws {WebError} when the page could not be retrieved at all.
   */
  async fetch(request, signal) {
    try {
      return await crawl({ ...this.readOptions(), url: request.url }, signal)
    } catch (error) {
      if (error instanceof WebError) throw error
      throw toWebError(error)
    }
  }
}
