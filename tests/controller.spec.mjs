import assert from 'node:assert/strict'
import test from 'node:test'
import { createUnrestrictedController } from '../src/client/controller.ts'

const settle = () => new Promise(setImmediate)
const DEFAULT_PROMPT = '## Default execution contract'
const status = (version, enabled = true, extra = {}) => ({
  enabled,
  defaultPrompt: DEFAULT_PROMPT,
  version,
  modes: {},
  ...extra,
})

/** 保留真实控制器，仅控制设置提交、配置事件和 RPC 的完成时序。 */
async function fixture({ supportsUnset = true } = {}) {
  let value = { enabled: true }
  const subscribers = new Set()
  const events = new Map()
  const pending = {
    status: [],
    recheck: [],
    preview: [],
    write: [],
    unset: [],
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
    ...(supportsUnset ? { unset: field => defer('unset', { field }) } : {}),
  }
  const ctx = {
    get: () => ({
      rpc: {
        call: (channel, method, payload) => {
          assert.equal(channel, '/api')
          assert.match(method, /^dsh-unrestricted\//)
          return defer(method.slice('dsh-unrestricted/'.length), payload)
        },
      },
    }),
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
      value = { ...value, enabled }
      for (const listener of subscribers) listener()
      events.get('settings/document-updated')('unrestricted')
    },
    commitSettings(patch) {
      value = { ...value, ...patch }
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

test('切换隐藏宿主品牌标识立即使旧预览失效并在提交后同步状态', async () => {
  const f = await fixture()
  const preview = f.face.loadPreview('standard')
  f.answer(f.take('preview'), { available: true, text: 'with brand' })
  await preview
  assert.equal(f.view().previews.standard.preview.text, 'with brand')
  assert.equal(f.view().stripHostIdentity, false)

  const writing = f.face.setStripHostIdentity(true)
  const writeRequest = f.take('write')
  assert.deepEqual(writeRequest.payload, { field: 'stripHostIdentity', next: true })
  f.commitSettings({ stripHostIdentity: true })
  assert.equal(f.view().stripHostIdentity, true)
  assert.equal(f.view().previews.standard, undefined)

  f.answer(f.take('status'), { ...status('0.2.12', true), stripHostIdentity: true })
  writeRequest.resolve(true)
  await settle()
  f.answer(f.take('status'), { ...status('0.2.12', true), stripHostIdentity: true })
  await writing
  assert.equal(f.view().busy, false)
  assert.equal(f.view().status.stripHostIdentity, true)
})

test('保存与重置自定义提示词：规范换行、清理预览并在恢复默认时卸载字段', async () => {
  const f = await fixture()
  assert.equal(f.view().defaultPrompt, DEFAULT_PROMPT)
  assert.equal(f.view().customPrompt, '')
  assert.equal(f.view().isCustomPrompt, false)

  const preview = f.face.loadPreview('standard')
  f.answer(f.take('preview'), { available: true, text: 'default preview' })
  await preview
  assert.equal(f.view().previews.standard.preview.text, 'default preview')

  const saving = f.face.setCustomPrompt('## Custom\r\nLine 2')
  const writeRequest = f.take('write')
  assert.deepEqual(writeRequest.payload, { field: 'customPrompt', next: '## Custom\nLine 2' })
  f.commitSettings({ customPrompt: '## Custom\nLine 2' })
  assert.equal(f.view().customPrompt, '## Custom\nLine 2')
  assert.equal(f.view().isCustomPrompt, true)
  assert.equal(f.view().previews.standard, undefined)

  f.answer(f.take('status'), status('0.2.17', true, { customPrompt: '## Custom\nLine 2', isCustomPrompt: true }))
  writeRequest.resolve(true)
  await settle()
  f.answer(f.take('status'), status('0.2.17', true, { customPrompt: '## Custom\nLine 2', isCustomPrompt: true }))
  assert.equal(await saving, true)
  assert.equal(f.view().busy, false)

  // 保存与内置默认一致的内容时直接 unset，恢复默认状态。
  const matchingDefault = f.face.setCustomPrompt(`${DEFAULT_PROMPT}\r`.replace('\r', ''))
  const unsetRequest = f.take('unset')
  assert.deepEqual(unsetRequest.payload, { field: 'customPrompt' })
  f.commitSettings({ customPrompt: '' })
  assert.equal(f.view().isCustomPrompt, false)
  f.answer(f.take('status'), status('0.2.17', true, { customPrompt: '', isCustomPrompt: false }))
  unsetRequest.resolve(true)
  await settle()
  f.answer(f.take('status'), status('0.2.17', true, { customPrompt: '', isCustomPrompt: false }))
  assert.equal(await matchingDefault, true)
})

test('缺少 settings.unset 时重置自定义提示词回退为空串，写入拒绝或异常返回 false', async () => {
  const f = await fixture({ supportsUnset: false })
  const resetting = f.face.resetCustomPrompt()
  const writeRequest = f.take('write')
  assert.deepEqual(writeRequest.payload, { field: 'customPrompt', next: '' })
  writeRequest.resolve(false)
  await settle()
  f.answer(f.take('status'), status('0.2.17', true))
  assert.equal(await resetting, false)

  const failing = f.face.setCustomPrompt('## Fail case')
  f.take('write').reject(new Error('disk full'))
  assert.equal(await failing, false)
  assert.equal(f.view().message, 'disk full')
})
