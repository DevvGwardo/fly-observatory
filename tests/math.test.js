import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approachAngle, clampTarget, usableFrame, wrapAngle } from '../src/math.js';

test('heading interpolation takes the short route across the seam', () => {
  assert.ok(Math.abs(wrapAngle(approachAngle(3.1, -3.1, .5)) - Math.PI) < .001);
});
test('target stays inside the habitat', () => {
  const t = clampTarget(50, -20);
  assert.ok(Math.hypot(t.x, t.z) <= 8.000001);
  assert.deepEqual(clampTarget(3, 2), { x: 3, z: 2 });
  assert.throws(() => clampTarget(NaN, 0));
});
test('loading and invalid coordinates never animate the specimen', () => {
  assert.equal(usableFrame({ status: 'loading' }), false);
  assert.equal(usableFrame({ status: 'ready', body: [0, 0, NaN, 0], target: [1, 2] }), false);
  assert.equal(usableFrame({ status: 'ready', body: [0, 0, 0, 0], target: [1, 2] }), true);
});
