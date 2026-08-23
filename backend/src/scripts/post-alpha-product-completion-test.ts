import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const sidebar = read('frontend/src/components/layout/Sidebar.tsx')
const campaigns = read('frontend/src/pages/Campaigns.tsx')
const app = read('frontend/src/App.tsx')
const settings = read('frontend/src/pages/Settings.tsx')

assert.match(sidebar, /Overview/)
assert.match(sidebar, /Accounts/)
assert.match(sidebar, /Farm View \/ Sessions/)
assert.match(sidebar, /Campaigns/)
assert.match(sidebar, /Queue/)
assert.match(sidebar, /Activity/)
assert.match(app, /path="campaigns"/)
assert.match(app, /path="analytics" element={<ExperimentalUnavailable feature="Analytics"/)
assert.match(app, /path="content-planner" element={<ExperimentalUnavailable feature="Content Planner"/)
assert.match(app, /path="campaign-engine" element={<ExperimentalUnavailable feature="Campaign Engine"/)
assert.match(app, /path="scheduler" element={<ExperimentalUnavailable feature="Scheduler"/)

// Primary campaign workflow must not expose legacy diagnostics as an operator tab.
assert.doesNotMatch(campaigns, /\['simple', 'advanced', 'debug'\]/)
assert.doesNotMatch(campaigns, /Campaign workflow' : mode === 'advanced'/)
assert.match(campaigns, /campaignMode === 'advanced' && <>/)

// Destructive queue controls and browser-local exports are not product backups.
assert.doesNotMatch(settings, /Reset Queue/)
assert.doesNotMatch(settings, /Backup & Restore/)
assert.match(settings, /Browser preferences export/)

console.log('[PostAlphaProductCompletionTest] PASS: primary navigation and campaign workflow are operator-facing only.')
