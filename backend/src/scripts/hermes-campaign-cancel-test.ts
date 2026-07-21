import assert from 'assert';
import { campaignCancellationAllowed } from '../routes/hermesShadowCampaignRoutes';

assert(campaignCancellationAllowed('pending', ['pending', 'queued']));
assert(campaignCancellationAllowed('paused', ['pending']));
assert(campaignCancellationAllowed('cancelled', ['cancelled']));
assert(!campaignCancellationAllowed('running', ['pending']));
assert(!campaignCancellationAllowed('pending', ['running']));
assert(!campaignCancellationAllowed('pending', ['completed']));
console.log('Hermes campaign cancellation targeted tests passed');
