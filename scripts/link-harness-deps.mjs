#!/usr/bin/env node
/**
 * Make this plugin loadable while it is installed into a profile as a `link:`
 * dependency.
 *
 * WHY THIS EXISTS
 *
 * `dsh plugin --profile <name> add <absolute path>` records the dependency as
 * `link:<path>`, so `node_modules/<this package>` inside the profile is a
 * junction pointing back at this directory. Node resolves a module's import
 * specifiers from its REAL path, which means the walk up for `@deepseek-ai/…`
 * starts here — at this directory — and never visits the profile's own
 * resolution root (`$DSH_HOME/profiles/node_modules`, where the harness
 * junctions every package it provides).
 *
 * A plugin installed from a registry or a tarball does not have this problem:
 * pnpm materializes it inside the profile, so the walk up reaches the harness
 * packages on its own. This script reproduces exactly that reachability for the
 * in-place development install, by junctioning each package this plugin
 * declares in `peerDependencies` into this directory's own `node_modules`.
 *
 * The junction targets are the harness's own files, so the instance this plugin
 * imports is the SAME module instance the harness uses — which matters for
 * `instanceof` checks such as the `WebError` the web seam hands to its tool
 * layer.
 *
 * USAGE
 *
 *   node scripts/link-harness-deps.mjs [--root <profiles node_modules>]
 *
 * `--root` defaults to `$DSH_PROFILE_DIR/../node_modules`, which is the
 * resolution root every profile-installed plugin already resolves through.
 * Re-run after changing `peerDependencies`. Safe to re-run.
 *
 * @module ben-dsh-crawl4ai/scripts/link-harness-deps
 */
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Resolve the resolution roots, in the order Node itself would walk them from
 * a plugin installed inside the profile.
 *
 * That order has two tiers and they are not interchangeable: the profile's own
 * `node_modules` carries the packages a plugin pulled from the registry
 * (`@deepseek-ai/schemastery` among them), while `$DSH_HOME/profiles/node_modules`
 * carries everything the harness provides. Nearest wins, so a package present
 * in both must be taken from the profile tier — taking the harness tier's copy
 * instead would hand this plugin a different module instance (and, for
 * schemastery, a build without the `.volatile()` marker the settings page
 * needs).
 *
 * @param argv - the process arguments.
 * @returns the absolute directories, nearest first.
 */
function resolveHarnessRoots(argv) {
  const flag = argv.indexOf('--root')
  if (flag !== -1) {
    const value = argv[flag + 1]
    if (value === undefined) throw new Error('--root needs a directory')
    return [resolve(value)]
  }
  const profileDir = process.env.DSH_PROFILE_DIR
  if (profileDir === undefined || profileDir === '') {
    throw new Error(
      'cannot locate the harness packages: pass --root <node_modules>, '
      + 'or set DSH_PROFILE_DIR (the harness sets it for its child processes)',
    )
  }
  return [resolve(profileDir, 'node_modules'), resolve(dirname(profileDir), 'node_modules')]
}

/**
 * Locate a package in the first root that holds it.
 *
 * @param roots - the resolution roots, nearest first.
 * @param name - the package name.
 * @returns the package directory, or `undefined` when no root has it.
 */
function findProvidedPackage(roots, name) {
  for (const root of roots) {
    const candidate = join(root, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Read the packages this plugin needs the harness to provide.
 *
 * @returns the package names, deduplicated.
 */
function readProvidedPackages() {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  return [...new Set([
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.dependencies ?? {}),
  ])]
}

/**
 * Whether a path already is a junction (or symlink) pointing at the target.
 *
 * @param path - the link path.
 * @param target - the directory it should point at.
 * @returns true when the existing link is already correct.
 */
function linkIsCorrect(path, target) {
  try {
    return resolve(dirname(path), readlinkSync(path)) === resolve(target)
  } catch {
    return false
  }
}

const harnessRoots = resolveHarnessRoots(process.argv.slice(2))
const nodeModules = join(packageRoot, 'node_modules')
mkdirSync(nodeModules, { recursive: true })

let linked = 0
const missing = []
for (const name of readProvidedPackages()) {
  const source = findProvidedPackage(harnessRoots, name)
  if (source === undefined) {
    missing.push(name)
    continue
  }
  const link = join(nodeModules, name)
  if (linkIsCorrect(link, source)) continue
  // A package that pnpm actually installed here would be a second copy of a
  // module the harness also holds; replace it so there is exactly one instance.
  rmSync(link, { recursive: true, force: true })
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(source, link, 'junction')
  console.log(`linked ${name} -> ${source}`)
  linked += 1
}

console.log(`searched: ${harnessRoots.join(' , ')}`)
console.log(`linked ${String(linked)} package(s) into ${nodeModules}`)
if (missing.length > 0) {
  console.error(`not found under the harness root: ${missing.join(', ')}`)
  process.exitCode = 1
}
