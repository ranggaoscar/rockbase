import assert from 'assert';
import { classifySession } from './validate-imported-sessions';
assert.strictEqual(classifySession(200,'<html>home</html>'),'VALID');
assert.strictEqual(classifySession(200,'Log in to Instagram'),'EXPIRED');
assert.strictEqual(classifySession(200,'checkpoint required'),'NEEDS_CHALLENGE');
assert.strictEqual(classifySession(500,''),'CHECK_FAILED');
console.log('Imported session validation targeted tests passed');
