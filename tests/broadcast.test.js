import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { BroadcastOverlay, formatClock, phaseProgress } from '../src/broadcast.js';

test('broadcast clock never wraps its hours or emits invalid time', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(65.9), '01:05');
  assert.equal(formatClock(3661), '01:01:01');
  assert.equal(formatClock(360000), '100:00:00');
  assert.equal(formatClock(NaN), '00:00');
});

test('chapter progress is bounded at startup and rollover', () => {
  assert.equal(phaseProgress(-1, 10), 0);
  assert.equal(phaseProgress(5, 10), .5);
  assert.equal(phaseProgress(11, 10), 1);
  assert.equal(phaseProgress(1, 0), 0);
});

test('the shared program has matched controls and all three views', () => {
  const program = JSON.parse(readFileSync(new URL('../broadcast-program.json', import.meta.url), 'utf8'));
  assert.deepEqual(new Set(program.phases.map(p => p.view)), new Set(['habitat', 'macro', 'brain']));
  const off = program.phases.find(p => p.id === 'control');
  const on = program.phases.find(p => p.id === 'restore');
  assert.deepEqual(off.point, on.point);
  assert.equal(off.reset && on.reset, true);
  assert.equal(off.muted, true);
  assert.equal(on.muted, false);
  assert.equal(new Set(program.phases.map(p => p.id)).size, program.phases.length);
  assert.ok(program.phases.every(p => p.duration > 0 && p.caption.length > 20));
});

test('re-enabling the same chapter restores its view after manual takeover', () => {
  const views = [];
  const overlay = new BroadcastOverlay({ phases: [{ view: 'habitat' }] }, false, view => views.push(view));
  overlay.$ = () => ({});
  overlay.update({ seq: 1, broadcast: { enabled: true, cycle: 1, phase: 0 } });
  overlay.update({ seq: 2, broadcast: { enabled: false } });
  overlay.update({ seq: 3, broadcast: { enabled: true, cycle: 1, phase: 0 } });
  assert.deepEqual(views, ['habitat', 'habitat']);
});

test('unchanged health notices do not repeatedly mutate live regions', () => {
  const previousDocument = globalThis.document;
  let writes = 0, toggles = 0;
  const element = { set textContent(value) { writes++; } };
  globalThis.document = { body: { classList: { toggle() { toggles++; } } } };
  try {
    const overlay = Object.assign(Object.create(BroadcastOverlay.prototype), {
      active: true, healthMessage: null, $: () => element,
    });
    for (let i = 0; i < 100; i++) overlay.health('EXHIBIT PAUSED');
    assert.equal(writes, 1);
    assert.equal(toggles, 1);
    assert.equal(element.hidden, false);
    overlay.health('');
    assert.equal(writes, 2);
    assert.equal(element.hidden, true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

function broadcastFixture() {
  const nodes = new Map(), previousDocument = globalThis.document;
  const element = () => {
    let text = '';
    return {
      writes: 0, style: {}, classList: { toggle() {}, remove() {}, add() {} },
      get textContent() { return text; },
      set textContent(value) { text = value; this.writes++; },
    };
  };
  globalThis.document = {
    body: { dataset: {}, classList: { toggle() {}, remove() {}, add() {} } },
  };
  const phase = { view: 'habitat', title: 'Light tracking', caption: 'Measured neural steering.', label: 'Track', reset: true };
  const overlay = Object.assign(Object.create(BroadcastOverlay.prototype), {
    active: true, key: null, healthMessage: null, program: { phases: [phase] },
    items: [element()], onView() {},
    $(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
  });
  const frame = {
    seq: 1, paused: false, muted: false, population_hz: 8.1, spikes: 27000,
    command: .15, distance: 2, sim_time: 5.2, metrics: { test_r2: .815 },
    broadcast: { enabled: true, cycle: 1, phase: 0, phase_elapsed: .2, phase_duration: 14 },
  };
  return { overlay, frame, nodes, restore() {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  } };
}

test('stable broadcast labels do not replace text on each live frame', () => {
  const { overlay, frame, nodes, restore } = broadcastFixture();
  try {
    for (let seq = 1; seq <= 100; seq++) overlay.update({ ...frame, seq });
    for (const id of ['broadcast-test', 'broadcast-output', 'broadcast-next', 'broadcast-clock',
      'broadcast-spikes', 'broadcast-rate', 'broadcast-countdown']) {
      assert.equal(nodes.get(id).writes, 1, id);
    }
    overlay.update({ ...frame, seq: 101, sim_time: 6.2, spikes: 28000, population_hz: 8.4,
      muted: true, broadcast: { ...frame.broadcast, phase_elapsed: 1.2 } });
    for (const id of ['broadcast-output', 'broadcast-clock', 'broadcast-spikes', 'broadcast-rate', 'broadcast-countdown']) {
      assert.equal(nodes.get(id).writes, 2, id);
    }
    assert.equal(nodes.get('broadcast-clock').textContent, 'NUMERICAL CLOCK / 00:06');
    assert.equal(nodes.get('broadcast-output').textContent, 'OFF · CONTROL');
    assert.equal(nodes.get('broadcast-test').writes, 1);
  } finally { restore(); }
});

test('manual captions change once per takeover and restore on re-enable', () => {
  const { overlay, frame, nodes, restore } = broadcastFixture();
  try {
    overlay.update(frame);
    const manual = { ...frame, broadcast: { enabled: false } };
    for (let seq = 2; seq <= 100; seq++) overlay.update({ ...manual, seq });
    for (const id of ['broadcast-title', 'broadcast-description', 'broadcast-chapter']) {
      assert.equal(nodes.get(id).writes, 2, id);
    }
    assert.equal(nodes.get('broadcast-title').textContent, 'The exhibit is in your hands.');
    overlay.update({ ...frame, seq: 101 });
    assert.equal(nodes.get('broadcast-title').textContent, 'Light tracking');
    assert.equal(nodes.get('broadcast-title').writes, 3);
  } finally { restore(); }
});

test('live frames retain graphics warnings without repeated announcements, then restore paused health', () => {
  const { overlay, frame, nodes, restore } = broadcastFixture();
  try {
    for (let seq = 1; seq <= 100; seq++) overlay.update({ ...frame, seq }, true);
    const notice = nodes.get('broadcast-health');
    assert.match(notice.textContent, /GRAPHICS INTERRUPTED.*Live data continues/);
    assert.equal(notice.hidden, false);
    assert.equal(notice.writes, 1);
    overlay.liveHealth({ ...frame, paused: true }, false);
    assert.match(notice.textContent, /EXHIBIT PAUSED/);
    overlay.liveHealth(frame, false);
    assert.equal(notice.hidden, true);
  } finally { restore(); }
});

test('geometry failures stay visible once, respect graphics/pause priority and clear on recovery', () => {
  const { overlay, frame, nodes, restore } = broadcastFixture();
  try {
    for (let seq = 1; seq <= 100; seq++) overlay.update({ ...frame, seq }, false, true);
    const notice = nodes.get('broadcast-health');
    assert.match(notice.textContent, /BRAIN DISPLAY UNAVAILABLE.*recorded neuron coordinates.*Live simulation data continues/);
    assert.equal(notice.hidden, false);
    assert.equal(notice.writes, 1);
    overlay.liveHealth(frame, true, true);
    assert.match(notice.textContent, /GRAPHICS INTERRUPTED/);
    overlay.liveHealth({ ...frame, paused: true }, false, true);
    assert.match(notice.textContent, /EXHIBIT PAUSED/);
    overlay.liveHealth(frame, false, true);
    assert.match(notice.textContent, /BRAIN DISPLAY UNAVAILABLE/);
    overlay.liveHealth(frame, false, false);
    assert.equal(notice.hidden, true);
  } finally { restore(); }
});
