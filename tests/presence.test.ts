import {
  Application,
  ConnectionHandle,
  Channel,
  ChannelHandle
} from '../src/index'
import { suite } from 'uvu'
import * as assert from 'uvu/assert'

const PresenceTest = suite('Presence and whispering')

type TestIdentifiers = {
  userId: string
}

type RoomChannelParams = {
  roomId: string
}

type RoomChannelState = {
  count: number
}

class RoomChannel extends Channel<
  TestIdentifiers,
  RoomChannelParams,
  any,
  RoomChannelState
> {
  async subscribed(
    handle: ChannelHandle<TestIdentifiers, RoomChannelState>,
    params: RoomChannelParams | null
  ) {
    if (!params?.roomId) {
      handle.reject()
      return
    }

    handle.streamFrom(`room:${params.roomId}`, { whisper: true })
    handle.joinPresence(handle.identifiers!.userId, {
      name: `User ${handle.identifiers!.userId}`
    })
  }

  async leave(
    handle: ChannelHandle<TestIdentifiers, RoomChannelState>,
    _params: RoomChannelParams
  ) {
    handle.leavePresence(handle.identifiers!.userId)
  }

  async mute(
    handle: ChannelHandle<TestIdentifiers, RoomChannelState>,
    params: RoomChannelParams
  ) {
    handle.stopStreamFrom(`room:${params.roomId}`)
  }

  async muteAll(
    handle: ChannelHandle<TestIdentifiers, RoomChannelState>,
    _params: RoomChannelParams
  ) {
    handle.stopAllStreams()
  }

  async increment(
    handle: ChannelHandle<TestIdentifiers, RoomChannelState>,
    _params: RoomChannelParams
  ) {
    handle.state.count = (handle.state.count || 0) + 1
  }
}

const buildApp = () => {
  const app = new Application<TestIdentifiers>()
  app.registerChannel('room', new RoomChannel())
  return app
}

const identifier = `{"channel":"room","roomId":"13"}`

PresenceTest('subscribe with whisper and presence', async () => {
  const app = buildApp()
  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost'
  })
  handle.identifiedBy({ userId: '42' })

  await app.handleCommand(handle, 'subscribe', identifier, null)

  assert.is(handle.rejected, false)
  assert.equal(handle.streams, ['room:13'])
  assert.equal(handle.envChanges.istate, {
    $w: 'room:13',
    $p: 'room:13'
  })
  assert.equal(handle.presence, {
    type: 'join',
    id: '42',
    info: JSON.stringify({ name: 'User 42' })
  })
})

PresenceTest('joinPresence requires a stream', async () => {
  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost'
  })
  const channelHandle = handle.buildChannelHandle(identifier)

  try {
    channelHandle.joinPresence('42')
    assert.unreachable('Should throw if no stream to track presence on')
  } catch (e) {
    assert.is(e.message, 'Provide a stream name for presence updates')
  }
})

PresenceTest('leavePresence', async () => {
  const app = buildApp()
  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost',
    istate: { $w: 'room:13', $p: 'room:13' }
  })
  handle.identifiedBy({ userId: '42' })

  await app.handleCommand(
    handle,
    'message',
    identifier,
    JSON.stringify({ action: 'leave' })
  )

  assert.equal(handle.presence, { type: 'leave', id: '42' })
  // Leaving must not touch the presence stream state
  assert.equal(handle.envChanges.istate, {})
})

PresenceTest('stopStreamFrom disables whispering', async () => {
  const app = buildApp()
  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost',
    istate: { $w: 'room:13' }
  })
  handle.identifiedBy({ userId: '42' })

  await app.handleCommand(
    handle,
    'message',
    identifier,
    JSON.stringify({ action: 'mute' })
  )

  assert.equal(handle.stoppedStreams, ['room:13'])
  assert.equal(handle.envChanges.istate, { $w: '' })
})

PresenceTest('stopAllStreams disables whispering', async () => {
  const app = buildApp()
  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost',
    istate: { $w: 'room:13' }
  })
  handle.identifiedBy({ userId: '42' })

  await app.handleCommand(
    handle,
    'message',
    identifier,
    JSON.stringify({ action: 'muteAll' })
  )

  assert.is(handle.stopStreams, true)
  assert.equal(handle.envChanges.istate, { $w: '' })
})

PresenceTest('channel state is restored from command requests', async () => {
  const app = buildApp()
  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost',
    istate: { count: '1', $p: 'room:13' }
  })
  handle.identifiedBy({ userId: '42' })

  await app.handleCommand(
    handle,
    'message',
    identifier,
    JSON.stringify({ action: 'increment' })
  )

  assert.equal(handle.envChanges.istate, { count: '2' })
})

PresenceTest('channel state is restored from disconnect requests', async () => {
  const app = buildApp()

  let observedCount: number | undefined
  let observedWhisperStream: string | null = null

  const channel = new RoomChannel()
  channel.unsubscribed = async (
    handle: ChannelHandle<TestIdentifiers, RoomChannelState>
  ) => {
    observedCount = handle.state.count
    observedWhisperStream = handle.whisperStream
  }
  app.registerChannel('room', channel)

  const handle = new ConnectionHandle<TestIdentifiers>('123', {
    url: 'http://localhost',
    istate: {
      [identifier]: JSON.stringify({ count: '2', $w: 'room:13' })
    }
  })
  handle.identifiedBy({ userId: '42' })

  await app.handleClose(handle, [identifier])

  assert.is(observedCount, 2)
  assert.is(observedWhisperStream, 'room:13')
})

PresenceTest.run()
