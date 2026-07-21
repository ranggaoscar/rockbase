import assert from 'assert/strict';
import {
  campaignCompletionBlocked,
  campaignRecoveryActionStatus,
} from '../services/CampaignService';

function main(): void {
  assert.equal(campaignRecoveryActionStatus('running'), 'unknown');
  assert.equal(campaignRecoveryActionStatus('completed'), 'completed');
  assert.equal(campaignRecoveryActionStatus('pending'), 'pending');

  assert.equal(campaignCompletionBlocked(['completed', 'failed']), false);
  assert.equal(campaignCompletionBlocked(['completed', 'pending']), true);
  assert.equal(campaignCompletionBlocked(['completed', 'running']), true);
  assert.equal(campaignCompletionBlocked(['completed', 'unknown']), true);

  const recovered = ['running', 'completed', 'failed'].map(campaignRecoveryActionStatus);
  assert.deepEqual(recovered, ['unknown', 'completed', 'failed']);
  console.log('[CampaignRecoveryTest] PASS: restart, stranded action, unknown state, duplicate-safe completion guard.');
}

main();
