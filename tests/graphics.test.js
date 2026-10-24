import test from 'node:test';
import assert from 'node:assert/strict';
import { watchGraphics } from '../src/graphics.js';

test('graphics loss permits browser recovery and reports restoration', () => {
  const canvas = new EventTarget(), states = [];
  const stop = watchGraphics(canvas, lost => states.push(lost));
  const event = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.deepEqual(states, [true, false]);
  stop();
  canvas.dispatchEvent(new Event('webglcontextlost'));
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.deepEqual(states, [true, false]);
});
