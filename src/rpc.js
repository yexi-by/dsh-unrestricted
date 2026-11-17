/** Shared /api unary RPC namespace for dsh-unrestricted. */
export const RPC_NAMESPACE = 'dsh-unrestricted'

/** Endpoints exposed under `/api/dsh-unrestricted/<endpoint>`. */
export const RPC_ENDPOINTS = ['status', 'preview', 'recheck']

/**
 * Build one buffered Fetch handler speaking the Connection RPC JSON envelope.
 * @param endpoint - logical endpoint name within the plugin namespace.
 * @param handleRpc - business handler returning an RpcResult object.
 */
export function createRpcFetchHandler(endpoint, handleRpc) {
  const expectedMethod = `${RPC_NAMESPACE}/${endpoint}`
  return async (request) => {
    const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (mediaType !== 'application/json') {
      return new Response('content type must be application/json', { status: 415 })
    }
    let body
    try {
      body = await request.json()
    } catch {
      return new Response('body is not JSON', { status: 400 })
    }
    const rpcId = typeof body?.rpcId === 'string' ? body.rpcId : 'invalid-request'
    if (body?.type !== 'client-request' || typeof body?.rpcId !== 'string' || body.method !== expectedMethod) {
      return Response.json({
        type: 'server-response',
        rpcId,
        result: {
          ok: false,
          error: {
            code: 'gateway/bad-request',
            message: `invalid client-request for ${JSON.stringify(expectedMethod)}`,
            details: {},
          },
        },
      })
    }
    try {
      const result = await handleRpc(endpoint, body.payload)
      return Response.json({ type: 'server-response', rpcId, result })
    } catch (error) {
      return new Response(`handler failure: ${error instanceof Error ? error.message : String(error)}`, { status: 500 })
    }
  }
}

/**
 * Register all plugin endpoints as exact Fetch routes under `/api`, avoiding
 * `connection.rpc.handle()` which requires `webServer` in Connection's own scope.
 * @param connection - HostConnectionHandle from `ctx.connection`.
 * @param handleRpc - business handler returning an RpcResult object.
 * @returns asynchronous disposer removing every registered route.
 */
export function registerRpcRoutes(connection, handleRpc) {
  const disposers = RPC_ENDPOINTS.map(endpoint =>
    connection.fetch.register({
      path: `/api/${RPC_NAMESPACE}/${endpoint}`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: createRpcFetchHandler(endpoint, handleRpc),
    }),
  )
  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
