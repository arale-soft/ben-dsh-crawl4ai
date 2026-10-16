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
    const FIELD_FETCH_MODE = 'fetchMode'
    const FIELD_CONTENT_SOURCE = 'content_source'
    const FIELD_ONLY_TEXT = 'only_text'
    const FIELD_MD_FILTER = 'f'

    // The option lists are declared HERE as well as in `lib/crawl4ai.js`,
    // because a browser bundle cannot import the host half. `client.test.mjs`
    // pins the two together, so a choice added on one side without the other
    // fails the suite instead of leaving this page offering a value the schema
    // refuses.

    /** The endpoints this page can select, in display order. */
    const FETCH_MODE_VALUES = ['crawl_stream', 'crawl', 'md']
    /** The endpoint selected when the section carries none. */
    const DEFAULT_FETCH_MODE = 'crawl_stream'
    /** The HTML sources `DefaultMarkdownGenerator` accepts, in display order. */
    const CONTENT_SOURCE_VALUES = ['cleaned_html', 'raw_html', 'fit_html']
    /** The source selected when the section carries none. */
    const DEFAULT_CONTENT_SOURCE = 'cleaned_html'
    /** The `/md` filters this page offers, in display order. */
    const MD_FILTER_VALUES = ['fit', 'raw']
    /** The filter selected when the section carries none. */
    const DEFAULT_MD_FILTER = 'fit'

    // Field chrome, mirroring `lib/settings-form/fields.module.css` of the
    // primitives: the primitives own the text and secret controls, but they
    // export no choice or toggle field, and a browser bundle cannot import
    // their stylesheet. The tokens below are the same ones that sheet uses.
    const FIELD_STYLE = {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '12px 0',
      borderTop: '0.5px solid var(--dsw-alias-border-l2)',
    }
    const HEAD_STYLE = { display: 'flex', alignItems: 'center', gap: '8px' }
    const LABEL_STYLE = {
      flex: '1',
      minWidth: '0',
      fontSize: '13px',
      fontWeight: '500',
      lineHeight: '1.5',
      color: 'var(--dsw-alias-label-primary)',
    }
    const BADGES_STYLE = { display: 'inline-flex', alignItems: 'center', gap: '8px' }
    const HINT_STYLE = {
      margin: '0',
      fontSize: '12px',
      lineHeight: '1.5',
      color: 'var(--dsw-alias-label-tertiary)',
    }

    /**
     * The reset control's style; a disabled one keeps the text colour but drops
     * the pointer, as the primitives' own sheet does.
     * @param disabled - whether the control refuses changes.
     * @returns the inline style.
     */
    function resetStyle(disabled) {
      return {
        border: 'none',
        background: 'none',
        padding: '0',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '1.5',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: disabled ? 'default' : 'pointer',
      }
    }

    /**
     * Render one field's label line, with the override badge and reset that the
     * primitives' own controls show.
     * @param props - the field's copy and its edit state.
     * @returns the head row, or `null` when there is nothing to show.
     */
    function fieldHead(props) {
      return react.createElement(
        'div',
        { style: HEAD_STYLE },
        react.createElement('span', { style: LABEL_STYLE }, props.label),
        props.overridden
          ? react.createElement(
            'span',
            { style: BADGES_STYLE },
            react.createElement(primitives.Tag, { tone: 'neutral' }, props.overriddenLabel),
            react.createElement(
              'button',
              {
                type: 'button',
                style: resetStyle(props.disabled),
                disabled: props.disabled,
                onClick: props.onReset,
              },
              props.resetLabel,
            ),
          )
          : null,
      )
    }

    /**
     * A choice field: a segmented control over one field's accepted values.
     *
     * `SegmentedControl` names the panel it controls (`<id>-<value>-panel`), so
     * the panel is rendered here for the SELECTED segment only and carries that
     * choice's explanation. Rendering no panel would leave every tab pointing at
     * an element that does not exist.
     *
     * @param props - the field name, its copy, its choices, and the edit state.
     * @returns the labelled control.
     */
    function Crawl4aiChoiceField(props) {
      const selected = props.options.find((option) => option.value === props.value) ?? props.options[0]
      const panelId = `${props.id}-${selected.value}-panel`
      return react.createElement(
        'div',
        { style: FIELD_STYLE },
        fieldHead(props),
        react.createElement(primitives.SegmentedControl, {
          id: props.id,
          value: selected.value,
          label: props.label,
          disabled: props.disabled,
          options: props.options.map((option) => ({ value: option.value, label: option.label })),
          onChange: (next) => props.onEdit(props.field, next),
        }),
        react.createElement(
          'div',
          { id: panelId, role: 'tabpanel', 'aria-labelledby': `${props.id}-${selected.value}` },
          react.createElement('p', { style: HINT_STYLE }, selected.hint),
        ),
      )
    }
    Crawl4aiChoiceField.displayName = 'Crawl4aiChoiceField'

    /**
     * A boolean field: the primitives' switch, named by the visible label.
     *
     * `Switch` is a `role="switch"` button rather than a native input, so it
     * takes its accessible name from `label` and the visible text is a span
     * instead of a `<label for>` that would point at nothing.
     *
     * @param props - the field name, its copy, its state, and the edit action.
     * @returns the labelled control.
     */
    function Crawl4aiToggleField(props) {
      return react.createElement(
        'div',
        { style: FIELD_STYLE },
        react.createElement(
          'div',
          { style: HEAD_STYLE },
          react.createElement('span', { style: LABEL_STYLE }, props.label),
          props.overridden
            ? react.createElement(
              'span',
              { style: BADGES_STYLE },
              react.createElement(primitives.Tag, { tone: 'neutral' }, props.overriddenLabel),
              react.createElement(
                'button',
                {
                  type: 'button',
                  style: resetStyle(props.disabled),
                  disabled: props.disabled,
                  onClick: props.onReset,
                },
                props.resetLabel,
              ),
            )
            : null,
          react.createElement(primitives.Switch, {
            checked: props.checked,
            label: props.label,
            disabled: props.disabled,
            onChange: (next) => props.onEdit(props.field, String(next)),
          }),
        ),
        react.createElement('p', { style: HINT_STYLE }, props.hint),
      )
    }
    Crawl4aiToggleField.displayName = 'Crawl4aiToggleField'

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
      fetchMode: '抓取方式',
      'fetchMode.crawl_stream': '流式 /crawl/stream',
      'fetchMode.crawl_stream.hint': '逐条流式返回（NDJSON）。带回目标页面的状态码与重定向后的地址。',
      'fetchMode.crawl': '非流式 /crawl',
      'fetchMode.crawl.hint': '一次返回全部结果。同样带回目标页面的状态码与重定向后的地址。',
      'fetchMode.md': '仅 Markdown /md',
      'fetchMode.md.hint': '只取 Markdown。不含目标页面的状态码，且忽略 content_source 与 only_text。',
      content_source: 'content_source',
      'content_source.hint': '生成 Markdown 时使用的 HTML 来源。',
      'content_source.cleaned_html': 'cleaned_html 清理后',
      'content_source.cleaned_html.hint': '以清理后的 HTML 生成 Markdown（Crawl4AI 的默认值）。',
      'content_source.raw_html': 'raw_html 原始',
      'content_source.raw_html.hint': '以浏览器返回的原始 HTML 生成 Markdown。',
      'content_source.fit_html': 'fit_html 精简',
      'content_source.fit_html.hint': '以内容过滤后的 HTML 生成 Markdown。',
      only_text: 'only_text',
      'only_text.hint': '只提取纯文本内容。',
      f: 'f',
      'f.hint': '请求 /md 时使用的内容过滤方式。',
      'f.fit': 'fit 精简正文',
      'f.fit.hint': '服务端按可读性提取正文（该端点的默认值）。',
      'f.raw': 'raw 完整转换',
      'f.raw.hint': '直接把 DOM 转成 Markdown，不做正文提取。',
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
      fetchMode: 'Fetch mode',
      'fetchMode.crawl_stream': 'Streaming /crawl/stream',
      'fetchMode.crawl_stream.hint': 'Streams results as NDJSON. Reports the target\'s status code and its redirected URL.',
      'fetchMode.crawl': 'Non-streaming /crawl',
      'fetchMode.crawl.hint': 'Returns every result at once. Also reports the target\'s status code and its redirected URL.',
      'fetchMode.md': 'Markdown only /md',
      'fetchMode.md.hint': 'Returns Markdown alone. No target status, and content_source and only_text are ignored.',
      content_source: 'content_source',
      'content_source.hint': 'The HTML source the Markdown is generated from.',
      'content_source.cleaned_html': 'cleaned_html cleaned',
      'content_source.cleaned_html.hint': 'Generate from the cleaned HTML (Crawl4AI\'s own default).',
      'content_source.raw_html': 'raw_html original',
      'content_source.raw_html.hint': 'Generate from the raw HTML the browser returned.',
      'content_source.fit_html': 'fit_html filtered',
      'content_source.fit_html.hint': 'Generate from the content-filtered HTML.',
      only_text: 'only_text',
      'only_text.hint': 'Extract text-only content.',
      f: 'f',
      'f.hint': 'The content filter /md applies.',
      'f.fit': 'fit filtered',
      'f.fit.hint': 'The server extracts the main content by readability (this endpoint\'s default).',
      'f.raw': 'raw full',
      'f.raw.hint': 'Convert the DOM to Markdown directly, with no content extraction.',
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
     * A section field holding one of a fixed set of strings.
     *
     * The spec converts between the stored value and the draft text the form
     * model stages, so a choice is written through the same save as every other
     * field. A draft outside the set stages nothing (`undefined`), which blocks
     * the save rather than writing a value the schema would refuse; an unset or
     * unrecognized stored value reads as the documented default.
     *
     * @param field - field name inside the namespace section.
     * @param values - the accepted values.
     * @param fallback - the value shown when the section carries none of them.
     * @returns the field's conversion spec.
     */
    function choiceField(field, values, fallback) {
      return {
        field,
        format: (value) => (values.includes(value) ? value : fallback),
        parse: (text) => (values.includes(text) ? { kind: 'set', value: text } : undefined),
      }
    }

    /**
     * A section field holding a boolean.
     *
     * The draft is carried as the text `true`/`false` because the form model
     * stages text; anything else stages nothing and blocks the save.
     *
     * @param field - field name inside the namespace section.
     * @returns the field's conversion spec.
     */
    function booleanField(field) {
      return {
        field,
        format: (value) => (typeof value === 'boolean' && value ? 'true' : 'false'),
        parse: (text) => (text === 'true' || text === 'false' ? { kind: 'set', value: text === 'true' } : undefined),
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
      // A section the settings service has not resolved yet reads as the
      // default, so the controls always show the mode whose options are below.
      const mode = FETCH_MODE_VALUES.includes(state.fetchMode.text) ? state.fetchMode.text : DEFAULT_FETCH_MODE

      const shared = {
        overriddenLabel: t('overridden'),
        resetLabel: t('reset'),
        disabled,
      }

      // Only the selected mode's options are offered: `content_source` and
      // `only_text` configure the two crawl endpoints, `f` configures `/md`.
      // Their values stay in the section when the mode changes, so switching
      // back does not silently discard a choice.
      const modeFields = mode === 'md'
        ? [
          react.createElement(Crawl4aiChoiceField, {
            key: FIELD_MD_FILTER,
            id: 'ben-crawl4ai-md-filter',
            label: t('f'),
            field: FIELD_MD_FILTER,
            value: state.f.text,
            options: MD_FILTER_VALUES.map((value) => ({
              value,
              label: t(`f.${value}`),
              hint: t(`f.${value}.hint`),
            })),
            overridden: state.f.overridden,
            onEdit: props.edit,
            onReset: () => props.resetField(FIELD_MD_FILTER),
            ...shared,
          }),
        ]
        : [
          react.createElement(Crawl4aiChoiceField, {
            key: FIELD_CONTENT_SOURCE,
            id: 'ben-crawl4ai-content-source',
            label: t('content_source'),
            field: FIELD_CONTENT_SOURCE,
            value: state.content_source.text,
            options: CONTENT_SOURCE_VALUES.map((value) => ({
              value,
              label: t(`content_source.${value}`),
              hint: t(`content_source.${value}.hint`),
            })),
            overridden: state.content_source.overridden,
            onEdit: props.edit,
            onReset: () => props.resetField(FIELD_CONTENT_SOURCE),
            ...shared,
          }),
          react.createElement(Crawl4aiToggleField, {
            key: FIELD_ONLY_TEXT,
            id: 'ben-crawl4ai-only-text',
            label: t('only_text'),
            hint: t('only_text.hint'),
            field: FIELD_ONLY_TEXT,
            checked: state.only_text.text === 'true',
            overridden: state.only_text.overridden,
            onEdit: props.edit,
            onReset: () => props.resetField(FIELD_ONLY_TEXT),
            ...shared,
          }),
        ]

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
        react.createElement(Crawl4aiChoiceField, {
          id: 'ben-crawl4ai-fetch-mode',
          label: t('fetchMode'),
          field: FIELD_FETCH_MODE,
          value: mode,
          options: FETCH_MODE_VALUES.map((value) => ({
            value,
            label: t(`fetchMode.${value}`),
            hint: t(`fetchMode.${value}.hint`),
          })),
          overridden: state.fetchMode.overridden,
          onEdit: props.edit,
          onReset: () => props.resetField(FIELD_FETCH_MODE),
          ...shared,
        }),
        ...modeFields,
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
          choiceField(FIELD_FETCH_MODE, FETCH_MODE_VALUES, DEFAULT_FETCH_MODE),
          choiceField(FIELD_CONTENT_SOURCE, CONTENT_SOURCE_VALUES, DEFAULT_CONTENT_SOURCE),
          booleanField(FIELD_ONLY_TEXT),
          choiceField(FIELD_MD_FILTER, MD_FILTER_VALUES, DEFAULT_MD_FILTER),
        ],
        [],
      )
      const store = form.bind(() => ({
        ...form.shell(),
        crawl4aiUrl: form.field(FIELD_URL),
        authHeaderName: form.field(FIELD_HEADER_NAME),
        authHeaderValue: form.field(FIELD_HEADER_VALUE),
        fetchMode: form.field(FIELD_FETCH_MODE),
        content_source: form.field(FIELD_CONTENT_SOURCE),
        only_text: form.field(FIELD_ONLY_TEXT),
        f: form.field(FIELD_MD_FILTER),
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
    exports.FIELD_FETCH_MODE = FIELD_FETCH_MODE
    exports.FIELD_CONTENT_SOURCE = FIELD_CONTENT_SOURCE
    exports.FIELD_ONLY_TEXT = FIELD_ONLY_TEXT
    exports.FIELD_MD_FILTER = FIELD_MD_FILTER
    exports.FETCH_MODE_VALUES = FETCH_MODE_VALUES
    exports.DEFAULT_FETCH_MODE = DEFAULT_FETCH_MODE
    exports.CONTENT_SOURCE_VALUES = CONTENT_SOURCE_VALUES
    exports.DEFAULT_CONTENT_SOURCE = DEFAULT_CONTENT_SOURCE
    exports.MD_FILTER_VALUES = MD_FILTER_VALUES
    exports.DEFAULT_MD_FILTER = DEFAULT_MD_FILTER
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
