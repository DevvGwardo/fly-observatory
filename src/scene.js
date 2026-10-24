import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createSpecimen } from './specimen.js';
import { approachAngle, clampTarget } from './math.js';
import { FieldStage } from './worlds.js';

const CYAN = new THREE.Color('#8cddcd');
const AMBER = new THREE.Color('#edb973');
const Vignette = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `uniform sampler2D tDiffuse;uniform float time;varying vec2 vUv;
    void main(){vec4 c=texture2D(tDiffuse,vUv);vec2 p=vUv-.5;
      float grain=fract(sin(dot(vUv+time,vec2(12.9898,78.233)))*43758.5453)-.5;
      c.rgb*=1.-dot(p,p)*.6;c.rgb+=grain*.012;gl_FragColor=c;}`,
};

function floorTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const c = canvas.getContext('2d');
  c.fillStyle = '#344b4b'; c.fillRect(0, 0, 1024, 1024);
  // Deterministic fine mineral texture.
  let seed = 97;
  for (let i = 0; i < 28000; i++) {
    seed = (seed * 16807) % 2147483647; const x = seed % 1024;
    seed = (seed * 16807) % 2147483647; const y = seed % 1024;
    c.fillStyle = i % 3 === 0 ? '#62747433' : '#112f3038';
    c.fillRect(x, y, 2, 2);
  }
  c.strokeStyle = '#abc5b92b'; c.lineWidth = 1;
  for (let r = 64; r < 512; r += 64) { c.beginPath(); c.arc(512, 512, r, 0, Math.PI * 2); c.stroke(); }
  for (let i = 0; i < 32; i++) {
    const a = i * Math.PI / 16;
    c.beginPath(); c.moveTo(512 + Math.cos(a) * 462, 512 + Math.sin(a) * 462);
    c.lineTo(512 + Math.cos(a) * 493, 512 + Math.sin(a) * 493); c.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function haloTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, '#000000aa'); g.addColorStop(.45, '#00000055'); g.addColorStop(1, '#00000000');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function circleLine(radius, color, opacity = .5, y = .025) {
  const points = [];
  for (let i = 0; i <= 160; i++) {
    const a = i / 160 * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

function buildHabitat() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a151a');
  scene.fog = new THREE.FogExp2('#0a151a', .018);
  const ambient = new THREE.HemisphereLight('#b0e0d4', '#182828', 2.0);
  scene.add(ambient);
  const key = new THREE.DirectionalLight('#f9e4c5', 3.7);
  key.position.set(3, 12, 5); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -11; key.shadow.camera.right = 11;
  key.shadow.camera.top = 11; key.shadow.camera.bottom = -11;
  key.shadow.normalBias = .045; key.shadow.bias = -.00008; key.shadow.radius = 3;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#91d5c8', 4); rim.position.set(-6, 5, -7); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.12, .48, 128),
    new THREE.MeshStandardMaterial({ color: '#748e83', map: floorTexture(), roughness: .89, metalness: .18 }));
  floor.position.y = -.25; floor.receiveShadow = true; scene.add(floor);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(9.16, 8.9, .6, 128),
    new THREE.MeshStandardMaterial({ color: '#172b2e', metalness: .65, roughness: .4 }));
  base.position.y = -.78; scene.add(base);
  for (const radius of [9.12, 9.18]) scene.add(circleLine(radius, '#88c9b9', .36, -.25));
  scene.add(circleLine(8.65, '#adc8ae', .24));
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({ color: '#102329', roughness: .86 }));
  outside.rotation.x = -Math.PI / 2; outside.position.y = -1.11; outside.receiveShadow = true; scene.add(outside);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(9.22, 9.22, .8, 128, 1, true),
    new THREE.MeshPhysicalMaterial({ color: '#91d8c6', transparent: true, opacity: .075,
      roughness: .05, metalness: .15, side: THREE.DoubleSide, depthWrite: false }));
  glass.position.y = .25; scene.add(glass);
  scene.add(circleLine(9.22, '#97d1c2', .23, .65));
  // Small botanical fragments provide scale, leaving the control arena clear.
  const pebbleMat = new THREE.MeshStandardMaterial({ color: '#384b41', roughness: .9 });
  const pebble = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), pebbleMat, 65);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 65; i++) {
    const angle = i * 2.399963;
    const r = 7.9 + Math.sin(i * 17.7) * .45;
    dummy.position.set(Math.cos(angle) * r, .025, Math.sin(angle) * r);
    const size = .08 + (i % 5) * .026;
    dummy.scale.set(size * 1.7, size, size * .9);
    dummy.rotation.set(i, i * .8, i * .2); dummy.updateMatrix(); pebble.setMatrixAt(i, dummy.matrix);
  }
  pebble.castShadow = true; scene.add(pebble);
  const botanical = new THREE.Group();
  const leafMat = new THREE.MeshStandardMaterial({ color: '#4b6550', roughness: .74, side: THREE.DoubleSide });
  const stemMat = new THREE.MeshStandardMaterial({ color: '#596142', roughness: .7 });
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.399963;
    const stem = new THREE.Group(); stem.position.set(Math.cos(angle) * 7.8, 0, Math.sin(angle) * 7.8);
    stem.rotation.y = angle;
    const height = .35 + (i % 3) * .15;
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(.012, .02, height, 5), stemMat);
    stalk.position.y = height / 2; stalk.rotation.z = .24; stem.add(stalk);
    for (let j = 0; j < 6; j++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), leafMat);
      leaf.scale.set(.14, .018, .07);
      leaf.position.set((j % 2 ? -1 : 1) * .12 - j * .015, .05 + j * height / 7, 0);
      leaf.rotation.z = (j % 2 ? -1 : 1) * -.4;
      stem.add(leaf);
    }
    botanical.add(stem);
  }
  scene.add(botanical);
  const specimen = createSpecimen(); scene.add(specimen.group);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 3.5),
    new THREE.MeshBasicMaterial({ map: haloTexture(), transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = .015; scene.add(contact);
  const beacon = new THREE.Group();
  const targetRing = circleLine(.48, '#eebd7a', .85); beacon.add(targetRing);
  const core = new THREE.Mesh(new THREE.SphereGeometry(.07, 20, 12),
    new THREE.MeshStandardMaterial({ color: '#f5d297', emissive: '#ffc379', emissiveIntensity: 3 }));
  core.position.y = .13; beacon.add(core);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(.015, .16, 1.4, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: '#edb973', transparent: true, opacity: .12, side: THREE.DoubleSide, depthWrite: false }));
  pillar.position.y = .7; beacon.add(pillar);
  const targetLight = new THREE.PointLight('#ffcf8c', 2.5, 5, 2);
  targetLight.position.y = .6; beacon.add(targetLight);
  scene.add(beacon);
  const trailGeo = new THREE.BufferGeometry();
  const trailBuffer = new Float32Array(720 * 3);
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailBuffer, 3));
  trailGeo.setDrawRange(0, 0);
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: '#92d0bf', transparent: true, opacity: .26 }));
  scene.add(trail);
  return { scene, floor, key, rim, ambient, specimen, beacon, contact, trailGeo, trailBuffer, trailPoints: [], lastSeq: -1 };
}

function buildBrain() {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#0a151a');
  const group = new THREE.Group(); scene.add(group);
  const guide = circleLine(4.4, '#557d79', .25, -4.3); scene.add(guide);
  const axes = new THREE.Group();
  for (const x of [-4, 4]) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, -4, 0), new THREE.Vector3(x, 3, 0),
    ]);
    axes.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#4e716d', transparent: true, opacity: .2 })));
  }
  scene.add(axes);
  return { scene, group, hot: null, points: null, size: 0 };
}

export class Exhibit {
  constructor(container, onTarget) {
    this.container = container;
    this.onTarget = onTarget;
    this.view = 'habitat';
    this.frame = null;
    this.live = false;
    this.broadcast = null;
    this.directedPosition = new THREE.Vector3();
    this.directedTarget = new THREE.Vector3();
    this.geometryLoaded = false;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.habitat = buildHabitat();
    this.fieldStage = new FieldStage(this.habitat);
    this.brain = buildBrain();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(39, 1, .1, 120);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.dampingFactor = .075;
    this.controls.maxPolarAngle = Math.PI / 2 - .03;
    this.controls.minDistance = 5; this.controls.maxDistance = 35;
    this.controls.enablePan = false;
    this.resetCamera();
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.habitat.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(800, 600), .24, .45, .86);
    this.composer.addPass(this.bloom);
    this.vignette = new ShaderPass(Vignette); this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());
    this.raycaster = new THREE.Raycaster();
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.pointerStart = null;
    container.addEventListener('pointerdown', e => { this.pointerStart = [e.clientX, e.clientY]; });
    container.addEventListener('pointerup', e => {
      if (this.broadcast?.enabled || this.frame?.scenario?.id !== 'lab' || this.view === 'brain' || !this.pointerStart || !this.frame || this.frame.paused) return;
      if (Math.hypot(e.clientX - this.pointerStart[0], e.clientY - this.pointerStart[1]) > 5) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2(
        (e.clientX - rect.left) / rect.width * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
      const point = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.floorPlane, point) && Math.hypot(point.x, point.z) <= 8) {
        onTarget(clampTarget(point.x, point.z));
      }
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.clock = new THREE.Clock();
    this.renderCount = 0;
    this.lastRenderTime = 0;
    this.lastFrameAt = 0;
    this.start();
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.zoom = this.view === 'habitat' ? Math.min(1, this.camera.aspect / 1.2) : 1;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  resetCamera() {
    if (this.view === 'brain') {
      this.camera.position.set(1, 1.5, 12.5);
      this.controls.target.set(0, -.3, 0);
      this.controls.minDistance = 3;
    } else if (this.view === 'macro') {
      const pos = this.habitat.specimen.group.position;
      this.camera.position.set(pos.x + 3.4, 2.9, pos.z + 4.1);
      this.controls.target.set(pos.x, .45, pos.z);
      this.controls.minDistance = 2.5;
    } else {
      this.camera.position.set(9, 17, 15);
      this.controls.target.set(0, 0, 0);
      this.controls.minDistance = 5;
    }
    this.controls.update();
  }

  setView(view) {
    this.view = view;
    this.renderPass.scene = view === 'brain' ? this.brain.scene : this.habitat.scene;
    this.bloom.strength = view === 'brain' ? .2 : .24;
    this.resetCamera();
    this.resize();
  }

  setLive(live) { this.live = live; }

  setBroadcast(state) {
    this.broadcast = state;
    this.controls.enabled = !state?.enabled;
    this.controls.enableDamping = !state?.enabled && !this.reducedMotion;
  }

  directCamera(delta, frame) {
    const t = this.reducedMotion ? 0 : frame.broadcast.phase_elapsed;
    const p = this.directedPosition, target = this.directedTarget;
    if (this.view === 'macro') {
      const pos = this.habitat.specimen.group.position, angle = .7 + t * .09;
      p.set(pos.x + Math.cos(angle) * 4.8, 2.6 + Math.sin(t * .08) * .3, pos.z + Math.sin(angle) * 4.8);
      target.set(pos.x, .45, pos.z);
    } else if (this.view === 'brain') {
      const angle = -.08 + t * .018;
      p.set(Math.sin(angle) * 14.5, .8, Math.cos(angle) * 14.5);
      target.set(0, this.broadcastLayout ? -1.5 : -.3, 0);
    } else {
      const angle = .65 + Math.sin(t * .13) * .16;
      const field = frame.scenario?.id && frame.scenario.id !== 'lab';
      const focus = field && !this.reducedMotion
        ? Math.sin(Math.PI * Math.min(1, t / frame.broadcast.phase_duration))**2 : 0;
      const radius = 18.3 - focus * 5;
      const pos = this.habitat.specimen.group.position;
      target.set(pos.x * focus * .35, 0, pos.z * focus * .35);
      p.set(target.x + Math.sin(angle) * radius, 17.8 - focus * 5, target.z + Math.cos(angle) * radius);
    }
    const mix = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 3);
    this.camera.position.lerp(p, mix);
    this.controls.target.lerp(target, mix);
    this.camera.lookAt(this.controls.target);
  }

  setGeometry(data) {
    if (this.geometryLoaded) return;
    const count = data.positions.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.brain.hot = new Float32Array(count);
    this.brain.size = count;
    for (let i = 0; i < count; i++) {
      const p = data.positions[i];
      // Recorded Z runs along the ventral cord; map it to the vertical axis.
      positions.set([p[0], -p[2], p[1]], i * 3);
      const color = data.side[i] === 0 ? CYAN : new THREE.Color('#c1ab80');
      colors.set(color.toArray(), i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('baseColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('activity', new THREE.BufferAttribute(this.brain.hot, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      uniforms: { pixelRatio: { value: Math.min(devicePixelRatio, 1.8) } },
      vertexShader: `attribute vec3 baseColor;attribute float activity;
        varying vec3 vColor;varying float vActivity;uniform float pixelRatio;
        void main(){vColor=baseColor;vActivity=activity;vec4 p=modelViewMatrix*vec4(position,1.);
          gl_PointSize=clamp((1.5+activity*1.5)*pixelRatio*10./(-p.z),1.,7.);
          gl_Position=projectionMatrix*p;}`,
      fragmentShader: `varying vec3 vColor;varying float vActivity;
        void main(){float r=length(gl_PointCoord-.5);if(r>.5)discard;
          float glow=pow(1.-r*2.,1.35);vec3 c=mix(vColor,vec3(1.,.77,.43),vActivity);
          gl_FragColor=vec4(c*(.6+vActivity*.45),glow*(.55+vActivity*.35));}`,
    });
    this.brain.points = new THREE.Points(geo, mat);
    this.brain.group.add(this.brain.points);
    this.brain.group.rotation.y = -.12;
    this.geometryLoaded = true;
  }

  update(frame) {
    const previous = this.frame;
    this.walking = previous && !frame.paused
      && Math.hypot(frame.body[0] - previous.body[0], frame.body[1] - previous.body[1]) > .00001;
    this.frame = frame;
    this.live = true;
    this.lastFrameAt = performance.now();
    const h = this.habitat;
    const phaseKey = frame.broadcast?.enabled ? `${frame.broadcast.cycle}:${frame.broadcast.phase}` : null;
    const changedWorld = previous && (previous.scenario?.id !== frame.scenario?.id
      || frame.scenario?.time < previous.scenario?.time);
    if (!previous || changedWorld || frame.seq < h.lastSeq || phaseKey !== this.phaseKey && frame.broadcast?.trial_reset) {
      h.trailPoints = [];
      h.specimen.group.position.set(frame.body[0], 0, frame.body[1]);
      h.specimen.group.rotation.y = Math.PI / 2 - frame.body[2];
    }
    this.phaseKey = phaseKey;
    if (frame.seq !== h.lastSeq) {
      h.trailPoints.push([frame.body[0], .025, frame.body[1]]);
      if (h.trailPoints.length > 720) h.trailPoints.shift();
      h.trailBuffer.fill(0);
      h.trailPoints.forEach((p, i) => h.trailBuffer.set(p, i * 3));
      h.trailGeo.attributes.position.needsUpdate = true;
      h.trailGeo.setDrawRange(0, h.trailPoints.length);
      h.lastSeq = frame.seq;
    }
    if (this.brain.hot && !frame.paused) {
      if (frame.muted) this.brain.hot.fill(0);
      else for (const index of frame.hot) if (index < this.brain.size) this.brain.hot[index] = 1;
      this.brain.points.geometry.attributes.activity.needsUpdate = true;
    }
  }

  start() {
    const draw = () => {
      this.animationId = requestAnimationFrame(draw);
      if (document.hidden || this.renderer.getContext().isContextLost()) return;
      const now = performance.now();
      if (now - this.lastRenderTime < 1000 / (this.reducedMotion ? 24 : this.broadcastLayout ? 30 : 60)) return;
      const delta = Math.min((now - this.lastRenderTime) / 1000, .1);
      this.lastRenderTime = now;
      this.controls.update();
      const frame = this.frame;
      if (frame && this.live && now - this.lastFrameAt < 3000) {
        const h = this.habitat;
        const mix = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 18);
        h.specimen.group.position.x = THREE.MathUtils.lerp(h.specimen.group.position.x, frame.body[0], mix);
        h.specimen.group.position.z = THREE.MathUtils.lerp(h.specimen.group.position.z, frame.body[1], mix);
        h.specimen.group.rotation.y = approachAngle(h.specimen.group.rotation.y, Math.PI / 2 - frame.body[2], mix);
        h.contact.position.x = h.specimen.group.position.x;
        h.contact.position.z = h.specimen.group.position.z;
        if (this.view === 'macro' && !this.broadcast?.enabled) {
          const desired = new THREE.Vector3(h.specimen.group.position.x, .45, h.specimen.group.position.z);
          const shift = desired.sub(this.controls.target).multiplyScalar(mix);
          this.camera.position.add(shift);
          this.controls.target.add(shift);
        }
        h.beacon.position.set(frame.target[0], 0, frame.target[1]);
        h.beacon.visible = frame.scenario?.id !== 'spider';
        this.fieldStage.update(frame.scenario);
        h.specimen.animate(frame.sim_time, Boolean(this.walking), frame.command);
        if (this.broadcast?.enabled && !frame.paused) this.directCamera(delta, frame);
        if (this.brain.hot && !frame.paused) {
          const decay = Math.exp(-delta * 7);
          for (let i = 0; i < this.brain.size; i++) this.brain.hot[i] *= decay;
          this.brain.points.geometry.attributes.activity.needsUpdate = true;
        }
      }
      this.vignette.uniforms.time.value = this.reducedMotion ? 0 : this.clock.getElapsedTime() * .001;
      this.composer.render();
      this.renderCount++;
    };
    draw();
  }

  dispose() {
    cancelAnimationFrame(this.animationId);
    this.observer.disconnect();
    this.controls.dispose();
    this.composer.dispose();
    this.fieldStage.dispose();
    for (const scene of [this.habitat.scene, this.brain.scene]) {
      scene.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
          material.dispose();
        }
      });
    }
    this.renderer.dispose();
  }
}
