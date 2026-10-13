import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUnrestrictedController } from '../src/client/controller.ts'
import { DEFAULT_MODULES, MODULE_IDS, NO_MODULES } from '../src/module-config.js'

function controllerFixture(initial = {}, acceptMutation = true) {
  let value = { enabled: true, ...DEFAULT_MODULES, ...initial }
  const pendingPreviews = []
  const subscribers = new Set()
  const writes = []
  const mutations = []
  const form = {
    getSnapshot: () => ({ status: 'ready', writable: true, value }),
    subscribe: listener => { subscribers.add(listener); return () => subscribers.delete(listener) },
    set: async (field, next) => {
      writes.push({ field, next })
      value = { ...value, [field]: next }
      for (const listener of subscribers) listener()
      return true
    },
    mutate: async ops => {
      mutations.push(structuredClone(ops))
      if (!acceptMutation) return false
      for (const op of ops) {
        assert.equal(op.op, 'set')
        assert.equal(op.path.length, 1)
        value = { ...value, [op.path[0]]: op.value }
      }
      for (const listener of subscribers) listener()
      return true
    },
  }
  const connection = { rpc: { call: async (_channel, endpoint) => {
    if (endpoint === 'status' || endpoint === 'recheck') return { ok: true, value: { enabled: value.enabled, modes: {}, modules: [], usage: {} } }
    if (endpoint === 'preview') return new Promise(resolve => { pendingPreviews.push(resolve) })
    throw new Error(`unexpected endpoint: ${endpoint}`)
  } } }
  const ctx = {
    get: name => { assert.equal(name, 'connection'); return connection },
    configForms: { get: name => { assert.equal(name, 'unrestricted'); return form } },
    remote: { $on: () => () => {} },
    effect: fn => fn(),
  }
  return {
    face: createUnrestrictedController(ctx).face(), writes, mutations,
    finishPreview: (text = 'stale preview', index = 0) => pendingPreviews[index]({ ok: true, value: { available: true, text } }),
  }
}

test('a module switch persists its own native setting and mirrors the resulting configuration', async () => {
  const { face, writes } = controllerFixture()
  await face.refresh()
  await face.setModule('fiction', false)
  assert.deepEqual(writes, [{ field: 'fiction', next: false }])
  const view = face.hooks.view.getSnapshot()
  assert.equal(view.modules.fiction, false)
  assert.equal(view.modules.resources, true)
  assert.equal(view.enabled, true)
})

test('a preview started before a module change cannot restore stale text after the change', async () => {
  const { face, finishPreview } = controllerFixture()
  await face.refresh()
  const pending = face.loadPreview('standard')
  assert.equal(face.hooks.view.getSnapshot().previews.standard.status, 'loading')
  await face.setModule('resources', false)
  await face.refresh()
  finishPreview()
  await pending
  assert.equal(face.hooks.view.getSnapshot().previews.standard, undefined)
})

test('refresh discards a cached preview even when the module selection stays the same', async () => {
  const { face, finishPreview } = controllerFixture()
  await face.refresh()
  const first = face.loadPreview('standard')
  finishPreview('previous prompt')
  await first
  await face.refresh()
  assert.equal(face.hooks.view.getSnapshot().previews.standard, undefined)
  const next = face.loadPreview('standard')
  finishPreview('updated prompt', 1)
  await next
  assert.equal(face.hooks.view.getSnapshot().previews.standard.preview.text, 'updated prompt')
})

for (const action of ['refresh', 'recheck']) {
  test(`a preview from before ${action} cannot overwrite the newly loaded preview`, async () => {
    const { face, finishPreview } = controllerFixture()
    await face.refresh()
    const previous = face.loadPreview('standard')
    await face[action]()
    const current = face.loadPreview('standard')
    finishPreview('current prompt', 1)
    await current
    finishPreview('obsolete prompt', 0)
    await previous
    assert.equal(face.hooks.view.getSnapshot().previews.standard.preview.text, 'current prompt')
  })
}

test('disabling the master switch discards an in-flight enabled preview', async () => {
  const { face, finishPreview } = controllerFixture()
  await face.refresh()
  const pending = face.loadPreview('standard')
  await face.setEnabled(false)
  finishPreview()
  await pending
  assert.equal(face.hooks.view.getSnapshot().enabled, false)
  assert.equal(face.hooks.view.getSnapshot().previews.standard, undefined)
})

for (const [group, expected] of [
  ['general', ['delivery', 'targets']],
  ['auxiliary', ['language', 'environment', 'runtimeCoordination']],
  ['all', [...MODULE_IDS]],
]) {
  test(`${group} shortcut enables its requested modules atomically and preserves other choices`, async () => {
    const before = { ...NO_MODULES, resources: true }
    const { face, writes, mutations } = controllerFixture({ ...before, enabled: false })
    await face.refresh()
    await face.enableModules(group)
    assert.equal(mutations.length, 1, 'one user action must produce one native mutation')
    assert.equal(writes.length, 0, 'batch action must not issue scalar writes')
    assert.deepEqual(mutations[0].map(op => op.path[0]), expected)
    const view = face.hooks.view.getSnapshot()
    for (const id of MODULE_IDS) {
      assert.equal(view.modules[id], expected.includes(id) ? true : before[id], `unexpected change to ${id}`)
    }
    assert.equal(view.enabled, false, 'master switch must preserve its existing state')
  })
}

test('a refused native group mutation retains the current choices and reports the failure', async () => {
  const { face } = controllerFixture({ ...NO_MODULES, enabled: false }, false)
  await face.refresh()
  await face.enableModules('all')
  const view = face.hooks.view.getSnapshot()
  assert.deepEqual(view.modules, NO_MODULES)
  assert.equal(view.enabled, false)
  assert.match(view.message, /not saved/)
})
