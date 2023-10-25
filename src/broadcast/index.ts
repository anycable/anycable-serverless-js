export type IBroadcast = (stream: string, data: any) => Promise<void>

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

  const broadcast = async (stream: string, data: any) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: broadcastHeaders,
      body: JSON.stringify({
        stream,
        data: JSON.stringify(data)
      })
    })

    if (!res.ok) {
      throw new Error(`Error broadcasting to ${stream}: ${res.statusText}`)
    }
  }

  return broadcast
}
