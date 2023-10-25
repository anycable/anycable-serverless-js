import { broadcaster } from '../src/index'
import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import fetch from 'node-fetch'

// Mock global fetch
;(global as any).fetch = fetch

const BroadcastTest = suite('Broadcaster')

BroadcastTest.before.each(context => {
  context.originalFetch = global.fetch
})

BroadcastTest.after.each(context => {
  global.fetch = context.originalFetch
})

BroadcastTest('broadcasts with secret', async () => {
  const mockUrl = 'http://mock-url.com'
  const mockSecret = 'secret-token'
  const mockStream = 'stream'
  const mockData = { key: 'value' }

  let requestBody: any = null

  global.fetch = async (
    url: RequestInfo | URL,
    options: any
  ): Promise<Response> => {
    assert.is(url, mockUrl)
    assert.is(options.headers['Authorization'], `Bearer ${mockSecret}`)
    requestBody = JSON.parse(options.body)
    return new Response(null, { status: 200 })
  }

  const broadcast = broadcaster(mockUrl, mockSecret)
  await broadcast(mockStream, mockData)

  assert.is(requestBody.stream, mockStream)
  assert.is(requestBody.data, JSON.stringify(mockData))
})

BroadcastTest('broadcasts without secret', async () => {
  const mockUrl = 'http://mock-url.com'
  const mockStream = 'stream'
  const mockData = { key: 'value' }

  global.fetch = async (
    url: RequestInfo | URL,
    options: any
  ): Promise<Response> => {
    assert.is(options.headers['Authorization'], undefined)
    return new Response(null, { status: 200 })
  }

  const broadcast = broadcaster(mockUrl, undefined)
  await broadcast(mockStream, mockData)
})

BroadcastTest('handles non-OK response', async () => {
  const mockUrl = 'http://mock-url.com'
  const mockStream = 'error-stream'
  const mockData = { key: 'error' }

  global.fetch = async (
    url: RequestInfo | URL,
    options: any
  ): Promise<Response> => {
    return new Response('Not Found', { status: 404, statusText: 'Not Found' })
  }

  const broadcast = broadcaster(mockUrl, undefined)

  try {
    await broadcast(mockStream, mockData)
  } catch (error) {
    assert.is(error.message, `Error broadcasting to ${mockStream}: Not Found`)
  }
})

BroadcastTest.run()
