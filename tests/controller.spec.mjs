import assert from 'node:assert/strict'
import test from 'node:test'
import { createUnrestrictedController } from '../src/client/controller.ts'

const settle = () => new Promise(setImmediate)
const status = (version, enabled = true) => ({ enabled, version, modes: {} })

/** 保留真实控制器，仅控制设置提交、配置事件和 RPC 的完成时序。 */
async function fixture() {
  let value = { enabled: true }
  const subscribers = new Set()
  const events = new Map()
  const pending = {
    status: [],
    recheck: [],
    preview: [],
    'check-update': [],
    'perform-update': [],
    write: [],
  }
  function defer(endpoint, payload) {
    return new Promise((resolve, reject) => pending[endpoint].push({ payload, resolve, reject }))
  }
  const settings = {
    getSnapshot: () => ({ status: 'ready', writable: true, value }),
    subscribe(listener) {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
    set: (field, next) => defer('write', { field, next }),
  }
  const ctx = {
    get: () => ({ rpc: { call: (_channel, endpoint, payload) => defer(endpoint, payload) } }),
    configForms: { get: () => settings },
    remote: { $on(event, listener) { events.set(event, listener); return () => events.delete(event) } },
    effect: effect => effect(),
  }
  const face = createUnrestrictedController(ctx).face()
  const take = endpoint => {
    const request = pending[endpoint].shift()
    assert.ok(request, `missing ${endpoint} request`)
    return request
  }
  const answer = (request, value) => request.resolve({ ok: true, value })
  answer(take('status'), status('0.2.6'))
  await settle()
  return {
    face, take, answer,
    view: () => face.hooks.view.getSnapshot(),
    documentUpdated: () => events.get('settings/document-updated')('unrestricted'),
    commitEnabled(enabled) {
      value = { enabled }
      for (const listener of subscribers) listener()
      events.get('settings/document-updated')('unrestricted')
    },
  }
}

test('刷新或重检后，迟到的旧预览不能覆盖已显示的新正文', async () => {
  for (const action of ['refresh', 'recheck']) {
    const f = await fixture()
    const previous = f.face.loadPreview('standard')
    const previousRequest = f.take('preview')
    assert.equal(f.view().busy, false, '加载预览时界面允许刷新和重检')
    const updating = f.face[action]()
    f.answer(f.take(action === 'refresh' ? 'status' : 'recheck'), status('0.2.6'))
    await updating
    assert.equal(f.view().previews.standard, undefined)

    // 卡片在打开的预览失效后通过 effect 自动发起这一请求。
    const current = f.face.loadPreview('standard')
    f.answer(f.take('preview'), { available: true, text: 'current prompt' })
    await current
    f.answer(previousRequest, { available: true, text: 'obsolete prompt' })
    await previous
    assert.equal(f.view().previews.standard.preview.text, 'current prompt', action)
  }
})

test('失效预览的迟到错误不影响新请求，不同预设分别接收自己的结果', async () => {
  const f = await fixture()
  const previous = f.face.loadPreview('standard')
  const previousRequest = f.take('preview')
  const updating = f.face.refresh()
  f.answer(f.take('status'), status('0.2.6'))
  await updating
  const current = f.face.loadPreview('standard')
  const currentRequest = f.take('preview')
  const otherPreset = f.face.loadPreview('ptc')
  f.answer(f.take('preview'), { available: true, text: 'ptc prompt' })
  await otherPreset
  previousRequest.reject(new Error('obsolete preview failure'))
  await previous
  assert.equal(f.view().previews.standard.status, 'loading')
  assert.equal(f.view().previews.ptc.preview.text, 'ptc prompt')
  f.answer(currentRequest, { available: true, text: 'standard prompt' })
  await current
  assert.equal(f.view().previews.standard.preview.text, 'standard prompt')
})

test('配置事件与手动刷新重叠时保留新状态，所有请求结束后才解除忙碌', async () => {
  for (const outcome of ['success', 'failure']) {
    const f = await fixture()
    const older = f.face.refresh()
    const olderRequest = f.take('status')
    f.documentUpdated()
    f.answer(f.take('status'), status('0.2.6'))
    await settle()
    assert.equal(f.view().busy, true)
    if (outcome === 'success') f.answer(olderRequest, status('0.2.5'))
    else olderRequest.reject(new Error('obsolete status failure'))
    await older
    assert.equal(f.view().status.version, '0.2.6')
    assert.equal(f.view().message, undefined)
    assert.equal(f.view().busy, false)
  }
})

test('开关提交立即使旧预览失效，配置事件刷新不能提前结束尚未完成的写入', async () => {
  const f = await fixture()
  const preview = f.face.loadPreview('standard')
  const previewRequest = f.take('preview')
  const writing = f.face.setEnabled(false)
  const writeRequest = f.take('write')
  f.commitEnabled(false)
  assert.equal(f.view().enabled, false)
  assert.equal(f.view().previews.standard, undefined)
  f.answer(previewRequest, { available: true, text: 'before toggle' })
  await preview
  assert.equal(f.view().previews.standard, undefined)
  f.answer(f.take('status'), status('0.2.6', false))
  await settle()
  assert.equal(f.view().busy, true, '配置事件的读取结束后，写入仍在等待应答')
  writeRequest.resolve(true)
  await settle()
  assert.equal(f.view().busy, true)
  f.answer(f.take('status'), status('0.2.6', false))
  await writing
  assert.equal(f.view().busy, false)
  assert.equal(f.view().status.enabled, false)
})

test('版本检查与手动更新正确推进状态并透传目标版本', async () => {
  const f = await fixture()
  assert.equal(f.view().update.state, 'idle')

  const checking = f.face.checkUpdate(true)
  assert.equal(f.view().update.state, 'checking')
  const checkReq = f.take('check-update')
  assert.deepEqual(checkReq.payload, { force: true })
  f.answer(checkReq, {
    state: 'available',
    currentVersion: '0.2.6',
    latestVersion: '0.2.7',
    latestTag: 'v0.2.7',
    installSource: 'github',
  })
  await checking
  assert.equal(f.view().update.state, 'available')
  assert.equal(f.view().update.latestVersion, '0.2.7')

  const installing = f.face.performUpdate()
  assert.equal(f.view().update.state, 'updating')
  const installReq = f.take('perform-update')
  assert.deepEqual(installReq.payload, { targetTag: 'v0.2.7' })
  f.answer(installReq, {
    state: 'updated',
    currentVersion: '0.2.6',
    latestVersion: '0.2.7',
    updatedVersion: '0.2.7',
    restartRequired: true,
    installSource: 'github',
  })
  await installing
  assert.equal(f.view().update.state, 'updated')
  assert.equal(f.view().update.restartRequired, true)
})
