import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterWindow, fieldSummary, fieldObjective, FieldOverlay } from '../src/field.js';

test('a long chapter list stays bounded around the active experiment', () => {
  for (let index = 0; index < 16; index++) {
    const [start, end] = chapterWindow(index, 16);
    assert.ok(start <= index && index < end);
    assert.equal(end - start, 5);
  }
  assert.deepEqual(chapterWindow(0, 3), [0, 3]);
});

test('field summaries report measured events and explicit simulated units', () => {
  assert.match(fieldSummary({ id: 'spider', escapes: 2, contacts: 1 }), /2 escapes.*1 contacts/);
  assert.match(fieldSummary({ id: 'wind', wind: [.3, .4], visited: 1, total: 2 }), /0.50 u\/s/);
  assert.match(fieldSummary({ id: 'plume', odor: .42, complete: false }), /42%.*SEARCHING/);
  assert.match(fieldSummary({ id: 'porch', visited: 1, total: 2, collisions: 0 }), /1\/2 lamps/);
});

test('picnic summaries retain measured danger totals after event notices expire', () => {
  const world = { id: 'picnic', visited: 3, total: 3, escapes: 3, contacts: 1, collisions: 0, event: '' };
  assert.equal(fieldSummary(world), '3/3 patches · 3 escapes · 1 contacts · 0 collisions');
  assert.equal(fieldSummary({ ...world, escapes: 4, contacts: 2, collisions: 1 }),
    '3/3 patches · 4 escapes · 2 contacts · 1 collisions');
  assert.equal(fieldSummary({ ...world, visited: 0, escapes: 0, contacts: 0 }),
    '0/3 patches · 0 escapes · 0 contacts · 0 collisions');
});

test('resource completion is explicit without claiming danger has ended', () => {
  assert.equal(fieldObjective({ id: 'plume', complete: false }), 'Find the fermenting fruit upwind');
  assert.equal(fieldObjective({ id: 'plume', complete: true }), 'Odor source visited · measured dwell');
  assert.equal(fieldObjective({ id: 'porch', complete: true }), 'All lamps visited · measured dwell');
  assert.match(fieldObjective({ id: 'orchard', complete: true }), /All food patches visited/);
  assert.match(fieldObjective({ id: 'maze', complete: true }), /route complete/);
  assert.match(fieldObjective({ id: 'picnic', complete: true }), /keep avoiding the swatter/);
  assert.match(fieldObjective({ id: 'wind', complete: true }), /gusts remain active/);
  assert.equal(fieldObjective({ id: 'spider', complete: false, escapes: 3 }), 'Escape the moving spider; avoid contact');
  assert.equal(fieldObjective({ id: 'lab', complete: false }), 'Track the light');
});

test('stable field HUD text avoids repeated writes and identifies the correct cue', () => {
  let writes = 0;
  const nodes = new Map();
  const node = () => {
    let text = '', label = '';
    return {
      get textContent() { return text; },
      set textContent(value) { text = value; writes++; },
      append() {}, getAttribute() { return label; },
      setAttribute(_, value) { label = value; },
    };
  };
  const original = globalThis.document;
  globalThis.document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    createElement: node, body: { dataset: {} },
    documentElement: { style: { setProperty() {} } },
  };
  try {
    const overlay = new FieldOverlay();
    const frame = { scenario: { id: 'orchard', visited: 0, total: 4, collisions: 0, score: 0, time: 1 } };
    overlay.update(frame);
    const first = writes;
    overlay.update(frame);
    assert.equal(writes, first);
    assert.equal(nodes.get('field-objective').textContent, 'Visit four fallen-fruit patches');
    const completed = { scenario: { ...frame.scenario, visited: 4, complete: true, time: 20 } };
    overlay.update(completed);
    assert.equal(nodes.get('field-objective').textContent, 'All food patches visited · route complete');
    const finished = writes;
    overlay.update(completed);
    assert.equal(writes, finished);
    overlay.update(frame);
    assert.equal(nodes.get('field-objective').textContent, 'Visit four fallen-fruit patches');
    assert.equal(nodes.get('target-description').textContent, 'CYAN / ENGINEERED CUE');
    assert.match(nodes.get('stage').getAttribute('aria-label'), /Windfall orchard/);
    overlay.update(frame, 'brain');
    assert.equal(nodes.get('target-description').textContent, 'AMBER / MEASURED SPIKES');
  } finally {
    globalThis.document = original;
  }
});
