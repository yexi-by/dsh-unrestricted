import assert from 'node:assert/strict'
import test from 'node:test'
import { RPC_ENDPOINTS, RPC_NAMESPACE, registerRpcRoutes } from '../src/rpc.js'

function mockConnection() {
  const routes = new Map()
  return {
    routes,
    rpc: {
      handle() {
        throw new Error('cannot get property "webServer" without inject')
      },
    },
    fetch: {
      register(route) {
        routes.set(route.path, route)
        return async () => {
          routes.delete(route.path)
        }
      },
    },
  }
}

test('经由 connection.fetch.register 注册共享 /api 路由，不触碰 rpc.handle 且支持正常调度与销毁', async () => {
  const connection = mockConnection()
  const calls = []
  const dispose = registerRpcRoutes(connection, async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'boom') throw new Error('unexpected crash')
    return { ok: true, value: { endpoint, echo: payload ?? null } }
  })

  assert.deepEqual(
    [...connection.routes.keys()],
    RPC_ENDPOINTS.map(endpoint => `/api/${RPC_NAMESPACE}/${endpoint}`),
  )

  for (const endpoint of RPC_ENDPOINTS) {
    const route = connection.routes.get(`/api/${RPC_NAMESPACE}/${endpoint}`)
    assert.deepEqual(route.methods, ['POST'])
    assert.equal(route.requestBody, 'buffered')

    const response = await route.fetch(new Request(`http://dsh.internal${route.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: `rpc-${endpoint}`,
        method: `${RPC_NAMESPACE}/${endpoint}`,
        payload: { presetId: 'standard' },
      }),
    }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      type: 'server-response',
      rpcId: `rpc-${endpoint}`,
      result: { ok: true, value: { endpoint, echo: { presetId: 'standard' } } },
    })
  }

  assert.equal(calls.length, 3)

  const statusRoute = connection.routes.get('/api/dsh-unrestricted/status')

  const badType = await statusRoute.fetch(new Request('http://dsh.internal/api/dsh-unrestricted/status', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  }))
  assert.equal(badType.status, 415)

  const badJson = await statusRoute.fetch(new Request('http://dsh.internal/api/dsh-unrestricted/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not-json',
  }))
  assert.equal(badJson.status, 400)

  const wrongMethod = await statusRoute.fetch(new Request('http://dsh.internal/api/dsh-unrestricted/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'rpc-mismatch',
      method: 'dsh-unrestricted/recheck',
      payload: {},
    }),
  }))
  assert.equal(wrongMethod.status, 200)
  assert.deepEqual(await wrongMethod.json(), {
    type: 'server-response',
    rpcId: 'rpc-mismatch',
    result: {
      ok: false,
      error: {
        code: 'gateway/bad-request',
        message: 'invalid client-request for "dsh-unrestricted/status"',
        details: {},
      },
    },
  })

  await dispose()
  assert.equal(connection.routes.size, 0)
})

test('handler 抛出异常时返回 500 而不崩溃', async () => {
  const connection = mockConnection()
  const dispose = registerRpcRoutes(connection, async () => {
    throw new Error('handler exploded')
  })
  const route = connection.routes.get('/api/dsh-unrestricted/status')
  const response = await route.fetch(new Request('http://dsh.internal/api/dsh-unrestricted/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'rpc-err',
      method: 'dsh-unrestricted/status',
      payload: {},
    }),
  }))
  assert.equal(response.status, 500)
  assert.equal(await response.text(), 'handler failure: handler exploded')
  await dispose()
})
