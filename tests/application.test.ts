import {
  Application,
  ConnectionHandle,
  Channel,
  ChannelHandle
} from '../src/index'
import { suite } from 'uvu'
import * as assert from 'uvu/assert'

const ApplicationTest = suite('Application')

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

  async disconnect(handle: ConnectionHandle<TestIdentifiers>) {}
}

ApplicationTest('handleOpen when authenticated', async () => {
  const app = new TestApplication()

  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost?user_id=1'
  })

  await app.handleOpen(handle)

  assert.is(handle.rejected, false)
  assert.is(handle.identifiers?.userId, '1')
  assert.equal(handle.transmissions, [
    JSON.stringify({ type: 'welcome', sid: '123' })
  ])
})

ApplicationTest('handleOpen when unauthorized', async () => {
  const app = new TestApplication()

  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost'
  })

  await app.handleOpen(handle)

  assert.is(handle.rejected, true)
  assert.equal(handle.transmissions, [
    JSON.stringify({ type: 'disconnect', reason: 'unauthorized' })
  ])
})

ApplicationTest('handleClose', async () => {
  const app = new TestApplication()

  let disconnectedId: string = ''

  app.disconnect = async (handle: ConnectionHandle<TestIdentifiers>) => {
    disconnectedId = handle.identifiers!.userId
  }

  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost'
  })
  handle.identifiedBy({ userId: '1' })

  await app.handleClose(handle, [])

  assert.is(disconnectedId, '1')
  assert.equal(handle.transmissions, [])
})

type TestChannelParams = {
  roomId: string
}

type TestMessage = {
  id: string
  username: string
  body: string
}

class ChatChannel extends Channel<
  TestIdentifiers,
  TestChannelParams,
  TestMessage
> {
  async subscribed(
    handle: ChannelHandle<TestIdentifiers>,
    params: TestChannelParams | null
  ) {
    if (!params) {
      handle.reject()
      return
    }

    if (!params.roomId) {
      handle.reject()
      return
    }

    handle.streamFrom(`room:${params.roomId}`)
  }

  async sendMessage(
    handle: ChannelHandle<TestIdentifiers>,
    params: TestChannelParams,
    data: TestMessage
  ) {
    const { body } = data

    if (!body) {
      throw new Error('Body is required')
    }

    console.log(`User ${handle.identifiers!.userId} sent message: ${data.body}`)

    const message: TestMessage = {
      id: Math.random().toString(36).substr(2, 9),
      username: `User ${handle.identifiers!.userId}`,
      body
    }

    handle.transmit(message)
  }
}

ApplicationTest('handleCommand with unknown channel', async () => {
  const app = new TestApplication()
  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost'
  })

  try {
    await app.handleCommand(handle, 'subscribe', `{"channel":"chat"}`, null)
    assert.unreachable('Should throw if channel is not registered')
  } catch (e) {
    assert.is(e.message, 'Channel chat is not registered')
  }
})

ApplicationTest('handleCommand + subscribe + confirmed', async () => {
  const app = new TestApplication()
  app.registerChannel('chat', new ChatChannel())
  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost'
  })
  handle.identifiedBy({ userId: '42' })

  const identifier = `{"channel":"chat","roomId":2023}`

  await app.handleCommand(handle, 'subscribe', identifier, null)

  assert.is(handle.rejected, false)
  assert.equal(handle.transmissions, [
    JSON.stringify({
      identifier,
      type: 'confirm_subscription'
    })
  ])
  assert.is(handle.streams.length, 1)
  assert.is(handle.streams[0], 'room:2023')
})

ApplicationTest('handleCommand + subscribe + rejected', async () => {
  const app = new TestApplication()
  app.registerChannel('chat', new ChatChannel())
  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost'
  })
  handle.identifiedBy({ userId: '42' })

  const identifier = `{"channel":"chat","room_id":2023}`

  await app.handleCommand(handle, 'subscribe', identifier, null)

  assert.is(handle.rejected, true)
  assert.equal(handle.transmissions, [
    JSON.stringify({
      identifier,
      type: 'reject_subscription'
    })
  ])
  assert.is(handle.streams.length, 0)
})

ApplicationTest('handleCommand + perform', async () => {
  const app = new TestApplication()
  app.registerChannel('chat', new ChatChannel())
  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost'
  })
  handle.identifiedBy({ userId: '42' })

  const identifier = `{"channel":"chat","room_id":2023}`

  await app.handleCommand(
    handle,
    'message',
    identifier,
    JSON.stringify({
      action: 'sendMessage',
      body: '2023 - Linea'
    })
  )

  assert.is(handle.streams.length, 0)
  assert.is(handle.rejected, false)
  assert.is(handle.transmissions.length, 1)

  const transmission = JSON.parse(handle.transmissions[0])
  assert.is(transmission['identifier'], identifier)
  const message = transmission['message'] as TestMessage

  assert.is(message.username, 'User 42')
  assert.is(message.body, '2023 - Linea')
})

ApplicationTest('handleCommand + perform + unknown action', async () => {
  const app = new TestApplication()
  app.registerChannel('chat', new ChatChannel())
  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost'
  })
  handle.identifiedBy({ userId: '42' })

  const identifier = `{"channel":"chat","room_id":2023}`

  try {
    await app.handleCommand(
      handle,
      'message',
      identifier,
      JSON.stringify({
        action: 'send_message',
        body: '2023 - Linea'
      })
    )
    assert.unreachable('Should throw if action is not defined')
  } catch (e) {
    assert.is(e.message, 'Unknown action: send_message')
  }
})

ApplicationTest.run()
