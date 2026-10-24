import { chapterWindow } from './field.js';
import { graphicsMessage } from './graphics.js';

export function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(whole / 3600), m = Math.floor(whole / 60) % 60, s = whole % 60;
  return `${h ? `${String(h).padStart(2, '0')}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function phaseProgress(elapsed, duration) {
  return duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : 0;
}

export class BroadcastOverlay {
  constructor(program, active, onView) {
    this.program = program;
    this.active = active;
    this.onView = onView;
    this.key = null;
    this.healthMessage = null;
    this.$ = id => document.getElementById(id);
    if (!active) return;
    document.body.classList.add('broadcast-mode');
    for (const id of ['broadcast-caption', 'broadcast-panel', 'broadcast-footer', 'broadcast-operator', 'broadcast-health']) {
      this.$(id).hidden = false;
    }
    document.querySelector('.edition').textContent = 'AN UNATTENDED, LIVE CONNECTOME EXHIBIT';
    this.items = program.phases.map((phase, index) => {
      const li = document.createElement('li'), number = document.createElement('span'), label = document.createElement('span');
      li.hidden = index >= 5;
      number.textContent = String(index + 1).padStart(2, '0'); label.textContent = phase.label;
      li.append(number, label); this.$('broadcast-program').append(li);
      return li;
    });
  }

  health(message = '') {
    if (!this.active || message === this.healthMessage) return;
    this.healthMessage = message;
    this.$('broadcast-health').hidden = !message;
    this.$('broadcast-health').textContent = message;
    document.body.classList.toggle('broadcast-offline', Boolean(message));
  }

  text(id, value) {
    const node = this.$(id);
    if (node.textContent !== value) node.textContent = value;
  }

  liveHealth(frame, graphicsLost = false, geometryUnavailable = false) {
    this.health(graphicsLost ? graphicsMessage : frame.paused ? 'EXHIBIT PAUSED · Press Space to resume'
      : geometryUnavailable ? 'BRAIN DISPLAY UNAVAILABLE · Retrying recorded neuron coordinates. Live simulation data continues.' : '');
  }

  update(frame, graphicsLost = false, geometryUnavailable = false) {
    const state = frame.broadcast || { enabled: false };
    this.$('broadcast-automatic').checked = state.enabled;
    const toggleText = state.enabled ? 'Stop auto director' : 'Start auto director';
    this.text('broadcast-toggle', toggleText);
    const phase = state.enabled ? this.program.phases[state.phase] : null;
    if (phase && (this.key !== `${state.cycle}:${state.phase}` || frame.seq < this.previousSeq)) {
      const key = `${state.cycle}:${state.phase}`;
      this.key = key;
      this.onView(phase.view);
      if (this.active) {
        document.body.dataset.broadcastView = phase.view;
        this.text('broadcast-chapter', `EXPERIMENT ${String(state.phase + 1).padStart(2, '0')} / ${String(this.program.phases.length).padStart(2, '0')}`);
        this.text('broadcast-title', phase.title);
        this.text('broadcast-description', phase.caption);
        this.items.forEach((li, index) => {
          const [start, end] = chapterWindow(state.phase, this.items.length);
          li.hidden = index < start || index >= end;
          li.classList.toggle('active', index === state.phase);
          li.classList.toggle('completed', index < state.phase);
        });
        document.body.classList.remove('broadcast-cut');
        void this.$('broadcast-caption').offsetWidth;
        document.body.classList.add('broadcast-cut');
      }
    }
    if (!phase) this.key = null;
    this.previousSeq = frame.seq;
    if (!this.active) return;
    this.liveHealth(frame, graphicsLost, geometryUnavailable);
    document.body.classList.toggle('broadcast-muted', frame.muted);
    this.text('broadcast-rate', frame.population_hz.toFixed(1));
    this.text('broadcast-spikes', `${frame.spikes.toLocaleString('en-US')} spikes in the last neural step`);
    this.text('broadcast-turn', `${frame.command > 0 ? '+' : ''}${frame.command.toFixed(2)}`);
    this.text('broadcast-distance', `${frame.distance.toFixed(2)} units`);
    this.text('broadcast-output', frame.muted ? 'OFF · CONTROL' : 'ON · NEURAL');
    this.text('broadcast-test', `DECODER TEST R² ${frame.metrics.test_r2.toFixed(3)}`);
    this.text('broadcast-clock', `NUMERICAL CLOCK / ${formatClock(frame.sim_time)}`);
    this.$('broadcast-reset').hidden = !phase?.reset || state.phase_elapsed >= 1.8;
    const resetText = phase?.scenario ? 'SCENE RESET · SEEDED STARTING BODY' : 'TRIAL RESET · IDENTICAL STARTING BODY';
    this.text('broadcast-reset', resetText);
    if (phase) {
      this.text('broadcast-cycle', `CYCLE ${String(state.cycle).padStart(3, '0')}`);
      this.text('broadcast-countdown', `${Math.ceil(Math.max(0, state.phase_duration - state.phase_elapsed))}s`);
      this.$('broadcast-progress').style.width = `${phaseProgress(state.phase_elapsed, state.phase_duration) * 100}%`;
      this.text('broadcast-next', this.program.phases[(state.phase + 1) % this.program.phases.length].label);
    } else {
      this.key = null;
      this.text('broadcast-chapter', 'OPERATOR CONTROL');
      this.text('broadcast-title', 'The exhibit is in your hands.');
      this.text('broadcast-description', 'The automatic director is off. Press D to return to the continuous experiment loop.');
      this.text('broadcast-countdown', 'MANUAL');
      this.$('broadcast-progress').style.width = '0%';
      this.text('broadcast-next', 'Press D to start the auto director');
      this.items.forEach((li, index) => { li.classList.remove('active', 'completed'); li.hidden = index >= 5; });
    }
  }
}
