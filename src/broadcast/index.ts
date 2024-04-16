export type IBroadcast = (stream: string, data: any) => Promise<void>

export type IMetadata = {
  transient?: boolean
  exclude_socket?: string
  broadcast_type?: string
}

export type IPayload = {
  stream: string
  data: string
  meta?: IMetadata
}

export const broadcaster = (
  url: string,
  secret: string | undefined
): IBroadcast => {
  const broadcastHeaders: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (secret) {
    broadcastHeaders['Authorization'] = `Bearer ${secret}`
  }

  const broadcast = async (
    stream: string,
    data: any,
    meta: IMetadata | undefined = undefined
  ) => {
    const payload: IPayload = {
      stream,
      data: JSON.stringify(data)
    }

    if (meta) {
      payload.meta = meta
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: broadcastHeaders,
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      throw new Error(`Error broadcasting to ${stream}: ${res.statusText}`)
    }
  }

  return broadcast
}
