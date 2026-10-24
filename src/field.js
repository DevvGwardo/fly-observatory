import catalogue from '../scenarios.json' with { type: 'json' };

export function fieldSummary(world) {
  if (!world || world.id === 'lab') return 'LIGHT TRACKING · ENGINEERED BEARING';
  if (world.id === 'spider') return `${world.escapes} escapes · ${world.contacts} contacts`;
  if (world.id === 'picnic') return `${world.visited}/${world.total} patches · ${world.escapes} escapes · ${world.contacts} contacts · ${world.collisions} collisions`;
  if (world.id === 'plume') return `ODOR ${(world.odor * 100).toFixed(0)}% · ${world.complete ? 'SOURCE VISITED' : 'SEARCHING UPWIND'}`;
  if (world.id === 'wind') return `WIND ${Math.hypot(...world.wind).toFixed(2)} u/s · ${world.visited}/${world.total} patches`;
  return `${world.visited}/${world.total} ${world.id === 'porch' ? 'lamps' : 'patches'} · ${world.collisions} collisions`;
}

export function fieldObjective(world) {
  if (!world.complete) return catalogue[world.id].objective;
  if (world.id === 'porch') return 'All lamps visited · measured dwell';
  if (world.id === 'plume') return 'Odor source visited · measured dwell';
  if (world.id === 'picnic') return 'All food visited · keep avoiding the swatter';
  if (world.id === 'wind') return 'All food visited · gusts remain active';
  return 'All food patches visited · route complete';
}

export function chapterWindow(index, count, size = 5) {
  const start = Math.max(0, Math.min(index - 1, count - size));
  return [start, Math.min(count, start + size)];
}

export class FieldOverlay {
  constructor() {
    this.$ = id => document.getElementById(id);
    for (const [id, spec] of Object.entries(catalogue)) {
      const option = document.createElement('option'); option.value = id; option.textContent = spec.name;
      this.$('scenario-select').append(option);
    }
    this.previous = null;
    this.eventKey = null;
  }

  text(id, value) {
    const node = this.$(id);
    if (node.textContent !== value) node.textContent = value;
  }

  update(frame, view = 'habitat') {
    const world = frame.scenario || { id: 'lab' };
    const spec = catalogue[world.id], active = world.id !== 'lab';
    if (this.$('scenario-select').value !== world.id) this.$('scenario-select').value = world.id;
    if (!this.previous || this.previous.id !== world.id) {
      document.body.dataset.scenario = world.id;
      document.documentElement.style.setProperty('--field-accent', spec.accent);
      this.$('field-overlay').hidden = !active;
      this.$('field-name').textContent = spec.name.toUpperCase();
      this.$('field-adapter').textContent = active ? world.adapter : spec.adapter;
      this.$('scenario-summary').textContent = active ? `${spec.objective}. ${world.adapter}.` : 'Choose a field simulation, or return to the light-tracking laboratory.';
    }
    this.text('field-objective', fieldObjective(world));
    this.text('field-stats', fieldSummary(world));
    this.text('field-score', active ? `${world.score} PTS` : '');
    const event = world.event || '';
    if (this.$('field-event').textContent !== event) this.$('field-event').textContent = event;
    this.$('field-event').hidden = !world.event;
    if (this.previous && (this.previous.id !== world.id || this.previous.time > world.time)) this.eventKey = null;
    const key = `${world.id}:${world.event_id}`;
    if (world.event && key !== this.eventKey) {
      this.$('field-event').classList.remove('field-event-pop');
      void this.$('field-event').offsetWidth;
      this.$('field-event').classList.add('field-event-pop');
      this.eventKey = key;
    }
    this.text('target-label', view === 'brain' ? 'SPIKE EVENTS' : active ? 'ENGINEERED GUIDANCE' : 'LIGHT STIMULUS');
    this.text('target-description', view === 'brain' ? 'AMBER / MEASURED SPIKES' : active ? 'CYAN / ENGINEERED CUE' : 'AMBER / INPUT');
    this.text('stage-hint', view === 'brain' ? 'DRAG TO ORBIT · SCROLL TO INSPECT'
      : active ? 'FIELD SIMULATION · CYAN RING / ENGINEERED CUE' : 'DRAG TO ORBIT · CLICK THE FLOOR TO MOVE THE LIGHT');
    const label = view === 'brain' ? '3D recorded neuron locations with measured spike activity.'
      : view === 'macro' ? 'Detailed procedural fly specimen, viewed close up.'
      : active ? `3D field simulation: ${spec.name}. Engineered guidance and measured objectives.`
      : '3D fly habitat with a movable light stimulus.';
    if (this.$('stage').getAttribute('aria-label') !== label) this.$('stage').setAttribute('aria-label', label);
    this.previous = world;
  }
}
