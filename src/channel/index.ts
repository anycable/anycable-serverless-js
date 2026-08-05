import { Env } from '../rpc/index.js'

interface ConnectionDelegate<I = {}> {
  get env(): Env
  get identifiers(): I | null
}

export type ChannelState = { [key: string]: any }

// Reserved channel state keys used by the AnyCable server
export const WHISPER_STREAM_STATE = '$w'
export const PRESENCE_STREAM_STATE = '$p'

export type PresenceEvent =
  | { type: 'join'; id: string; info?: any }
  | { type: 'leave'; id: string }

export class ChannelHandle<I, S extends ChannelState = {}, T = any> {
  readonly identifier: string
  private delegate: ConnectionDelegate<I>
  state: Partial<S> = {}

  rejected: boolean = false
  transmissions: T[] = []
  streams: string[] = []
  stoppedStreams: string[] = []
  stopStreams: boolean = false

  whisperStream: string | null = null
  presenceStream: string | null = null
  presence: PresenceEvent | null = null

  private whisperChanged: boolean = false

  constructor(
    delegate: ConnectionDelegate<I>,
    identifier: string,
    state: Partial<S>,
    internalState: Record<string, string> | null = null
  ) {
    this.delegate = delegate
    this.identifier = identifier
    this.state = state

    if (internalState) {
      this.whisperStream = internalState[WHISPER_STREAM_STATE] || null
      this.presenceStream = internalState[PRESENCE_STREAM_STATE] || null
    }
  }

  reject() {
    this.rejected = true
    return this
  }

  streamFrom(name: string, opts: { whisper?: boolean } = {}) {
    this.streams.push(name)

    if (opts.whisper) {
      this.whispersTo(name)
    }

    return this
  }

  whispersTo(name: string) {
    this.whisperStream = name
    this.whisperChanged = true
    return this
  }

  joinPresence(id: string | number, info?: any, stream?: string) {
    stream ||= this.streams[0] || this.presenceStream || undefined

    if (!stream) {
      throw new Error('Provide a stream name for presence updates')
    }

    if (!this.streams.includes(stream)) {
      this.streams.push(stream)
    }

    this.presenceStream = stream
    this.presence = { type: 'join', id: String(id) }

    if (info !== undefined) {
      this.presence.info = info
    }

    return this
  }

  leavePresence(id: string | number) {
    this.presence = { type: 'leave', id: String(id) }
    return this
  }

  stopStreamFrom(name: string) {
    this.stoppedStreams.push(name)

    if (this.whisperStream === name) {
      this.whisperStream = null
      this.whisperChanged = true
    }

    return this
  }

  stopAllStreams() {
    this.stopStreams = true

    if (this.whisperStream) {
      this.whisperStream = null
      this.whisperChanged = true
    }

    return this
  }

  transmit(data: T) {
    this.transmissions.push(data)
    return this
  }

  // Reserved state keys to include into the response istate
  // (raw values, the server reads them without deserialization)
  get internalStateChanges(): Record<string, string> {
    const changes: Record<string, string> = {}

    if (this.whisperChanged) {
      changes[WHISPER_STREAM_STATE] = this.whisperStream || ''
    }

    if (this.presence?.type === 'join' && this.presenceStream) {
      changes[PRESENCE_STREAM_STATE] = this.presenceStream
    }

    return changes
  }

  get env(): Env {
    return this.delegate.env
  }

  get identifiers(): I | null {
    return this.delegate.identifiers
  }
}

export type ChannelParamsMap = { [token: string]: boolean | number | string }

export type ServerAction<
  ClientActions extends (...args: any[]) => void,
  I,
  S extends ChannelState = {},
  T = any,
  P extends ChannelParamsMap = {}
> = (
  handle: ChannelHandle<I, S, T>,
  params: P,
  ...args: Parameters<ClientActions>
) => ReturnType<ClientActions>

export class Channel<
  IdentifiersType,
  ParamsType extends ChannelParamsMap = {},
  TransmissionsType = any,
  StateType extends ChannelState = {}
> {
  async subscribed(
    _handle: ChannelHandle<IdentifiersType, StateType, TransmissionsType>,
    _params: ParamsType | null
  ): Promise<void> {}

  async unsubscribed(
    _handle: ChannelHandle<IdentifiersType, StateType, TransmissionsType>,
    _params: ParamsType | null
  ): Promise<void> {
    return
  }

  async handleAction(
    handle: ChannelHandle<IdentifiersType, StateType, TransmissionsType>,
    params: ParamsType | null,
    action: string,
    payload: any
  ) {
    const self = this as any

    if (!self[action]) {
      throw new Error(`Unknown action: ${action}`)
    }

    await self[action](handle, params, payload)
  }
}
