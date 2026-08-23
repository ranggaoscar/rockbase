import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { needsOperatorAttention, operatorAttentionReason } from '../services/OperatorAttention'

const root = path.resolve(__dirname, '../../..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const dashboard = read('frontend/src/pages/Dashboard.tsx')
const campaigns = read('frontend/src/pages/Campaigns.tsx')
const activity = read('frontend/src/pages/ActivityTimeline.tsx')
const sessionHealth = read('backend/src/services/SessionHealthService.ts')

assert.equal(operatorAttentionReason({ status: 'active', sessionHealth: 'HEALTHY' }), null)
assert.equal(operatorAttentionReason({ status: 'active', sessionHealth: 'NEEDS_RELOGIN' }), 'LOGIN_REQUIRED')
assert.equal(operatorAttentionReason({ status: 'active', sessionHealth: 'CHECKPOINT' }), 'CHECKPOINT')
assert.equal(operatorAttentionReason({ status: 'active', sessionHealth: 'EXPIRED' }), 'SESSION_EXPIRED')
assert.equal(operatorAttentionReason({ status: 'logged_out', sessionHealth: 'UNKNOWN' }), 'ACCOUNT_UNAVAILABLE')
assert.equal(needsOperatorAttention({ status: 'active', sessionHealth: 'UNKNOWN' }), false)

assert.match(dashboard, /activityPresentation/)
assert.doesNotMatch(dashboard, /<CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground"/)
assert.match(campaigns, /campaignsError/)
assert.match(campaigns, /Campaigns could not be loaded/)
assert.match(campaigns, /Campaign details could not be loaded/)
assert.doesNotMatch(campaigns, /value=\{defaultCaptionSeed\}/)
assert.doesNotMatch(campaigns, /value=\{defaultHashtags\}/)
assert.doesNotMatch(campaigns, /value=\{suggestedTone\}/)
assert.doesNotMatch(campaigns, /value=\{suggestedCTA\}/)
assert.match(sessionHealth, /https:\/\/www\.tiktok\.com\//)
assert.match(sessionHealth, /detectTikTokHealth/)
assert.doesNotMatch(activity, /<p className="font-black">N\/A<\/p>/)
assert.doesNotMatch(activity, /Playwright Runtime/)

console.log('[PrimaryWorkflowTrustTest] PASS: operator attention, activity status, campaign truth, TikTok routing, and activity metrics are honest.')
