import assert from 'node:assert/strict'
import { sessionHealthService } from '../services/SessionHealthService'

type Fixture = { url: string; body: string; visible?: string[] }

function fakePage(fixture: Fixture) {
  return {
    url: () => fixture.url,
    locator: (selector: string) => ({
      first: () => ({
        isVisible: async () => Boolean(fixture.visible?.some(value => selector.includes(value))),
      }),
      innerText: async () => fixture.body,
    }),
  }
}

async function detect(fixture: Fixture) {
  return (sessionHealthService as any).detectTikTokHealth(fakePage(fixture))
}

async function main() {
  assert.equal((await detect({ url: 'https://www.tiktok.com/login', body: 'Log in to TikTok' })).health, 'NEEDS_RELOGIN')
  assert.equal((await detect({ url: 'https://www.tiktok.com/verify', body: 'Verification required' })).health, 'CHECKPOINT')
  assert.equal((await detect({ url: 'https://www.tiktok.com/', body: 'For You', visible: ['data-e2e="profile-icon"'] })).health, 'HEALTHY')
  assert.equal((await detect({ url: 'https://www.tiktok.com/', body: 'For You' })).health, 'UNKNOWN')
  console.log('[TikTokSessionHealthTest] PASS: TikTok-specific login, verification, healthy, and unknown fixtures are classified correctly.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
