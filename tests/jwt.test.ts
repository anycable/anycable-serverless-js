import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import * as jose from 'jose'
import { identificator } from '../src/index'

const IdentificatorTest = suite('Identificator')

const generateToken = async (
  secret: string,
  payload: object,
  options?: Partial<{
    exp: string | number
    iat: number
  }>
) => {
  const secretEncoder = new TextEncoder().encode(secret)
  const alg = 'HS256'

  options = options || {}

  const token = await new jose.SignJWT({ ext: JSON.stringify(payload) })
    .setProtectedHeader({ alg })
    .setExpirationTime(options.exp || '1h')
    .setIssuedAt(options.iat)
    .sign(secretEncoder)

  return token
}

IdentificatorTest('verifies token', async () => {
  const secret = 'super-secret'
  const token = await generateToken(secret, {})

  const id = identificator(secret, '1h')
  const result = await id.verify(token)
  assert.is(result, true)
})

IdentificatorTest('verify throws when expired token', async () => {
  const secret = 'super-secret'
  const token = await generateToken(secret, {}, { exp: '1s' })

  await new Promise(resolve => setTimeout(resolve, 1100))

  const id = identificator(secret, '1s')

  try {
    await id.verify(token)
    assert.unreachable('Should have thrown an error for expired token')
  } catch (error) {
    assert.is(error.code, 'ERR_JWT_EXPIRED')
  }
})

IdentificatorTest('verifies and fetches token', async () => {
  const secret = 'super-secret'
  const mockData = { key: 'value' }
  const token = await generateToken(secret, mockData)

  const id = identificator(secret, '1h')
  const result = await id.verifyAndFetch(token)
  assert.equal(result, mockData)
})

IdentificatorTest('verifyAndFetch throws when expired token', async () => {
  const secret = 'super-secret'
  const token = await generateToken(secret, {}, { exp: '1s' })

  await new Promise(resolve => setTimeout(resolve, 1100))

  const id = identificator(secret, '1s')

  try {
    await id.verifyAndFetch(token)
    assert.unreachable('Should have thrown an error for expired token')
  } catch (error) {
    assert.is(error.code, 'ERR_JWT_EXPIRED')
  }
})

IdentificatorTest('generates token', async () => {
  const secret = 'super-secret'
  const mockData = { key: 'value' }
  const mockToken = await generateToken(secret, mockData)

  const id = identificator(secret, '1h')
  const result = await id.generateToken(mockData)
  assert.is(result, mockToken)
})

IdentificatorTest.run()
