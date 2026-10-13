/**
 * Browser half: the configuration page for the `ben-crawl4ai` row.
 *
 * The Plugins page lists this package as an installed bundle, and the row it
 * declares gains a configure control that opens {@link Crawl4aiCard} as a full
 * page. The page is registered on the keyed slot `plugins.row.config`, keyed by
 * `<package name>#<row id>` exactly as `cordis.patch.yml` inserts the row:
 * renaming either side without the other leaves the row with no control.
 *
 * Reads and writes go through the shell's own settings surface —
 * `ctx.configForms.get(entryId)` — rather than this package's private endpoint.
 * The settings service already serves every configurable profile entry, so a
 * plugin-owned RPC channel would re-implement revision-fenced writes for one
 * namespace.
 *
 * Only value imports listed in the bundle's externals may appear in this graph;
 * every other `@deepseek-ai/*` import must be type-only. Violating that does
 * not degrade this card — it fails the whole Web UI's plugin load.
 *
 * @module ben-dsh-crawl4ai/client
 */

window.__ModuleLoader__.load({
  id: 'ben-dsh-crawl4ai',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const react = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    /** Dictionary namespace this plugin owns. */
    const NS = 'ben-dsh-crawl4ai'
    /** The profile entry id whose settings this page edits. */
    const ROW_ID = 'ben-crawl4ai'
    /** Slot key the Plugins page dispatches for this row. */
    const ROW_CONFIG_KEY = 'ben-dsh-crawl4ai#ben-crawl4ai'

    /** Field names inside the row's config section. */
    const FIELD_URL = 'crawl4aiUrl'
    const FIELD_HEADER_NAME = 'authHeaderName'
    const FIELD_HEADER_VALUE = 'authHeaderValue'

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      title: 'Crawl4AI 网页抓取',
      description: '通过自建 Crawl4AI 服务为 web_fetch 抓取网页，返回 Markdown。',
      url: 'Crawl4AI 地址',
      'url.placeholder': 'http://crawl4ai.internal:11235',
      'url.hint': '服务根地址；留空表示未配置，此时 web_fetch 会报提供方不可用。',
      headerName: '验证 Header 名称',
      'headerName.placeholder': 'Authorization',
      'headerName.hint': '例如 Authorization 或 X-API-Key；留空则不带验证请求头。',
      headerValue: '验证 Header 值',
      'headerValue.hint': '与上方的名称成对生效；留空表示不带验证请求头。此值保存在当前配置档的补丁文件中。',
      'headerValue.set': '已配置',
      'headerValue.unset': '未配置',
      overridden: '已覆盖',
      reset: '恢复默认',
      unavailable: '该插件当前未加载，暂时无法配置。',
      readOnly: '本部署的设置为只读。',
      saveFailed: '本部署没有接受这些值，已保留供你修改。',
      save: '保存',
      saving: '保存中…',
    }

    /** English dictionary, checked complete against the zh key set. */
    const en = {
      title: 'Crawl4AI fetch',
      description: 'Retrieve pages for web_fetch through your own Crawl4AI server, as Markdown.',
      url: 'Crawl4AI URL',
      'url.placeholder': 'http://crawl4ai.internal:11235',
      'url.hint': 'Server root. Left blank, the provider reports unavailable and web_fetch fails instead of fetching.',
      headerName: 'Auth header name',
      'headerName.placeholder': 'Authorization',
      'headerName.hint': 'For example Authorization or X-API-Key. Blank sends no authenticating header.',
      headerValue: 'Auth header value',
      'headerValue.hint': 'Takes effect together with the name above; blank sends no authenticating header. Stored in this profile\'s patch file.',
      'headerValue.set': 'Configured',
      'headerValue.unset': 'Not configured',
      overridden: 'Overridden',
      reset: 'Reset to default',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      readOnly: 'This deployment stores settings read-only.',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
      save: 'Save',
      saving: 'Saving…',
    }

    /**
     * The form frame's copy, read from this page's dictionary.
     * @param t - the page's locale reader.
     * @returns the labels the shared settings form renders.
     */
    function formLabels(t) {
      return {
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        save: t('save'),
        saving: t('saving'),
      }
    }

    /**
     * Render this row's one-liner or its settings form, as the Plugins page asks.
     * @param props - the view asked for, locale copy, the form snapshot, and its actions.
     * @returns the one-liner, or the form.
     */
    function Crawl4aiCard(props) {
      const { t } = props
      // The view is answered before the store is read: the row draws its
      // one-liner even in a cell that injects no hook.
      if (props.view === 'summary') return t('description')
      const state = props.useCrawl4aiCard((snapshot) => snapshot)
      const disabled = !state.writable
      const valueConfigured = String(state.authHeaderValue.text ?? '').trim() !== ''
      return react.createElement(
        primitives.SettingsForm,
        {
          labels: formLabels(t),
          state,
          onSave: props.save,
          onDiscard: props.discard,
        },
        react.createElement(primitives.SettingsValueField, {
          id: 'ben-crawl4ai-url',
          label: t('url'),
          hint: t('url.hint'),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          disabled,
          ...state.crawl4aiUrl,
          placeholder: t('url.placeholder'),
          onEdit: (text) => props.edit(FIELD_URL, text),
          onReset: () => props.resetField(FIELD_URL),
        }),
        react.createElement(primitives.SettingsValueField, {
          id: 'ben-crawl4ai-auth-header-name',
          label: t('headerName'),
          hint: t('headerName.hint'),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          disabled,
          ...state.authHeaderName,
          placeholder: t('headerName.placeholder'),
          onEdit: (text) => props.edit(FIELD_HEADER_NAME, text),
          onReset: () => props.resetField(FIELD_HEADER_NAME),
        }),
        // The token is rendered masked and reports only whether one is set. It
        // is an ordinary section field, so it is stored in the profile patch
        // rather than a credential store — the hint says so.
        react.createElement(primitives.SettingsSecretField, {
          id: 'ben-crawl4ai-auth-header-value',
          label: t('headerValue'),
          hint: t('headerValue.hint'),
          configured: valueConfigured,
          stateLabel: valueConfigured ? t('headerValue.set') : t('headerValue.unset'),
          disabled,
          text: state.authHeaderValue.text,
          onEdit: (text) => props.edit(FIELD_HEADER_VALUE, text),
        }),
      )
    }

    /** Required client services. */
    const inject = ['slots', 'locale', 'configForms']

    /**
     * Mount the configuration page while the Host serves this row's namespace.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ben-crawl4ai: card dictionaries')
      const form = new primitives.SettingsFormModel(
        ctx.configForms.get(ROW_ID),
        [
          primitives.settingsTextField(FIELD_URL),
          primitives.settingsTextField(FIELD_HEADER_NAME),
          primitives.settingsTextField(FIELD_HEADER_VALUE),
        ],
        [],
      )
      const store = form.bind(() => ({
        ...form.shell(),
        crawl4aiUrl: form.field(FIELD_URL),
        authHeaderName: form.field(FIELD_HEADER_NAME),
        authHeaderValue: form.field(FIELD_HEADER_VALUE),
      }))
      ctx.effect(() => () => {
        form.dispose()
      }, 'ben-crawl4ai: form subscription')
      // `whileServed` keeps the page absent until the Host actually serves the
      // namespace, so a deployment that never mounted the provider row shows no
      // trace of this page.
      ctx.effect(
        () => ctx.configForms.whileServed([ROW_ID], () => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: ROW_CONFIG_KEY,
          locale: NS,
          inject: () => ({ hooks: { crawl4aiCard: store }, ...form.actions() }),
        }, Crawl4aiCard))),
        'ben-crawl4ai: configure page',
      )
    }

    exports.NS = NS
    exports.ROW_ID = ROW_ID
    exports.ROW_CONFIG_KEY = ROW_CONFIG_KEY
    exports.Crawl4aiCard = Crawl4aiCard
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
