import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import { signer } from '../src/index'

// You can generate the signed stream name as follows:
//
// # base64-encoded stream name
// echo -n "\"room/1989\"" | base64
//
// # signature
// echo -n "InJvb20vMTk4OSI=" | openssl dgst -sha256 -hmac "s3crit" | awk '{print $2}'

const testSignedStream =
  'InJvb20vMTk4OSI=--5f0b0aa1029922e0a716b93e843127b2e26732560a8fcc33d3dc09395f5d86a9'

const SignerTest = suite('Broadcaster')

SignerTest('generates signed stream', async () => {
  const secret = 's3crit'
  const stream = 'room/1989'

  const sign = signer(secret)

  const result = sign(stream)

  assert.equal(result, testSignedStream)
})

SignerTest.run()
