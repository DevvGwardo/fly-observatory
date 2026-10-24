import * as THREE from 'three';

function ellipsoid(parent, material, position, scale, detail = 40) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, detail, 24), material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function segment(parent, material, a, b, width) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(width * .65, width, 1, 7), material);
  mesh.castShadow = true;
  parent.add(mesh);
  placeSegment(mesh, a, b);
  return mesh;
}

const UP = new THREE.Vector3(0, 1, 0);
function placeSegment(mesh, a, b) {
  const direction = new THREE.Vector3().subVectors(b, a);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.scale.y = direction.length();
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
}

function eyeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4b2518'; ctx.fillRect(0, 0, 512, 256);
  const r = 8;
  for (let row = -1; row < 22; row++) {
    for (let col = -1; col < 40; col++) {
      const x = col * r * 1.73 + (row % 2 ? r * .86 : 0);
      const y = row * r * 1.5;
      const brightness = .5 + .5 * Math.sin(row * 2.17 + col * 1.41);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3 + Math.PI / 6;
        ctx.lineTo(x + Math.cos(angle) * (r - .6), y + Math.sin(angle) * (r - .6));
      }
      ctx.closePath();
      ctx.fillStyle = `rgb(${125 + brightness * 45},${55 + brightness * 28},${28 + brightness * 18})`;
      ctx.fill();
      ctx.strokeStyle = '#382119'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#e7bb8266'; ctx.fillRect(x - 2, y - 3, 2, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

function wing(parent, sign) {
  const group = new THREE.Group();
  group.position.set(sign * .26, .78, .03);
  group.rotation.set(-.05, sign * -.26, sign * -.1);
  parent.add(group);
  const outline = new THREE.Shape();
  outline.moveTo(0, 0);
  outline.bezierCurveTo(sign * .55, -.15, sign * 1.05, -1.48, sign * .8, -2.0);
  outline.bezierCurveTo(sign * .5, -2.37, sign * .02, -1.3, 0, 0);
  const geo = new THREE.ShapeGeometry(outline, 48);
  geo.rotateX(Math.PI / 2);
  const material = new THREE.MeshPhysicalMaterial({
    color: '#a9c8b6', roughness: .18, metalness: .04,
    transparent: true, opacity: .28, side: THREE.DoubleSide,
    clearcoat: 1, clearcoatRoughness: .1, depthWrite: false,
  });
  const surface = new THREE.Mesh(geo, material);
  surface.renderOrder = 2;
  group.add(surface);
  const veins = [];
  const lines = [
    [[0, 0], [sign * .75, -1.93]],
    [[0, 0], [sign * .62, -1.3], [sign * .7, -2.08]],
    [[0, 0], [sign * .26, -.85], [sign * .51, -1.89]],
    [[sign * .2, -.52], [sign * .51, -.58]],
    [[sign * .26, -.85], [sign * .59, -.94]],
    [[sign * .44, -1.57], [sign * .77, -1.5]],
  ];
  for (const points of lines) {
    for (let i = 0; i < points.length - 1; i++) {
      veins.push(points[i][0], .004, points[i][1], points[i + 1][0], .004, points[i + 1][1]);
    }
  }
  // Outline follows the same physical plane as the membrane.
  const curvePoints = outline.getPoints(64).map(p => new THREE.Vector3(p.x, .004, p.y));
  const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curvePoints),
    new THREE.LineBasicMaterial({ color: '#96b19c', transparent: true, opacity: .55 }));
  group.add(edge);
  const veinGeo = new THREE.BufferGeometry();
  veinGeo.setAttribute('position', new THREE.Float32BufferAttribute(veins, 3));
  group.add(new THREE.LineSegments(veinGeo, new THREE.LineBasicMaterial({ color: '#93aa8d', transparent: true, opacity: .52 })));
  return group;
}

export function createSpecimen() {
  const fly = new THREE.Group();
  const shell = new THREE.MeshPhysicalMaterial({
    color: '#413b28', roughness: .43, metalness: .32,
    clearcoat: .8, clearcoatRoughness: .28,
  });
  const dark = new THREE.MeshStandardMaterial({ color: '#252a22', roughness: .53, metalness: .25 });
  const abdomenMaterial = new THREE.MeshPhysicalMaterial({ color: '#716345', roughness: .46, metalness: .24, clearcoat: .55 });
  const amber = new THREE.MeshStandardMaterial({ color: '#c9975d', roughness: .37, metalness: .25 });
  const eyes = new THREE.MeshPhysicalMaterial({
    map: eyeTexture(), roughness: .3, metalness: .13, clearcoat: 1, clearcoatRoughness: .13,
  });
  ellipsoid(fly, shell, [0, .64, .12], [.44, .44, .62]);
  ellipsoid(fly, dark, [0, .77, .1], [.32, .23, .42]);
  ellipsoid(fly, abdomenMaterial, [0, .54, -.85], [.42, .34, .81]);
  // Dark cuticular segment bands follow the taper of the abdomen.
  for (let i = 0; i < 5; i++) {
    const z = -.4 - i * .23;
    const t = (z + .85) / .81;
    const radius = Math.sqrt(Math.max(0, 1 - t * t));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.415 * radius, .019, 5, 48), dark);
    ring.position.set(0, .54, z);
    ring.scale.y = .8;
    fly.add(ring);
  }
  ellipsoid(fly, dark, [0, .7, .87], [.47, .36, .34]);
  ellipsoid(fly, eyes, [-.36, .74, 1.0], [.29, .34, .29]);
  ellipsoid(fly, eyes, [.36, .74, 1.0], [.29, .34, .29]);
  ellipsoid(fly, amber, [0, .48, 1.19], [.1, .11, .17], 16);
  for (const sign of [-1, 1]) {
    ellipsoid(fly, shell, [sign * .16, .88, 1.18], [.095, .065, .19], 18);
    const a = new THREE.Vector3(sign * .16, .95, 1.24);
    const b = new THREE.Vector3(sign * .35, 1.3, 1.35);
    segment(fly, dark, a, b, .012);
    for (let i = 0; i < 5; i++) {
      const anchor = a.clone().lerp(b, .28 + i * .13);
      segment(fly, dark, anchor, anchor.clone().add(new THREE.Vector3(sign * .12, .03, .04)), .005);
    }
    // Halteres, the small balancing organs behind the wings.
    segment(fly, amber, new THREE.Vector3(sign * .3, .59, -.34), new THREE.Vector3(sign * .69, .65, -.46), .015);
    ellipsoid(fly, amber, [sign * .69, .65, -.46], [.065, .065, .07], 14);
  }
  const wings = [wing(fly, -1), wing(fly, 1)];
  const legs = [];
  for (const sign of [-1, 1]) {
    for (let index = 0; index < 3; index++) {
      const z = .46 - index * .46;
      const anchor = new THREE.Vector3(sign * .3, .47, z);
      const knee = new THREE.Vector3(sign * .78, .65, z + (.25 - index * .22));
      const ankle = new THREE.Vector3(sign * 1.04, .07, z + (.6 - index * .45));
      const foot = new THREE.Vector3(sign * 1.18, .01, z + (.75 - index * .5));
      const meshes = [
        segment(fly, shell, anchor, knee, .04),
        segment(fly, dark, knee, ankle, .025),
        segment(fly, dark, ankle, foot, .012),
      ];
      const joint = ellipsoid(fly, dark, knee.toArray(), [.046, .046, .046], 12);
      legs.push({ sign, index, anchor, knee, ankle, foot, meshes, joint });
    }
  }
  // Deterministic macro bristles catch the rim light, without heavy textures.
  const bristles = [];
  let seed = 1717;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 170; i++) {
    const angle = random() * Math.PI * 2;
    const h = random() * 1.7 - .85;
    const radius = Math.sqrt(1 - h * h);
    const p = new THREE.Vector3(Math.cos(angle) * radius * .43, .64 + Math.sin(angle) * radius * .44, .12 + h * .62);
    const outward = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, h).multiplyScalar(.08 + random() * .06);
    bristles.push(...p.toArray(), ...p.clone().add(outward).toArray());
  }
  const bristleGeo = new THREE.BufferGeometry();
  bristleGeo.setAttribute('position', new THREE.Float32BufferAttribute(bristles, 3));
  fly.add(new THREE.LineSegments(bristleGeo, new THREE.LineBasicMaterial({ color: '#b2ad8e', transparent: true, opacity: .55 })));
  fly.scale.setScalar(.78);
  return {
    group: fly,
    animate(time, moving, turn) {
      const gait = moving ? time * 12 : 0;
      for (const leg of legs) {
        const phase = gait + leg.index * Math.PI + (leg.sign === 1 ? Math.PI : 0);
        const swing = moving ? Math.sin(phase) * .18 : 0;
        const lift = moving ? Math.max(0, Math.cos(phase)) * .13 : 0;
        const knee = leg.knee.clone(); knee.z += swing * .3;
        const ankle = leg.ankle.clone(); ankle.z += swing; ankle.y += lift;
        const foot = leg.foot.clone(); foot.z += swing; foot.y += lift;
        placeSegment(leg.meshes[0], leg.anchor, knee);
        placeSegment(leg.meshes[1], knee, ankle);
        placeSegment(leg.meshes[2], ankle, foot);
        leg.joint.position.copy(knee);
      }
      // Walking showcase: wings remain folded. Motion is illustrative, not neural kinematics.
      wings[0].rotation.z = .1 + Math.abs(turn) * .025;
      wings[1].rotation.z = -.1 - Math.abs(turn) * .025;
    },
  };
}
