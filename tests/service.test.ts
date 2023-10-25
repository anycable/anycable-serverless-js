import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import {
  Application,
  Channel,
  ConnectionHandle,
  ChannelHandle,
  connectHandler,
  commandHandler,
  disconnectHandler,
  Status
} from '../src/index'

const HandlersTest = suite('Handlers')
function createMockRequest(
  url: string,
  options?: Partial<{ body: any; sid: string }>
): Request {
  const { body, sid } = options || {}
  const payload = body || {}

  payload['env'] = payload['env'] || {}
  payload['env']['url'] = payload['env']['url'] || url

  const bodyBuffer = Buffer.from(JSON.stringify(payload))

  const headers = new Map()
  if (sid) {
    headers.set('x-anycable-meta-sid', sid)
  }

  return new Request('http://cable.test/api', {
    method: 'POST',
    body: bodyBuffer,
    headers: headers as any
  })
}

type TestIdentifiers = {
  userId: string
}

class TestApplication extends Application<TestIdentifiers> {
  async connect(handle: ConnectionHandle<TestIdentifiers>) {
    const url = handle.env.url
    const params = new URL(url).searchParams

    if (params.has('user_id')) {
      handle.identifiedBy({ userId: params.get('user_id')! })
    } else {
      handle.reject()
    }
  }
}

class TestChannel extends Channel<TestIdentifiers, { roomId: string }> {
  async subscribed(
    handle: ChannelHandle<TestIdentifiers>,
    params: { roomId: string } | null
  ) {
    if (!params) {
      handle.reject()
      return
    }

    if (!params.roomId) {
      handle.reject()
      return
    }

    handle.streamFrom('room:' + params.roomId)
    handle.streamFrom(
      'room:' + params.roomId + ':user:' + handle.identifiers?.userId
    )
  }
}

HandlersTest('connect + welcomed', async () => {
  const app = new TestApplication()
  const request = createMockRequest('http://localhost?user_id=13', {
    sid: 's42'
  })
  const response = await connectHandler(request, app)

  assert.is(response.status, Status.SUCCESS)
  assert.is(response.error_msg, '')
  assert.is(response.identifiers, '{"userId":"13"}')
  assert.equal(response.transmissions, [
    JSON.stringify({ type: 'welcome', sid: 's42' })
  ])
})

HandlersTest('connect + rejected', async () => {
  const app = new TestApplication()
  const request = createMockRequest('http://localhost', {
    sid: 's42'
  })
  const response = await connectHandler(request, app)

  assert.is(response.status, Status.FAILURE)
  assert.is(response.error_msg, 'Auth failed')
  assert.is(response.identifiers, '')
  assert.equal(response.transmissions, [
    JSON.stringify({ type: 'disconnect', reason: 'unauthorized' })
  ])
})

HandlersTest('command + subscribed + confirmed', async () => {
  const app = new TestApplication()
  app.registerChannel('TestChannel', new TestChannel())

  const identifier = `{"channel":"TestChannel","roomId":"42"}`

  const request = createMockRequest('http://localhost', {
    body: {
      connection_identifiers: '{"userId":"13"}',
      command: 'subscribe',
      identifier
    }
  })

  const response = await commandHandler(request, app)

  assert.is(response.status, Status.SUCCESS)
  assert.is(response.disconnect, false)
  assert.is(response.error_msg, '')
  assert.is(response.stop_streams, false)
  assert.is(response.transmissions?.length, 1)

  const transmission = JSON.parse(response.transmissions![0])
  assert.is(transmission.identifier, identifier)
  assert.is(transmission.type, 'confirm_subscription')

  assert.equal(response.streams, ['room:42', 'room:42:user:13'])
})

HandlersTest('disconnect', async () => {
  const app = new TestApplication()
  const channel = new TestChannel()

  let disconnectedId: string = ''
  let unsubscribedId: string = ''

  app.disconnect = async (handle: ConnectionHandle<TestIdentifiers>) => {
    disconnectedId = handle.identifiers!.userId
  }

  channel.unsubscribed = async (
    handle: ChannelHandle<TestIdentifiers>,
    params: {} | null
  ) => {
    unsubscribedId =
      (handle.identifiers?.userId || '') + '-' + (params || {})['roomId']
  }

  app.registerChannel('TestChannel', channel)

  const identifier = `{"channel":"TestChannel","roomId":"42"}`

  const request = createMockRequest('http://localhost', {
    body: {
      identifiers: '{"userId":"13"}',
      subscriptions: [identifier]
    }
  })

  const response = await disconnectHandler(request, app)

  assert.is(response.status, Status.SUCCESS)
  assert.is(disconnectedId, '13')
  assert.is(unsubscribedId, '13-42')
})

HandlersTest.run()
