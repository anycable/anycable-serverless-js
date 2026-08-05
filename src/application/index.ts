import { Channel, ChannelHandle, ChannelState } from '../channel/index.js'
import { Env, EnvResponse, PresenceResponse } from '../rpc/index.js'

export type IdentifiersMap = { [id: string]: unknown }

// State values are JSON-encoded by this SDK; fall back to the raw string
// for values written by other tools
const parseStateValue = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export class ConnectionHandle<IdentifiersType extends IdentifiersMap = {}> {
  readonly id: string | null

  rejected: boolean = false
  closed: boolean = false
  transmissions: string[]
  streams: string[] = []
  stoppedStreams: string[] = []
  stopStreams: boolean = false
  env: Env
  identifiers: IdentifiersType | null = null
  presence: PresenceResponse | null = null

  constructor(id: string | null, env: Env) {
    this.id = id
    this.env = env
    this.transmissions = []
  }

  reject() {
    this.rejected = true
    return this
  }

  transmit(data: unknown) {
    if (typeof data !== 'string') {
      data = JSON.stringify(data)
    }

    this.transmissions.push(data as string)
    return this
  }

  streamFrom(name: string) {
    this.streams.push(name)
    return this
  }

  stopStreamFrom(name: string) {
    this.stoppedStreams.push(name)
    return this
  }

  stopAllStreams() {
    this.stopStreams = true
    return this
  }

  close() {
    this.closed = true
    return this
  }

  identifiedBy(identifiers: IdentifiersType) {
    this.identifiers = identifiers
    return this
  }

  // Channel state arrives in two shapes: for commands, `env.istate` is
  // the current channel's state map; for disconnect, it's keyed by identifier
  // with JSON-encoded state maps as values
  buildChannelHandle(
    identifier: string,
    nested: boolean = false
  ): ChannelHandle<IdentifiersType> {
    let rawState: Record<string, string> | null = null

    if (this.env.istate) {
      if (nested) {
        const encoded = this.env.istate[identifier]
        try {
          rawState = encoded ? JSON.parse(encoded) : null
        } catch {
          rawState = null
        }
      } else {
        rawState = this.env.istate
      }
    }

    const state = {} as ChannelState
    const internalState = {} as Record<string, string>

    if (rawState) {
      for (const k in rawState) {
        // Keys starting with `$` are reserved by the server and hold raw values
        if (k.startsWith('$')) {
          internalState[k] = rawState[k]
        } else {
          state[k] = parseStateValue(rawState[k])
        }
      }
    }

    return new ChannelHandle(this, identifier, state, internalState)
  }

  mergeChannelHandle(handle: ChannelHandle<IdentifiersType>) {
    if (handle.rejected) {
      this.reject()
    }

    for (const transmission of handle.transmissions) {
      this.transmit({ identifier: handle.identifier, message: transmission })
    }

    const serializedState = {} as any
    if (handle.state) {
      for (const k in handle.state) {
        const v = (handle.state as any)[k] as any
        serializedState[k] = JSON.stringify(v)
      }
    }
    Object.assign(serializedState, handle.internalStateChanges)

    // An empty istate would still mark the session state as dirty
    // on the server; omit it instead
    if (Object.keys(serializedState).length > 0) {
      this.env.istate = serializedState
    } else {
      delete this.env.istate
    }

    // The server processes presence replies even for rejected subscriptions;
    // never report presence for them
    if (handle.presence && !handle.rejected) {
      const { type, id } = handle.presence
      this.presence = { type, id }

      if (
        handle.presence.type === 'join' &&
        handle.presence.info !== undefined
      ) {
        this.presence.info = JSON.stringify(handle.presence.info)
      }
    }

    this.streams = this.streams.concat(handle.streams)
    this.stoppedStreams = this.stoppedStreams.concat(handle.stoppedStreams)
    this.stopStreams = this.stopStreams || handle.stopStreams

    return this
  }

  get envChanges(): EnvResponse {
    return {
      cstate: this.env.cstate,
      istate: this.env.istate
    }
  }
}

export class Application<IdentifiersType extends IdentifiersMap = {}> {
  private channels: Record<string, Channel<IdentifiersType>> = {}

  constructor() {
    this.channels = {}
  }

  registerChannel(channelName: string, channelClass: Channel<IdentifiersType>) {
    this.channels[channelName] = channelClass
  }

  buildHandle(id: string | null, env: Env): ConnectionHandle<IdentifiersType> {
    return new ConnectionHandle(id, env)
  }

  async handleOpen(handle: ConnectionHandle<IdentifiersType>) {
    try {
      await this.connect(handle)

      if (handle.rejected) {
        handle.transmit({ type: 'disconnect', reason: 'unauthorized' })
      } else {
        handle.transmit({ type: 'welcome', sid: handle.id })
      }
    } catch (e) {
      if ((e as any)?.code == 'ERR_JWT_EXPIRED') {
        handle.reject().transmit({
          type: 'disconnect',
          reason: 'token_expired',
          reconnect: false
        })
      } else {
        throw e
      }
    }
  }

  async connect(_handle: ConnectionHandle<IdentifiersType>) {
    // Override this method in your application class to perform authentication
    // and set up connection identifiers
  }

  async handleCommand(
    handle: ConnectionHandle<IdentifiersType>,
    command: string,
    identifier: string,
    data: string | null
  ) {
    const { channel, params } = this.findChannel(identifier)

    const channelHandle = handle.buildChannelHandle(identifier)

    if (command === 'subscribe') {
      await channel.subscribed(channelHandle, params)
      if (channelHandle.rejected) {
        handle.transmit({ identifier, type: 'reject_subscription' })
      } else {
        handle.transmit({ identifier, type: 'confirm_subscription' })
      }
    } else if (command === 'unsubscribe') {
      await channel.unsubscribed(channelHandle, params)
    } else if (command === 'message') {
      const { action, ...payload } = JSON.parse(data!)
      await channel.handleAction(channelHandle, params, action, payload)
    } else {
      throw new Error(`Unknown command: ${command}`)
    }

    handle.mergeChannelHandle(channelHandle)
  }

  async handleClose(
    handle: ConnectionHandle<IdentifiersType>,
    subscriptions: string[] | null
  ) {
    if (subscriptions) {
      for (const identifier of subscriptions) {
        const { channel, params } = this.findChannel(identifier)

        const channelHandle = handle.buildChannelHandle(identifier, true)

        await channel.unsubscribed(channelHandle, params)
      }
    }

    await this.disconnect(handle)
  }

  async disconnect(_handle: ConnectionHandle<IdentifiersType>) {
    // Override this method in your application class to perform cleanup on disconnect
  }

  encodeIdentifiers(identifiers: IdentifiersType): string {
    return JSON.stringify(identifiers)
  }

  decodeIdentifiers(identifiers: string): IdentifiersType {
    return JSON.parse(identifiers)
  }

  // Identifier is a JSON string with the channel name and params
  findChannel(identifier: string): {
    channel: Channel<IdentifiersType>
    params: any
  } {
    const { channel, ...params } = JSON.parse(identifier)

    const channelInstance = this.channels[channel]

    if (!channelInstance) {
      throw new Error(`Channel ${channel} is not registered`)
    }

    return { channel: channelInstance, params }
  }
}
