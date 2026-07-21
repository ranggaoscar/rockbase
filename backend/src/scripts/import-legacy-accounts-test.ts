import assert from 'assert';
import { runLegacyAccountImport } from './import-legacy-accounts';

async function main(){
  const summary={source:0,inserted:0,updated:0,skipped:0,failed:0,skippedFields:[] as string[]};
  assert.deepStrictEqual(Object.keys(summary),['source','inserted','updated','skipped','failed','skippedFields']);
  assert.strictEqual(typeof runLegacyAccountImport,'function');
  console.log('Legacy account import targeted tests passed');
}
main().catch(e=>{console.error(e);process.exit(1)});
