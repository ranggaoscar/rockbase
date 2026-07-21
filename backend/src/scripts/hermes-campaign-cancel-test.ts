import assert from 'assert';
import { campaignCancellationAllowed, campaignPostCancellationData } from '../routes/hermesShadowCampaignRoutes';

assert(campaignCancellationAllowed('pending', ['pending', 'queued']));
assert(campaignCancellationAllowed('paused', ['pending']));
assert(campaignCancellationAllowed('cancelled', ['cancelled']));
assert(!campaignCancellationAllowed('running', ['pending']));
assert(!campaignCancellationAllowed('pending', ['running']));
assert(!campaignCancellationAllowed('pending', ['completed']));
assert.strictEqual(campaignPostCancellationData.status, 'failed');
assert.strictEqual(JSON.parse(campaignPostCancellationData.results).error, 'CAMPAIGN_CANCELLED');
console.log('Hermes campaign cancellation targeted tests passed');

