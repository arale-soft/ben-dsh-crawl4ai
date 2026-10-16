/**
 * Tests for the browser half.
 *
 * The bundle is a `window.__ModuleLoader__.load({ … })` script with no bundler
 * step, so a typo in a primitive's name, a stray `@deepseek-ai/*` import, or a
 * slot key that does not match the row `cordis.patch.yml` inserts would only
 * surface as a broken page — or, for a stray import, as a failed Web UI plugin
 * load. This harness evaluates the bundle with the module loader stubbed and
 * drives `apply` against a fake context, so all of that is checked offline.
 *
 * The primitive names below mirror the real export list of
 * `@deepseek-ai/dsh-client-ui-primitives`; requiring a name absent from it, or
 * any module that is not an external the loader seeds, fails here rather than
 * in the browser.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CONTENT_SOURCES,
  DEFAULT_CONTENT_SOURCE,
  DEFAULT_FETCH_MODE,
  DEFAULT_MD_FILTER,
  FETCH_MODES,
  MD_FILTERS,
} from '../lib/crawl4ai.js'

/** Every value export of the shipped client-ui-primitives 0.2.0-rc.2. */
const PRIMITIVE_EXPORTS = [
  'Button',
  'IconSettingsOutlineMedium',
  'IconSettingsOutlineRegular',
  'Input',
  'MenuItemButton',
  'SegmentedControl',
  'SettingsForm',
  'SettingsFormModel',
  'SettingsSecretField',
  'SettingsValueField',
  'Switch',
  'Tag',
  'modalSelector',
  'settingsNumberField',
  'settingsTextField',
]

/** Module ids a bundle may require; requiring anything else fails the UI load. */
const ALLOWED_MODULES = new Set(['react', '@deepseek-ai/dsh-client-ui-primitives'])

/** Names in the stub whose `displayName` the assertions look for. */
const COMPONENTS = new Set([
  'SegmentedControl',
  'SettingsForm',
  'SettingsSecretField',
  'SettingsValueField',
  'Switch',
])

/**
 * Build the `@deepseek-ai/dsh-client-ui-primitives` stub and record its use.
 * @returns the stub namespace and the observations the tests assert on.
 */
function buildPrimitivesStub() {
  const seen = { specs: undefined, secrets: undefined, binds: 0, disposes: 0, actions: new Map() }
  const primitives = {}
  for (const name of PRIMITIVE_EXPORTS) {
    if (COMPONENTS.has(name)) {
      primitives[name] = function StubComponent() {}
      primitives[name].displayName = name
    } else if (name === 'settingsTextField' || name === 'settingsNumberField') {
      primitives[name] = (field) => ({ kind: name, field })
    } else if (name === 'SettingsFormModel') {
      primitives[name] = class SettingsFormModelStub {
        constructor(_scope, specs, secrets) {
          seen.specs = specs
          seen.secrets = secrets
          this.store = { kind: 'snapshot-store' }
        }
        bind() {
          seen.binds += 1
          return this.store
        }
        shell() {
          return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
        }
        field(name) {
          return { text: `value-of-${name}`, overridden: false, invalid: false }
        }
        actions() {
          const record = []
          seen.actions.set('calls', record)
          return {
            edit: (field, text) => record.push(['edit', field, text]),
            resetField: (field) => record.push(['resetField', field]),
            save: () => record.push(['save']),
            discard: () => record.push(['discard']),
          }
        }
        dispose() {
          seen.disposes += 1
        }
      }
    } else {
      primitives[name] = function Stub() {}
    }
  }
  return { primitives, seen }
}

/**
 * Evaluate the bundle with the module loader and the primitives stubbed.
 *
 * The import is cache-busted so each test observes a fresh evaluation: the
 * bundle is a script whose only output is the loader call, and ESM would
 * otherwise run it once for the whole file.
 *
 * @returns the captured definition, the module's exports, and the stub observations.
 */
async function loadBundle() {
  let definition
  globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value } } }
  const url = new URL('../lib/client/index.js', import.meta.url)
  url.searchParams.set('case', String((loadBundle.case = (loadBundle.case ?? 0) + 1)))
  await import(url.href)
  assert.ok(definition !== undefined, 'the bundle must call window.__ModuleLoader__.load')

  const { primitives, seen } = buildPrimitivesStub()
  const requested = []
  const requires = (id) => {
    requested.push(id)
    if (!ALLOWED_MODULES.has(id)) throw new Error(`bundle required a non-external module: ${id}`)
    if (id === 'react') {
      return {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      }
    }
    return primitives
  }
  const module = definition.factory(requires)
  return { definition, module, seen, requested }
}

/**
 * A stand-in for the browser plugin context, recording what `apply` does.
 * @returns the context and its recorded observations.
 */
function fakeContext() {
  const seen = {
    dictionaries: [],
    namespaces: [],
    whileServed: [],
    injected: [],
    registrations: [],
    effects: [],
  }
  const ctx = {
    locale: {
      register: (ns, dicts) => {
        seen.dictionaries.push({ ns, dicts })
        return () => {}
      },
    },
    effect: (fn, label) => {
      seen.effects.push(label)
      const disposer = fn()
      return () => disposer?.()
    },
    configForms: {
      get: (ns) => {
        seen.namespaces.push(ns)
        return { ns }
      },
      whileServed: (namespaces, register) => {
        seen.whileServed.push(namespaces)
        return register(new Set(namespaces))
      },
    },
    slots: {
      inject: (name, register) => {
        seen.injected.push(name)
        return register()
      },
      register: (options, component) => {
        seen.registrations.push({ options, component })
        return () => {}
      },
    },
  }
  return { ctx, seen }
}

/** One page-view state, overridable per test. */
function pageState(overrides = {}) {
  return {
    available: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    crawl4aiUrl: { text: '', overridden: false, invalid: false },
    authHeaderName: { text: '', overridden: false, invalid: false },
    authHeaderValue: { text: '', overridden: false, invalid: false },
    fetchMode: { text: DEFAULT_FETCH_MODE, overridden: false, invalid: false },
    content_source: { text: DEFAULT_CONTENT_SOURCE, overridden: false, invalid: false },
    only_text: { text: 'false', overridden: false, invalid: false },
    f: { text: DEFAULT_MD_FILTER, overridden: false, invalid: false },
    ...overrides,
  }
}

/**
 * Apply the bundle and hand back the single slot registration it made.
 * @returns the registration and the stub observations.
 */
async function registered() {
  const { module, seen } = await loadBundle()
  const { ctx, seen: context } = fakeContext()
  module.apply(ctx)
  assert.equal(context.registrations.length, 1, 'expected exactly one slot registration')
  return { registration: context.registrations[0], context, seen, module }
}

/**
 * Depth-first collect every element object in a rendered tree.
 *
 * A card-defined component (`Crawl4aiChoiceField`, `Crawl4aiToggleField`) is a
 * function element rather than a host element, so it is invoked and its result
 * walked: React would do the same, and without this the primitives those
 * components render would be invisible to every assertion below.
 */
function flatten(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  if (!('type' in node) || !('props' in node)) return out
  out.push(node)
  if (typeof node.type === 'function' && node.type.displayName?.startsWith('Crawl4ai')) {
    flatten(node.type(node.props), out)
    return out
  }
  flatten(node.props.children, out)
  return out
}

/** Collect elements of one stubbed component type. */
function elementsOfType(tree, displayName) {
  return flatten(tree).filter((node) => node.type?.displayName === displayName)
}

test('the bundle requires only externals the loader seeds', async () => {
  const { requested } = await loadBundle()
  assert.deepEqual([...new Set(requested)].sort(), ['@deepseek-ai/dsh-client-ui-primitives', 'react'])
})

test('the bundle exposes the cordis plugin shape and its public constants', async () => {
  const { definition, module } = await loadBundle()
  assert.equal(definition.id, 'ben-dsh-crawl4ai')
  assert.deepEqual(module.inject, ['slots', 'locale', 'configForms'])
  assert.equal(typeof module.apply, 'function')
  assert.equal(module.ROW_ID, 'ben-crawl4ai')
  assert.equal(module.ROW_CONFIG_KEY, 'ben-dsh-crawl4ai#ben-crawl4ai')
})

test('the zh and en dictionaries declare exactly the same keys', async () => {
  const { context } = await registered()
  const [{ ns, dicts }] = context.dictionaries
  assert.equal(ns, 'ben-dsh-crawl4ai')
  assert.deepEqual(
    Object.keys(dicts.zh).sort(),
    Object.keys(dicts.en).sort(),
    'a key missing from one dictionary falls back silently, so both stay complete',
  )
})

test('apply binds the row entry id, every field, and the keyed slot', async () => {
  const { registration, context, seen } = await registered()

  assert.deepEqual(context.namespaces, ['ben-crawl4ai'], 'the settings namespace is the row entry id')
  assert.deepEqual(context.whileServed, [['ben-crawl4ai']])
  assert.deepEqual(context.injected, ['plugins.row.config'])
  assert.equal(registration.options.name, 'plugins.row.config')
  assert.equal(registration.options.key, 'ben-dsh-crawl4ai#ben-crawl4ai', 'the key is <package>#<row id>')
  assert.equal(registration.options.locale, 'ben-dsh-crawl4ai')

  assert.deepEqual(
    seen.specs.map((spec) => spec.field),
    // Every config field is bound; the two limits stay off the page, so they
    // are absent here while still living in the schema.
    ['crawl4aiUrl', 'authHeaderName', 'authHeaderValue', 'fetchMode', 'content_source', 'only_text', 'f'],
  )
  assert.deepEqual(seen.secrets, [], 'no control writes outside the row section')
  assert.equal(seen.binds, 1)
  // The form subscription is released through an effect, so unloading the
  // plugin cannot leave the shared mirror subscribed.
  assert.ok(context.effects.some((label) => label.includes('form subscription')))
})

test('the slot registration injects the store under the hook the card reads', async () => {
  const { registration } = await registered()
  const injected = registration.options.inject()
  // `standardHookPropName` turns the `crawl4aiCard` key into `useCrawl4aiCard`.
  assert.equal(injected.hooks.crawl4aiCard.kind, 'snapshot-store')
  for (const action of ['edit', 'resetField', 'save', 'discard']) {
    assert.equal(typeof injected[action], 'function', `${action} must reach the card`)
  }
})

test('the row summary view renders the one-liner', async () => {
  const { registration } = await registered()
  assert.equal(registration.component({ view: 'summary', t: (key) => key }), 'description')
})

test('the page view renders the URL, the header name, and the masked header value', async () => {
  const { registration } = await registered()
  const edits = []
  const tree = registration.component({
    view: 'page',
    t: (key) => key,
    useCrawl4aiCard: (select) => select(pageState({
      crawl4aiUrl: { text: 'https://ca.example:1443', overridden: true, invalid: false },
      authHeaderName: { text: 'Authorization', overridden: false, invalid: false },
    })),
    save: () => {},
    discard: () => {},
    edit: (field, text) => edits.push([field, text]),
    resetField: (field) => edits.push(['reset', field]),
  })

  const forms = elementsOfType(tree, 'SettingsForm')
  assert.equal(forms.length, 1)
  assert.equal(forms[0].props.labels.save, 'save')
  // The card reads the injected form actions, which the slot spreads onto
  // props alongside `hooks`, and forwards save/discard to the shared frame.
  assert.equal(typeof forms[0].props.onSave, 'function')
  assert.equal(typeof forms[0].props.onDiscard, 'function')

  const values = elementsOfType(tree, 'SettingsValueField')
  assert.deepEqual(values.map((node) => node.props.id), [
    'ben-crawl4ai-url',
    'ben-crawl4ai-auth-header-name',
  ])
  assert.equal(values[0].props.text, 'https://ca.example:1443')
  assert.equal(values[0].props.overridden, true, 'an override is offered a reset')
  assert.equal(values[1].props.text, 'Authorization')

  const secrets = elementsOfType(tree, 'SettingsSecretField')
  assert.equal(secrets.length, 1, 'the header value is the one masked control')
  assert.equal(secrets[0].props.id, 'ben-crawl4ai-auth-header-value')
  assert.equal(secrets[0].props.configured, false)
  assert.equal(secrets[0].props.stateLabel, 'headerValue.unset')

  values[1].props.onEdit('X-API-Key')
  values[0].props.onReset()
  assert.deepEqual(edits, [['authHeaderName', 'X-API-Key'], ['reset', 'crawl4aiUrl']])
})

test('the mode control offers every endpoint and reports the staged one', async () => {
  const { registration } = await registered()
  const edits = []
  const tree = registration.component({
    view: 'page',
    t: (key) => key,
    useCrawl4aiCard: (select) => select(pageState({
      fetchMode: { text: FETCH_MODES.crawl, overridden: true, invalid: false },
    })),
    save: () => {},
    discard: () => {},
    edit: (field, text) => edits.push([field, text]),
    resetField: (field) => edits.push(['reset', field]),
  })

  const [mode] = elementsOfType(tree, 'SegmentedControl')
  assert.equal(mode.props.id, 'ben-crawl4ai-fetch-mode')
  assert.equal(mode.props.value, FETCH_MODES.crawl)
  assert.deepEqual(mode.props.options.map((option) => option.value), Object.values(FETCH_MODES))
  assert.deepEqual(
    mode.props.options.map((option) => option.label),
    ['fetchMode.crawl_stream', 'fetchMode.crawl', 'fetchMode.md'],
    'each segment is labelled through this page\'s dictionary',
  )
  mode.props.onChange(FETCH_MODES.md)
  assert.deepEqual(edits, [['fetchMode', FETCH_MODES.md]])
})

test('the card offers only the selected mode\'s options', async () => {
  const { registration } = await registered()
  /**
   * Render the page for one fetch mode.
   * @param mode - the mode the section stages.
   * @returns the rendered tree.
   */
  const render = (mode) => registration.component({
    view: 'page',
    t: (key) => key,
    useCrawl4aiCard: (select) => select(pageState({ fetchMode: { text: mode, overridden: false, invalid: false } })),
    save: () => {},
    discard: () => {},
    edit: () => {},
    resetField: () => {},
  })

  for (const mode of [FETCH_MODES.crawlStream, FETCH_MODES.crawl]) {
    const tree = render(mode)
    const ids = elementsOfType(tree, 'SegmentedControl').map((node) => node.props.id)
    // The two crawl endpoints share a body, so they share these two options.
    assert.deepEqual(
      ids,
      ['ben-crawl4ai-fetch-mode', 'ben-crawl4ai-content-source'],
      `${mode} offers content_source and no md filter`,
    )
    assert.deepEqual(
      elementsOfType(tree, 'SegmentedControl')[1].props.options.map((option) => option.value),
      [...CONTENT_SOURCES],
    )
    const [onlyText] = elementsOfType(tree, 'Switch')
    assert.equal(onlyText.props.checked, false)
    assert.equal(elementsOfType(tree, 'Switch').length, 1, 'only_text is the one toggle')
  }

  const mdTree = render(FETCH_MODES.md)
  assert.deepEqual(
    elementsOfType(mdTree, 'SegmentedControl').map((node) => node.props.id),
    ['ben-crawl4ai-fetch-mode', 'ben-crawl4ai-md-filter'],
    '/md offers its own filter and neither crawl option',
  )
  assert.deepEqual(
    elementsOfType(mdTree, 'SegmentedControl')[1].props.options.map((option) => option.value),
    [...MD_FILTERS],
  )
  assert.equal(elementsOfType(mdTree, 'Switch').length, 0, '/md ignores only_text')
})

test('the toggle and the choices stage their own field writes', async () => {
  const { registration } = await registered()
  const edits = []
  const tree = registration.component({
    view: 'page',
    t: (key) => key,
    useCrawl4aiCard: (select) => select(pageState({
      content_source: { text: DEFAULT_CONTENT_SOURCE, overridden: true, invalid: false },
      only_text: { text: 'false', overridden: false, invalid: false },
    })),
    save: () => {},
    discard: () => {},
    edit: (field, text) => edits.push([field, text]),
    resetField: (field) => edits.push(['reset', field]),
  })

  const [, contentSource] = elementsOfType(tree, 'SegmentedControl')
  contentSource.props.onChange('raw_html')
  assert.deepEqual(edits, [['content_source', 'raw_html']])

  const [onlyText] = elementsOfType(tree, 'Switch')
  onlyText.props.onChange(true)
  // The form model stages text, so a boolean is carried as its own literal.
  assert.deepEqual(edits[1], ['only_text', 'true'])
})

test('the card falls back to the default mode when the section carries none', async () => {
  const { registration } = await registered()
  const tree = registration.component({
    view: 'page',
    t: (key) => key,
    // An unresolved or unrecognized mode must still leave the page showing a
    // mode whose options are on screen.
    useCrawl4aiCard: (select) => select(pageState({ fetchMode: { text: undefined, overridden: false, invalid: false } })),
    save: () => {},
    discard: () => {},
    edit: () => {},
    resetField: () => {},
  })
  const [mode] = elementsOfType(tree, 'SegmentedControl')
  assert.equal(mode.props.value, DEFAULT_FETCH_MODE)
  assert.deepEqual(
    elementsOfType(tree, 'SegmentedControl').map((node) => node.props.id),
    ['ben-crawl4ai-fetch-mode', 'ben-crawl4ai-content-source'],
  )
})

test('the client option lists stay in step with the host schema', async () => {
  const { module } = await loadBundle()
  // The browser half cannot import the host half, so it repeats these lists;
  // this pins the repetition so a choice added on one side alone fails here.
  assert.deepEqual([...module.FETCH_MODE_VALUES], Object.values(FETCH_MODES))
  assert.deepEqual([...module.CONTENT_SOURCE_VALUES], [...CONTENT_SOURCES])
  assert.deepEqual([...module.MD_FILTER_VALUES], [...MD_FILTERS])
  assert.equal(module.DEFAULT_FETCH_MODE, DEFAULT_FETCH_MODE)
  assert.equal(module.DEFAULT_CONTENT_SOURCE, DEFAULT_CONTENT_SOURCE)
  assert.equal(module.DEFAULT_MD_FILTER, DEFAULT_MD_FILTER)
})

test('the masked control reports a configured header value and stays editable', async () => {
  const { registration } = await registered()
  const tree = registration.component({
    view: 'page',
    t: (key) => key,
    useCrawl4aiCard: (select) => select(pageState({
      authHeaderValue: { text: 'Bearer token', overridden: true, invalid: false },
    })),
    save: () => {},
    discard: () => {},
    edit: () => {},
    resetField: () => {},
  })
  const [secret] = elementsOfType(tree, 'SettingsSecretField')
  assert.equal(secret.props.configured, true)
  assert.equal(secret.props.stateLabel, 'headerValue.set')
  assert.equal(secret.props.disabled, false)
  assert.equal(secret.props.text, 'Bearer token')
})

test('a read-only deployment disables every control', async () => {
  const { registration } = await registered()
  const tree = registration.component({
    view: 'page',
    t: (key) => key,
    useCrawl4aiCard: (select) => select(pageState({ writable: false })),
    save: () => {},
    discard: () => {},
    edit: () => {},
    resetField: () => {},
  })
  const controls = flatten(tree).filter((node) => node.props?.disabled !== undefined)
  // Nothing that can change a value may stay enabled on a read-only document:
  // the two text fields, the masked field, the mode control, and the two
  // controls of the selected mode. The card's own field wrappers carry the same
  // flag, so every flagged element — control or wrapper — is checked.
  assert.ok(controls.length > 0)
  assert.ok(controls.every((node) => node.props.disabled === true))

  const primitiveControls = flatten(tree).filter((node) => [
    'SegmentedControl',
    'SettingsSecretField',
    'SettingsValueField',
    'Switch',
  ].includes(node.type?.displayName))
  assert.deepEqual(
    primitiveControls.map((node) => node.type.displayName),
    [
      'SettingsValueField',
      'SettingsValueField',
      'SettingsSecretField',
      'SegmentedControl',
      'SegmentedControl',
      'Switch',
    ],
  )
})
