import * as THREE from 'three';
import catalogue from '../scenarios.json' with { type: 'json' };

function mesh(parent, geometry, material, position, scale = [1, 1, 1]) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position); object.scale.set(...scale);
  object.castShadow = true; object.receiveShadow = true;
  parent.add(object);
  return object;
}

function ring(parent, radius, color, opacity = .45) {
  const object = mesh(parent, new THREE.RingGeometry(radius - .025, radius, 72),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }), [0, .035, 0]);
  object.rotation.x = -Math.PI / 2; object.castShadow = false;
  return object;
}

function fruit(parent, x, z, index, accent) {
  const group = new THREE.Group(); group.position.set(x, 0, z); parent.add(group);
  const material = new THREE.MeshStandardMaterial({
    color: ['#b96938', '#946944', '#a77636', '#865f63'][index % 4], roughness: .8,
  });
  mesh(group, new THREE.SphereGeometry(.8, 24, 16), material, [0, .5, 0], [1.2, .7, 1]);
  const flesh = new THREE.MeshStandardMaterial({ color: '#d8bf87', roughness: .95 });
  const slice = mesh(group, new THREE.CircleGeometry(.55, 28), flesh, [.65, .72, .15]);
  slice.rotation.set(-.6, .4, .2);
  const stem = mesh(group, new THREE.CylinderGeometry(.045, .07, .38, 7),
    new THREE.MeshStandardMaterial({ color: '#54452d' }), [0, 1.15, 0]);
  stem.rotation.z = .3;
  ring(group, 1.15, accent);
  return group;
}

function groundMap(id) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = catalogue[id].floor; ctx.fillRect(0, 0, 512, 512);
  let seed = 71;
  for (let i = 0; i < 5000; i++) {
    seed = seed * 16807 % 2147483647; const x = seed % 512;
    seed = seed * 16807 % 2147483647; const y = seed % 512;
    ctx.fillStyle = i % 2 ? '#111b2230' : '#e9dfb622'; ctx.fillRect(x, y, 2, 2);
  }
  if (id === 'picnic') {
    for (let i = 0; i < 512; i += 64) {
      ctx.fillStyle = '#d7b2a633'; ctx.fillRect(i, 0, 32, 512); ctx.fillRect(0, i, 512, 32);
    }
  } else if (id === 'porch') {
    ctx.strokeStyle = '#182733'; ctx.lineWidth = 4;
    for (let y = 0; y < 512; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function spider(parent) {
  const group = new THREE.Group(); parent.add(group);
  const material = new THREE.MeshStandardMaterial({ color: '#34272a', roughness: .7 });
  mesh(group, new THREE.SphereGeometry(.65, 24, 16), material, [0, .55, 0], [1, .7, 1.25]);
  mesh(group, new THREE.SphereGeometry(.4, 20, 14), material, [0, .4, -.6]);
  const legs = [];
  for (let side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const leg = new THREE.Group(); leg.position.set(side * .3, .45, -.55 + i * .33); group.add(leg);
    const upper = mesh(leg, new THREE.CylinderGeometry(.045, .06, 1.1, 6), material, [side * .45, .05, 0]);
    upper.rotation.z = side * -1.3;
    const lower = mesh(leg, new THREE.CylinderGeometry(.015, .04, .8, 6), material, [side * .9, -.16, 0]);
    lower.rotation.z = side * -.35;
    legs.push(leg);
  }
  const eye = new THREE.MeshStandardMaterial({ color: '#eab180', emissive: '#993b22', emissiveIntensity: .3 });
  for (let i = 0; i < 4; i++) mesh(group, new THREE.SphereGeometry(.055, 8, 6), eye, [-.18 + i * .12, .57, -.92]);
  ring(group, 3.2, '#f4a58e', .2);
  return { group, legs };
}

export class FieldStage {
  constructor(habitat) {
    this.habitat = habitat;
    this.groups = {};
    this.id = 'lab';
    this.labMap = habitat.floor.material.map;
    this.maps = {};
    const stone = new THREE.MeshStandardMaterial({ color: '#747a69', roughness: .95 });
    const leaf = new THREE.MeshStandardMaterial({ color: '#647b44', side: THREE.DoubleSide, roughness: .8 });
    for (const [id, spec] of Object.entries(catalogue)) {
      if (id === 'lab') continue;
      const group = new THREE.Group(); group.visible = false; habitat.scene.add(group);
      this.maps[id] = groundMap(id);
      const resources = [];
      spec.resources.forEach(([x, z], index) => {
        if (id !== 'porch') { resources.push(fruit(group, x, z, index, spec.accent)); return; }
        const lamp = new THREE.Group(); lamp.position.set(x, 0, z); group.add(lamp);
        const metal = new THREE.MeshStandardMaterial({ color: '#635e54', metalness: .7, roughness: .35 });
        mesh(lamp, new THREE.CylinderGeometry(.35, .45, .15, 20), metal, [0, .1, 0]);
        mesh(lamp, new THREE.CylinderGeometry(.1, .1, 1.8, 10), metal, [0, 1, 0]);
        mesh(lamp, new THREE.SphereGeometry(.4, 20, 16),
          new THREE.MeshStandardMaterial({ color: '#ffd492', emissive: '#ffae45', emissiveIntensity: 3 }), [0, 2, 0]);
        const light = new THREE.PointLight('#ffc987', 6, 8); light.position.y = 2; lamp.add(light);
        ring(lamp, 1.1, spec.accent); resources.push(lamp);
      });
      spec.obstacles.forEach(([x, z, radius], index) => {
        if (id === 'picnic') {
          const cup = new THREE.Group(); cup.position.set(x, 0, z); group.add(cup);
          const ceramic = new THREE.MeshStandardMaterial({ color: '#c5c9ba', roughness: .3 });
          mesh(cup, new THREE.CylinderGeometry(radius, radius * .85, 1.4, 24), ceramic, [0, .7, 0]);
          const handle = mesh(cup, new THREE.TorusGeometry(radius * .55, .1, 8, 20), ceramic, [radius, .75, 0]);
          handle.rotation.y = Math.PI / 2;
          return;
        }
        const rock = mesh(group, new THREE.IcosahedronGeometry(radius, 1), stone, [x, radius * .5, z], [1, .8, 1]);
        rock.rotation.set(index * .4, index, .2);
      });
      for (let i = 0; i < 28; i++) {
        const angle = i * 2.399963, r = 7.6 + Math.sin(i * 3.7) * .4;
        const sprig = new THREE.Group(); sprig.position.set(Math.cos(angle) * r, .02, Math.sin(angle) * r);
        sprig.rotation.y = angle; group.add(sprig);
        for (let j = 0; j < 3; j++) {
          const blade = mesh(sprig, new THREE.SphereGeometry(1, 8, 6), leaf,
            [j * .13, .14 + j * .12, 0], [.12, .35 + i % 3 * .1, .025]);
          blade.rotation.z = (j - 1) * .4;
        }
      }
      for (const [x, z, radius] of spec.shelters || []) {
        const canopy = mesh(group, new THREE.SphereGeometry(1, 20, 10), leaf, [x, 1.2, z], [radius, .12, radius * .7]);
        canopy.rotation.z = -.2;
        ring(group, radius, '#bedcbd', .22).position.set(x, .04, z);
      }
      let threat = null;
      if (id === 'spider') threat = spider(group);
      if (id === 'picnic') {
        const swatter = new THREE.Group(); group.add(swatter);
        const plastic = new THREE.MeshStandardMaterial({ color: '#a36356', roughness: .6, transparent: true, opacity: .72 });
        mesh(swatter, new THREE.BoxGeometry(1.4, .07, 1.7), plastic, [0, 1.8, 0]);
        mesh(swatter, new THREE.CylinderGeometry(.06, .06, 3, 8), plastic, [0, 1.8, 2], [1, 1, 1]).rotation.x = Math.PI / 2;
        const shadow = ring(swatter, 3.2, '#f4a58e', .35);
        shadow.position.y = .035;
        for (let i = -3; i <= 3; i++) {
          mesh(swatter, new THREE.BoxGeometry(.025, .02, 1.7), stone, [i * .17, 1.85, 0]);
        }
        threat = { group: swatter, legs: [] };
      }
      let particles = null;
      if (id === 'plume' || id === 'wind' || id === 'porch') {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(160 * 3), 3));
        particles = new THREE.Points(geo, new THREE.PointsMaterial({
          color: spec.accent, size: id === 'plume' ? .11 : .045, transparent: true, opacity: .45, depthWrite: false,
        }));
        group.add(particles);
      }
      this.groups[id] = { group, resources, threat, particles };
    }
    this.cue = ring(habitat.scene, .2, '#b3e9da', .8);
    this.cue.visible = false;
  }

  update(world) {
    const id = world?.id || 'lab';
    if (id !== this.id) {
      for (const [name, entry] of Object.entries(this.groups)) entry.group.visible = name === id;
      const spec = catalogue[id];
      this.habitat.floor.material.map = this.maps[id] || this.labMap;
      this.habitat.floor.material.color.set(id === 'lab' ? '#748e83' : '#ffffff');
      this.habitat.scene.background.set(spec.sky); this.habitat.scene.fog.color.set(spec.sky);
      this.habitat.key.intensity = id === 'porch' ? .55 : 3.7;
      this.habitat.key.color.set(id === 'porch' ? '#a7bbed' : '#f9e4c5');
      this.habitat.rim.intensity = id === 'porch' ? 1.1 : 4;
      this.habitat.ambient.intensity = id === 'porch' ? .65 : 2;
      this.habitat.specimen.group.scale.setScalar(id === 'lab' ? 1 : .72);
      this.id = id;
    }
    this.cue.visible = id !== 'lab';
    if (id === 'lab') return;
    this.cue.position.set(world.cue[0], .04, world.cue[1]);
    const entry = this.groups[id];
    entry.resources.forEach((group, index) => {
      group.scale.setScalar(id !== 'porch' && index < world.visited ? .35 : 1);
    });
    if (entry.threat) {
      const dx = world.threat[0] - entry.threat.group.position.x;
      const dz = world.threat[1] - entry.threat.group.position.z;
      if (id === 'spider' && Math.hypot(dx, dz) > .0001) entry.threat.group.rotation.y = Math.atan2(-dx, -dz);
      entry.threat.group.position.set(world.threat[0], 0, world.threat[1]);
      entry.threat.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(world.time * 5 + i) * .16; });
    }
    if (entry.particles) {
      const position = entry.particles.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        const flow = id === 'wind' ? world.time * .55 + .5 * (1 - Math.cos(world.time * .9))
          : world.time * (id === 'plume' ? .5 : .8);
        const phase = (flow + i * .619) % 13;
        const side = Math.sin(i * 17.1);
        const x = id === 'plume' ? -5 + phase : -7 + phase;
        const z = id === 'plume'
          ? 1 + phase * .12 + .35 * Math.sin(world.time * .7 - phase * .4) + side * (.45 + phase * .14)
          : side * 7;
        position.setXYZ(i, x, .3 + (i % 11) * .11, z);
      }
      position.needsUpdate = true;
    }
  }

  dispose() {
    for (const texture of [this.labMap, ...Object.values(this.maps)]) texture.dispose();
  }
}

export { catalogue };
