import * as jose from 'jose'

export type IdentifiersMap = Record<string, any>

export interface IIdentificator<I extends IdentifiersMap = {}> {
  verify: (token: string) => Promise<true>
  verifyAndFetch(token: string): Promise<I | null>
  generateToken: (identifiers: I) => Promise<string>
}

export const identificator = <I extends IdentifiersMap>(
  secret: string,
  exp: string | number
) => {
  const secretEncoder = new TextEncoder().encode(secret)
  const alg = 'HS256'

  return {
    verify: async (token: string) => {
      await jose.jwtVerify(token, secretEncoder, {
        maxTokenAge: exp
      })

      return true
    },
    verifyAndFetch: async (token: string) => {
      const { payload } = await jose.jwtVerify(token, secretEncoder, {
        algorithms: [alg]
      })

      if (typeof payload.ext == 'string') {
        return JSON.parse(payload.ext) as I
      }

      return null
    },
    generateToken: async (identifiers: I) => {
      const token = await new jose.SignJWT({ ext: JSON.stringify(identifiers) })
        .setProtectedHeader({ alg })
        .setExpirationTime(exp)
        .setIssuedAt()
        .sign(secretEncoder)

      return token
    }
  }
}
