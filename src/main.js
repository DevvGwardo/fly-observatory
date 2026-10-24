import './style.css';
import './broadcast.css';
import './field.css';
import { Exhibit } from './scene.js';
import { clampTarget, usableFrame } from './math.js';
import { BroadcastOverlay } from './broadcast.js';
import { FieldOverlay } from './field.js';
import { watchGraphics } from './graphics.js';
import program from '../broadcast-program.json';

const $ = id => document.getElementById(id);
const staleMessage = 'Live data stopped. The exhibit is frozen until the simulator reconnects.';
let frame = null, exhibit = null, loadingGeometry = false;
let geometryRetryAt = 0, geometryUnavailable = false;
let history = [], previousSeq = -1, lastFrameAt = 0;
let connectionState = null;
let graphicsLost = false, stopGraphicsWatch = null;
let manualTarget = { x: 3, z: 1 };
const streamView = location.pathname === '/stream' || new URLSearchParams(location.search).get('stream') === '1';
const broadcast = new BroadcastOverlay(program, streamView, updateView);
const field = new FieldOverlay();
const controls = [...document.querySelectorAll('.console button, .console input, .console select'), $('broadcast-toggle')];
controls.forEach(el => { el.disabled = true; });

function connection(text, status = '') {
  const state = `${status}:${text}`;
  if (state === connectionState) return;
  connectionState = state;
  $('connection').className = `connection ${status}`;
  $('connection').querySelector('span').textContent = text;
}

function liveConnection(next) {
  connection(graphicsLost ? 'GRAPHICS INTERRUPTED' : next.paused ? 'PAUSED' : next.muted ? 'BRAIN OUTPUT OFF' : 'LIVE CONNECTOME',
    graphicsLost ? 'error' : next.muted ? '' : 'live');
}

async function command(payload) {
  $('control-error').textContent = '';
  try {
    const response = await fetch('/api/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Control rejected (${response.status})`);
  } catch (error) {
    $('control-error').textContent = error.message;
    if (frame) {
      $('automatic').checked = frame.automatic;
      $('brain-output').checked = !frame.muted;
    }
  }
}

function moveTarget(target) {
  manualTarget = clampTarget(target.x, target.z);
  command({ action: 'target', ...manualTarget });
}

try {
  exhibit = new Exhibit($('stage'), moveTarget);
  exhibit.broadcastLayout = streamView;
  stopGraphicsWatch = watchGraphics(exhibit.renderer.domElement, lost => {
    graphicsLost = lost;
    if (frame && exhibit.live && performance.now() - lastFrameAt < 3000) {
      liveConnection(frame);
      broadcast.liveHealth(frame, graphicsLost, geometryUnavailable && exhibit.view === 'brain');
    }
  });
} catch (error) {
  $('loading-message').textContent = 'This exhibit needs WebGL. Try a browser with hardware acceleration.';
  $('loading').querySelector('small').textContent = error.message;
  connection('RENDERER UNAVAILABLE', 'error');
}

async function loadGeometry() {
  if (loadingGeometry || exhibit?.geometryLoaded || performance.now() < geometryRetryAt) return;
  loadingGeometry = true;
  geometryRetryAt = performance.now() + 3000;
  try {
    const response = await fetch('/api/geometry');
    if (!response.ok) throw new Error(`Geometry request failed (${response.status})`);
    const data = await response.json();
    exhibit?.setGeometry(data);
    geometryUnavailable = false;
    if ($('control-error').textContent.startsWith('Brain geometry unavailable:')) $('control-error').textContent = '';
  } catch (error) {
    geometryUnavailable = true;
    $('control-error').textContent = `Brain geometry unavailable: ${error.message}`;
  } finally { loadingGeometry = false; }
}

function drawScope() {
  for (const canvas of streamView ? [$('broadcast-scope')] : [$('scope')]) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#293b40'; ctx.lineWidth = 1;
    for (let y = 25; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const max = 50; // Fixed DT-implied rate scale. Never auto-scale to exaggerate a response.
    ['left_hz', 'right_hz'].forEach((key, series) => {
      ctx.strokeStyle = series ? '#edb973' : '#8cddcd'; ctx.lineWidth = 2;
      ctx.beginPath();
      history.forEach((sample, i) => {
        const x = w - (160 - i) * w / 160;
        const y = h - 6 - Math.min(1, sample[key] / max) * (h - 16);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }
}

function updateView(view) {
  exhibit?.setView(view);
  const isBrain = view === 'brain';
  $('stage').setAttribute('aria-label', isBrain
    ? '3D recorded neuron locations with measured spike activity.'
    : view === 'macro' ? 'Detailed procedural fly specimen, viewed close up.' : '3D fly habitat with a movable light stimulus.');
  $('habitat-view').classList.toggle('selected', view === 'habitat');
  $('specimen-view').classList.toggle('selected', view === 'macro');
  $('brain-view').classList.toggle('selected', isBrain);
  $('habitat-view').setAttribute('aria-pressed', String(view === 'habitat'));
  $('specimen-view').setAttribute('aria-pressed', String(view === 'macro'));
  $('brain-view').setAttribute('aria-pressed', String(isBrain));
  $('stage-title').textContent = isBrain ? 'THE CONNECTOME' : view === 'macro' ? 'THE SPECIMEN' : 'THE HABITAT';
  $('stage-title').nextElementSibling.textContent = isBrain ? '03 / 03' : view === 'macro' ? '02 / 03' : '01 / 03';
  $('specimen-name').textContent = isBrain ? '16,000 RECORDED NEURON LOCATIONS' : 'D. MELANOGASTER';
  $('specimen-description').textContent = isBrain ? 'MEASURED SPIKES · BRIGHT AMBER / ACTIVE' : 'PROCEDURAL SPECIMEN · 6 LEGS · 2 WINGS';
  $('target-label').textContent = isBrain ? 'SPIKE EVENTS' : 'LIGHT STIMULUS';
  $('stage-hint').textContent = isBrain ? 'DRAG TO ORBIT · SCROLL TO INSPECT' : 'DRAG TO ORBIT · CLICK THE FLOOR TO MOVE THE LIGHT';
  if (isBrain) loadGeometry();
}

function receive(next) {
  lastFrameAt = performance.now();
  if (!usableFrame(next)) {
    const failed = next.status === 'error';
    connection(failed ? 'SIMULATOR ERROR' : 'CALIBRATING', failed ? 'error' : '');
    $('loading-message').textContent = next.message || 'Waiting for the live simulator';
    if (exhibit) $('loading').hidden = false;
    controls.forEach(el => { el.disabled = true; });
    frame = null;
    exhibit?.setLive(false);
    broadcast.health(failed ? `SIMULATION ERROR · ${next.message}` : next.message || 'Loading the real connectome.');
    return;
  }
  frame = next;
  if (!exhibit) return;
  $('loading').hidden = true;
  if ($('control-error').textContent === staleMessage) $('control-error').textContent = '';
  liveConnection(next);
  controls.forEach(el => { el.disabled = false; });
  exhibit.update(next);
  const brainView = next.broadcast?.enabled
    ? program.phases[next.broadcast.phase]?.view === 'brain' : exhibit.view === 'brain';
  broadcast.update(next, graphicsLost, geometryUnavailable && brainView);
  exhibit.setBroadcast(next.broadcast);
  field.update(next, exhibit.view);
  loadGeometry();
  $('bearing-value').textContent = `${(next.bearing * 180 / Math.PI).toFixed(0)}°`;
  $('rate-value').textContent = `${next.population_hz.toFixed(1)} Hz`;
  $('turn-value').textContent = next.command > .02 ? `${next.command.toFixed(2)} ↻` : next.command < -.02 ? `${Math.abs(next.command).toFixed(2)} ↺` : '0.00';
  for (const [name, value] of [['left', next.left_hz], ['right', next.right_hz]]) {
    $(`${name}-value`).textContent = value.toFixed(1);
    $(`${name}-bar`).style.width = `${Math.min(value / 50 * 100, 100)}%`;
  }
  $('sample-clock').textContent = `t = ${next.sim_time.toFixed(2)} s`;
  $('decoder-score').textContent = next.metrics.test_r2.toFixed(3);
  $('acquired-time').innerHTML = `${next.acquired_seconds.toFixed(1)}<em>s</em>`;
  $('neuron-count').textContent = next.neurons.toLocaleString('en-US');
  $('pause').textContent = next.paused ? 'Resume' : 'Pause';
  $('automatic').checked = next.automatic;
  $('brain-output').checked = !next.muted;
  $('brain-control-note').textContent = next.muted ? 'Off · no neural turn command' : 'On · turn comes from the decoder';
  const inField = next.scenario?.id && next.scenario.id !== 'lab';
  $('task-heading').textContent = inField ? next.scenario.name : next.mode === 'seek' ? 'Follow the light.' : 'Turn away from light.';
  $('task-description').textContent = inField ? next.scenario.adapter : next.mode === 'seek'
    ? 'A target becomes a neural stimulus. Descending-neuron activity becomes a turn.'
    : 'The task adapter reverses the desired bearing. The same frozen network and decoder steer away.';
  document.querySelectorAll('[data-task]').forEach(button => {
    const selected = button.dataset.task === next.mode;
    button.classList.toggle('selected', selected);
    const pressed = String(selected);
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
  });
  $('runtime-details').textContent = `${next.device.toUpperCase()} · ${next.step_ms.toFixed(1)} ms per step · ${next.encoder_cells.toLocaleString()} encoded relay cells · ${next.descending_cells.toLocaleString()} descending cells · ${next.metrics.decoder_cells} decoder features · ${next.metrics.training_samples} training samples · penalty ${next.metrics.penalty} · held-out R² ${next.metrics.test_r2}.`;
  if (next.seq < previousSeq) history = [];
  if (next.seq !== previousSeq) {
    history.push({ left_hz: next.left_hz, right_hz: next.right_hz });
    if (history.length > 160) history.shift();
    drawScope(); previousSeq = next.seq;
  }
}

const events = new EventSource('/api/stream');
events.onmessage = event => {
  try { receive(JSON.parse(event.data)); }
  catch (error) { $('control-error').textContent = `Invalid simulator frame: ${error.message}`; }
};
events.onerror = () => {
  connection('RECONNECTING', 'error');
  controls.forEach(el => { el.disabled = true; });
  exhibit?.setLive(false);
  broadcast.health('SIGNAL INTERRUPTED · Reconnecting to the live simulation.');
};
const staleTimer = setInterval(() => {
  if (frame && performance.now() - lastFrameAt > 3000) {
    connection('CONNECTION LOST', 'error');
    controls.forEach(el => { el.disabled = true; });
    $('control-error').textContent = staleMessage;
    exhibit?.setLive(false);
    broadcast.health('LIVE DATA STOPPED · The exhibit is frozen until the simulator reconnects.');
  }
}, 1000);
let operatorTimer;
if (streamView) window.addEventListener('pointermove', () => {
  document.body.classList.add('operator-visible');
  clearTimeout(operatorTimer);
  operatorTimer = setTimeout(() => document.body.classList.remove('operator-visible'), 2200);
});

function manualView(view) {
  command({ action: 'broadcast', value: false });
  updateView(view);
}
$('habitat-view').addEventListener('click', () => manualView('habitat'));
$('specimen-view').addEventListener('click', () => manualView('macro'));
$('brain-view').addEventListener('click', () => manualView('brain'));
$('camera-reset').addEventListener('click', () => exhibit?.resetCamera());
$('pause').addEventListener('click', () => command({ action: 'pause', value: !frame.paused }));
$('reset').addEventListener('click', () => command({ action: 'reset' }));
$('automatic').addEventListener('change', e => command({ action: 'automatic', value: e.target.checked }));
$('brain-output').addEventListener('change', e => command({ action: 'mute', value: !e.target.checked }));
$('broadcast-automatic').addEventListener('change', e => command({ action: 'broadcast', value: e.target.checked }));
$('broadcast-toggle').addEventListener('click', () => command({ action: 'broadcast', value: !frame?.broadcast?.enabled }));
$('scenario-select').addEventListener('change', e => {
  command({ action: 'scenario', value: e.target.value }); updateView('habitat');
});
$('move-light').addEventListener('click', () => {
  const angle = (frame?.sim_time || 0) * 1.73 + 1.8;
  moveTarget({ x: Math.cos(angle) * 5, z: Math.sin(angle) * 5 });
});
document.querySelectorAll('[data-task]').forEach(button => button.addEventListener('click', () =>
  command({ action: 'mode', value: button.dataset.task })));
$('method-toggle').addEventListener('click', () => {
  const open = $('method-details').hidden;
  $('method-details').hidden = !open;
  $('method-toggle').setAttribute('aria-expanded', String(open));
  $('method-toggle').querySelector('span').textContent = open ? '−' : '+';
});
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement || event.target instanceof HTMLSelectElement) return;
  if (event.key.toLowerCase() === 'd' && frame) {
    command({ action: 'broadcast', value: !frame.broadcast?.enabled }); return;
  }
  if (streamView && event.code === 'Space' && frame) {
    event.preventDefault(); command({ action: 'pause', value: !frame.paused }); return;
  }
  if (streamView && event.key === 'Escape') { location.assign('/'); return; }
  if (event.key.toLowerCase() === 'f') {
    document.body.classList.toggle('presentation-mode');
    exhibit?.resize(); return;
  }
  if (!frame || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  if (frame.automatic) manualTarget = { x: frame.target[0], z: frame.target[1] };
  const dx = event.key === 'ArrowLeft' ? -.5 : event.key === 'ArrowRight' ? .5 : 0;
  const dz = event.key === 'ArrowUp' ? -.5 : event.key === 'ArrowDown' ? .5 : 0;
  moveTarget({ x: manualTarget.x + dx, z: manualTarget.z + dz });
});
// Small read-only diagnostic surface for browser validation.
window.__observatory = {
  get frame() { return frame; },
  get view() { return exhibit?.view; },
  get geometryLoaded() { return exhibit?.geometryLoaded; },
  get renderedFrames() { return exhibit?.renderCount; },
  get live() { return exhibit?.live; },
  get cameraPose() { return exhibit ? [...exhibit.camera.position.toArray(), ...exhibit.controls.target.toArray()] : null; },
  get bodyPose() { return exhibit ? [...exhibit.habitat.specimen.group.position.toArray(), exhibit.habitat.specimen.group.rotation.y] : null; },
  get displayedCells() { return exhibit?.brain.size || 0; },
  get streamView() { return streamView; },
};
window.addEventListener('pagehide', () => {
  events.close(); clearInterval(staleTimer); clearTimeout(operatorTimer); stopGraphicsWatch?.(); exhibit?.dispose();
}, { once: true });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
