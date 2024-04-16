import { createHmac } from 'crypto'

export type IStreamSigner = (stream: string) => string

export const signer = (secret: string): IStreamSigner => {
  const sign = (stream: string): string => {
    const encoded = Buffer.from(JSON.stringify(stream)).toString('base64')
    const digest = createHmac('sha256', secret).update(encoded).digest('hex')
    return `${encoded}--${digest}`
  }

  return sign
}
