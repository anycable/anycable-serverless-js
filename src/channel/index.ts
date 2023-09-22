import { Env } from "../rpc";

interface ConnectionDelegate<I = {}> {
  get env(): Env;
  get identifiers(): I | null;
}

export type ChannelState = { [key: string]: any };

export class ChannelHandle<I, S extends ChannelState = {}, T = any> {
  readonly identifier: string;
  private delegate: ConnectionDelegate<I>;
  state: Partial<S> = {};

  rejected: boolean = false;
  transmissions: T[] = [];
  streams: string[] = [];
  stoppedStreams: string[] = [];
  stopStreams: boolean = false;

  constructor(
    delegate: ConnectionDelegate<I>,
    identifier: string,
    state: Partial<S>,
  ) {
    this.delegate = delegate;
    this.identifier = identifier;
    this.state = state;
  }

  reject() {
    this.rejected = true;
    return this;
  }

  streamFrom(name: string) {
    this.streams.push(name);
    return this;
  }

  stopStreamFrom(name: string) {
    this.stoppedStreams.push(name);
    return this;
  }

  stopAllStreams() {
    this.stopStreams = true;
    return this;
  }

  transmit(data: T) {
    this.transmissions.push(data);
    return this;
  }

  get env(): Env {
    return this.delegate.env;
  }

  get identifiers(): I | null {
    return this.delegate.identifiers;
  }
}

export type ChannelParamsMap = { [token: string]: boolean | number | string };

export type ServerAction<
  ClientActions extends (...args: any[]) => void,
  I,
  S extends ChannelState = {},
  T = any,
  P extends ChannelParamsMap = {},
> = (
  handle: ChannelHandle<I, S, T>,
  params: P,
  ...args: Parameters<ClientActions>
) => ReturnType<ClientActions>;

export class Channel<
  IdentifiersType,
  ParamsType extends ChannelParamsMap = {},
  TransmissionsType = any,
  StateType extends ChannelState = {},
> {
  async subscribed(
    _handle: ChannelHandle<IdentifiersType, StateType, TransmissionsType>,
    _params: ParamsType | null,
  ): Promise<void> {}

  async unsubscribed(
    _handle: ChannelHandle<IdentifiersType, StateType, TransmissionsType>,
    _params: ParamsType | null,
  ): Promise<void> {
    return;
  }

  async handleAction(
    handle: ChannelHandle<IdentifiersType, StateType, TransmissionsType>,
    params: ParamsType | null,
    action: string,
    payload: any,
  ) {
    const self = this as any;

    if (!self[action]) {
      throw new Error(`Unknown action: ${action}`);
    }

    await self[action](handle, params, payload);
  }
}
