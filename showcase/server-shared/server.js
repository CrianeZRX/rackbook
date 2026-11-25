// The server, built from code: chassis tray, bezel and ears, a lid that lifts off, 12 drive caddies, the backplane,
// six fans, two sockets under finned heatsinks, 16 DIMMs, the air shroud, a GPU on its riser, two PSUs and an OCP NIC.
// update(r, ops) poses it for the reading r (kin.js) and the operator's state: how far each subsystem is pulled out,
// which one is in focus (the rest fade back), and whether the airflow is drawn.
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {BACKPLANE_Z, clamp, CPU, DIMM, DRIVE, FAN, GPU, NIC, PSU, S} from './kin.js';

const mm = (v) => v * 0.001;
export const HEAT = new THREE.Color('#ff5a14');
const COOL = new THREE.Color('#5aa9e6');

// every material belongs to one subsystem so the focus can fade the others
export const GROUPS = ['chassis', 'lid', 'drives', 'fans', 'shroud', 'cpu', 'dimm', 'gpu', 'psu', 'nic', 'board'];

export function buildServer() {
  const root = new THREE.Group();
  const mats = Object.fromEntries(GROUPS.map((g) => [g, []]));
  const M = (group, o) => {
    const m = new THREE.MeshStandardMaterial({envMapIntensity: 0.55, transparent: true, opacity: 1, ...o});
    mats[group].push(m);
    return m;
  };
  const box = (w, h, d, mat, x = 0, y = 0, z = 0, parent = root, r = 0) => {
    const g = r ? new RoundedBoxGeometry(mm(w), mm(h), mm(d), 2, mm(r)) : new THREE.BoxGeometry(mm(w), mm(h), mm(d));
    const m = new THREE.Mesh(g, mat);
    m.position.set(mm(x), mm(y), mm(z));
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const group = (parent = root) => {
    const g = new THREE.Group();
    parent.add(g);
    return g;
  };

  // ------------------------------------------------------------ chassis
  const steel = M('chassis', {color: '#c4c8cd', metalness: 0.55, roughness: 0.5});
  const steelDark = M('chassis', {color: '#8d939b', metalness: 0.5, roughness: 0.55});
  const black = M('chassis', {color: '#25272b', metalness: 0.2, roughness: 0.62});
  const chassis = group();
  const W = S.w, H = S.h, D = S.d;
  box(W, S.wall, D, steel, 0, S.wall / 2, 0, chassis);
  box(S.wall, H, D, steel, -W / 2 + S.wall / 2, H / 2, 0, chassis);
  box(S.wall, H, D, steel, W / 2 - S.wall / 2, H / 2, 0, chassis);
  // the fixed top cover over the drive cage (the lid only covers the rear part)
  box(W, S.wall, 168, steel, 0, H - S.wall / 2, S.front - 84, chassis);
  // the front: bezel frame round the drive bays, rack ears with their screws and the control panels
  box(W, 4, 6, black, 0, 2, S.front + 3, chassis);
  box(W, 4, 6, black, 0, H - 2, S.front + 3, chassis);
  for (const s of [-1, 1]) {
    box(24, H, 4, steelDark, s * (W / 2 + 12), H / 2, S.front - 2, chassis);
    box(13, H - 8, 6, black, s * (W / 2 - 6.5), H / 2, S.front + 3, chassis);
    for (const y of [18, H - 18]) {
      const sc = new THREE.Mesh(new THREE.CylinderGeometry(mm(3.4), mm(3.4), mm(2), 18), steel);
      sc.rotation.x = Math.PI / 2;
      sc.position.set(mm(s * (W / 2 + 12)), mm(y), mm(S.front + 0.5));
      chassis.add(sc);
    }
  }
  const power = new THREE.Mesh(new THREE.CylinderGeometry(mm(4), mm(4), mm(3), 20), M('chassis', {color: '#9fd8b8', emissive: '#4fd18a', emissiveIntensity: 0.8}));
  power.rotation.x = Math.PI / 2;
  power.position.set(mm(W / 2 + 12), mm(H / 2), mm(S.front + 1));
  chassis.add(power);
  // the rear wall, below the PSUs, NIC and GPU bracket openings
  box(W, 6, S.wall, steel, 0, 3, S.rear + S.wall / 2, chassis);
  box(110, H - 46, S.wall, steel, -63, 46 + (H - 46) / 2, S.rear + S.wall / 2, chassis);
  box(110, H - 46, S.wall, steel, 63, 46 + (H - 46) / 2, S.rear + S.wall / 2, chassis);
  // rear I/O block: two USB, VGA, the BMC port
  box(36, 14, 10, black, -70, 30, S.rear - 2, chassis);
  box(16, 13, 12, M('chassis', {color: '#3b6fb5', roughness: 0.6}), -40, 30, S.rear - 2, chassis);

  // ------------------------------------------------------------ the motherboard
  const pcb = M('board', {color: '#1d5446', roughness: 0.55, metalness: 0.1});
  const chipMat = M('board', {color: '#2a2c30', roughness: 0.5, metalness: 0.2});
  const chokeMat = M('board', {color: '#6f747b', roughness: 0.45, metalness: 0.6});
  const board = group();
  box(W - 12, 1.6, 300, pcb, 0, S.board - 0.8, -190, board);
  box(W - 12, 1.6, 200, pcb, 0, S.board - 0.8, 60, board);
  // VRM chokes along each socket, the chipset under a small heatsink, the BMC
  for (const cx of CPU.x) {
    for (let k = 0; k < 6; k++) box(8, 7, 8, chokeMat, cx - 30 + k * 12, S.board + 3.5, CPU.z - 72, board);
  }
  box(26, 6, 26, chokeMat, 0, S.board + 3, -120, board);
  box(14, 2, 14, chipMat, -150, S.board + 1, -270, board);
  // the backplane the drives plug into
  box(W - 20, 72, 2, pcb, 0, 44, BACKPLANE_Z, board);

  // ------------------------------------------------------------ drives
  const caddy = M('drives', {color: '#2b2d31', metalness: 0.25, roughness: 0.55});
  const hdd = M('drives', {color: '#9ea4ab', metalness: 0.7, roughness: 0.42});
  const label = M('drives', {color: '#d4d2ca', roughness: 0.85});
  const tab = M('drives', {color: '#e4a93a', roughness: 0.6});
  const drives = [];
  const leds = [];
  for (let r = 0; r < DRIVE.rows; r++) {
    for (let c = 0; c < DRIVE.cols; c++) {
      const g = group();
      const x = (c - (DRIVE.cols - 1) / 2) * DRIVE.pitchX;
      const y = 6 + DRIVE.h / 2 + r * DRIVE.pitchY;
      g.position.set(mm(x), mm(y), 0);
      const z0 = S.front - 4;
      box(DRIVE.w - 2, DRIVE.h - 1.5, DRIVE.d, hdd, 0, 0, z0 - DRIVE.d / 2 - 6, g);
      box(52, 0.4, 44, label, -6, DRIVE.h / 2 - 0.5, z0 - 60, g);
      box(DRIVE.w, DRIVE.h, 9, caddy, 0, 0, z0 - 2, g, 1.2);
      box(26, 6, 3, tab, 30, -4, z0 + 3, g);
      // the honeycomb vents, as dark slots
      for (let k = 0; k < 6; k++) box(5, 12, 1, M('drives', {color: '#111214', roughness: 0.9}), -38 + k * 9, 2, z0 + 2.6, g);
      const led = box(3, 3, 1.5, M('drives', {color: '#3a3d41', emissive: '#37d07a', emissiveIntensity: 0}), 44, 7, z0 + 2.8, g);
      leds.push(led);
      drives.push({g, i: r * DRIVE.cols + c, x, y});
    }
  }

  // ------------------------------------------------------------ fans
  const fanFrame = M('fans', {color: '#232528', roughness: 0.62, metalness: 0.15});
  const blade = M('fans', {color: '#34373c', roughness: 0.5, metalness: 0.1});
  const fanCage = M('fans', {color: '#6c7178', metalness: 0.5, roughness: 0.5});
  const fans = [];
  const fanX = (i) => (i - (FAN.n - 1) / 2) * 66;
  const fanY = 6 + FAN.size / 2 + 6;
  const bracket = group();
  box(W - 10, 4, 64, fanCage, 0, 4, FAN.z, bracket);
  for (let i = 0; i < FAN.n; i++) {
    const g = group(bracket);
    g.position.set(mm(fanX(i)), mm(fanY), mm(FAN.z));
    const sq = new THREE.Shape();
    const h = FAN.size / 2;
    sq.moveTo(mm(-h), mm(-h));
    sq.lineTo(mm(h), mm(-h));
    sq.lineTo(mm(h), mm(h));
    sq.lineTo(mm(-h), mm(h));
    sq.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, mm(28.5), 0, Math.PI * 2, true);
    sq.holes.push(hole);
    const fr = new THREE.Mesh(new THREE.ExtrudeGeometry(sq, {depth: mm(FAN.depth), bevelEnabled: false, curveSegments: 40}), fanFrame);
    fr.position.z = mm(-FAN.depth / 2);
    fr.castShadow = fr.receiveShadow = true;
    g.add(fr);
    const rot = new THREE.Group();
    g.add(rot);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(mm(13), mm(13), mm(30), 28), blade);
    hub.rotation.x = Math.PI / 2;
    rot.add(hub);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(mm(9), 24), M('fans', {color: '#c9ccd1', metalness: 0.6, roughness: 0.4}));
    cap.position.z = mm(15.1);
    rot.add(cap);
    for (let b = 0; b < 7; b++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(mm(15), mm(1.4), mm(20)), blade);
      const piv = new THREE.Group();
      piv.rotation.z = (b / 7) * Math.PI * 2;
      bl.position.x = mm(20);
      bl.rotation.x = 0.62; // the blade's pitch
      bl.castShadow = true;
      piv.add(bl);
      rot.add(piv);
    }
    fans.push({g, rot});
  }

  // ------------------------------------------------------------ sockets and heatsinks
  const socketMat = M('cpu', {color: '#1c1d20', roughness: 0.6});
  const ihsMat = M('cpu', {color: '#c9ccd0', metalness: 0.9, roughness: 0.32, emissive: HEAT, emissiveIntensity: 0});
  const finMat = M('cpu', {color: '#c2c7cd', metalness: 0.75, roughness: 0.45, emissive: HEAT, emissiveIntensity: 0});
  const baseMat = M('cpu', {color: '#b9764c', metalness: 0.85, roughness: 0.38, emissive: HEAT, emissiveIntensity: 0});
  const pipeMat = M('cpu', {color: '#c78a5e', metalness: 0.85, roughness: 0.35});
  const sinks = [];
  const nFin = 34;
  const finGeo = new THREE.BoxGeometry(mm(0.5), mm(CPU.hs.h - 8), mm(CPU.hs.d));
  for (const cx of CPU.x) {
    box(76, 4, 60, socketMat, cx, S.board + 2, CPU.z, board);
    const ihs = box(CPU.ihs, 2.6, 46, ihsMat, cx, S.board + 5.3, CPU.z, board);
    const g = group();
    g.position.set(mm(cx), mm(S.board + 6.6), mm(CPU.z));
    box(CPU.hs.w, 6, CPU.hs.d, baseMat, 0, 3, 0, g);
    const fins = new THREE.InstancedMesh(finGeo, finMat, nFin);
    const m4 = new THREE.Matrix4();
    for (let k = 0; k < nFin; k++) {
      m4.makeTranslation(mm(-CPU.hs.w / 2 + 1 + (k * (CPU.hs.w - 2)) / (nFin - 1)), mm(6 + (CPU.hs.h - 8) / 2), 0);
      fins.setMatrixAt(k, m4);
    }
    fins.castShadow = fins.receiveShadow = true;
    g.add(fins);
    for (let k = 0; k < 4; k++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(mm(3), mm(3), mm(CPU.hs.h - 2), 14), pipeMat);
      p.position.set(mm(-27 + k * 18), mm(CPU.hs.h / 2 + 2), mm(-CPU.hs.d / 2 + 14));
      g.add(p);
    }
    // the four captive screws
    for (const [sx, sz] of [[-38, -48], [38, -48], [-38, 48], [38, 48]]) {
      const sc = new THREE.Mesh(new THREE.CylinderGeometry(mm(3.6), mm(3.6), mm(8), 16), M('cpu', {color: '#2c2e32', metalness: 0.4, roughness: 0.5}));
      sc.position.set(mm(sx), mm(CPU.hs.h - 2), mm(sz));
      g.add(sc);
    }
    sinks.push({g, ihs, cx});
  }

  // ------------------------------------------------------------ DIMMs
  const dimmPcb = M('dimm', {color: '#2f6b3f', roughness: 0.5, metalness: 0.1});
  const dram = M('dimm', {color: '#1a1b1e', roughness: 0.45, metalness: 0.2});
  const slot = M('dimm', {color: '#111214', roughness: 0.7});
  const gold = M('dimm', {color: '#d1a54a', metalness: 0.9, roughness: 0.35});
  const dimms = [];
  for (const cx of CPU.x) {
    for (const side of [-1, 1]) {
      for (let k = 0; k < DIMM.perSide; k++) {
        const x = cx + side * (52 + k * DIMM.pitch);
        box(6, 7, DIMM.len + 10, slot, x, S.board + 3.5, CPU.z, board);
        const g = group();
        g.position.set(mm(x), mm(S.board + 6), mm(CPU.z));
        box(1.2, DIMM.h, DIMM.len, dimmPcb, 0, DIMM.h / 2, 0, g);
        box(1.3, 2.5, DIMM.len - 6, gold, 0, 1.4, 0, g);
        for (const s of [-1, 1]) for (let c = 0; c < 9; c++) box(1, 9, 11, dram, s * 1.1, 17, -DIMM.len / 2 + 9 + c * 14.4, g);
        dimms.push({g, side, k});
      }
    }
  }

  // ------------------------------------------------------------ air shroud
  const shroudMat = M('shroud', {color: '#2a2c30', roughness: 0.7, metalness: 0.05});
  const shroud = group();
  box(W - 14, 2, 200, shroudMat, 0, H - 8, CPU.z, shroud);
  for (const sx of [-1, 1]) box(2, H - 20, 200, shroudMat, sx * (W / 2 - 9), (H - 8) / 2 + 2, CPU.z, shroud);
  box(4, H - 20, 200, shroudMat, 0, (H - 8) / 2 + 2, CPU.z, shroud);

  // ------------------------------------------------------------ GPU on its riser
  const gpuShroud = M('gpu', {color: '#3a3e44', metalness: 0.45, roughness: 0.45});
  const gpuFin = M('gpu', {color: '#aeb4bb', metalness: 0.75, roughness: 0.42, emissive: HEAT, emissiveIntensity: 0});
  const riserMat = M('gpu', {color: '#1d5446', roughness: 0.55});
  const gpuG = group();
  const riser = box(4, 46, 90, riserMat, GPU.x - 64, S.board + 23, GPU.z, gpuG);
  const card = group(gpuG);
  card.position.set(mm(GPU.x), mm(GPU.y + 18), mm(GPU.z));
  box(GPU.h, 2, GPU.len, riserMat, 0, -9, 0, card);
  box(GPU.h, 16, GPU.len - 20, gpuShroud, 0, 0, 8, card, 2.5);
  for (let k = 0; k < 9; k++) box(GPU.h - 14, 1, 40, gpuFin, 0, 8.4, -GPU.len / 2 + 40 + k * 22, card);
  box(GPU.h + 8, 22, 1.5, M('gpu', {color: '#b6bbc2', metalness: 0.7, roughness: 0.4}), 0, 0, -GPU.len / 2 - 2, card);
  box(60, 0.4, 30, M('gpu', {color: '#76b900', roughness: 0.5}), 20, 8.2, 100, card);

  // ------------------------------------------------------------ PSUs
  const psuMat = M('psu', {color: '#80868e', metalness: 0.6, roughness: 0.46});
  const psuFace = M('psu', {color: '#26282b', roughness: 0.6});
  const psus = [];
  for (const px of PSU.x) {
    const g = group();
    g.position.set(mm(px), mm(2 + PSU.h / 2), mm(S.rear + PSU.d / 2 + 1));
    box(PSU.w, PSU.h, PSU.d, psuMat, 0, 0, 0, g, 1.5);
    box(PSU.w, PSU.h, 4, psuFace, 0, 0, -PSU.d / 2 - 1, g);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(mm(14), mm(2.2), 10, 24, Math.PI), psuFace);
    handle.rotation.set(Math.PI / 2, 0, 0);
    handle.position.set(mm(-16), mm(0), mm(-PSU.d / 2 - 3));
    g.add(handle);
    box(14, 10, 3, M('psu', {color: '#101113', roughness: 0.9}), 24, 4, -PSU.d / 2 - 3, g);
    box(3, 3, 1.5, M('psu', {color: '#3a3d41', emissive: '#37d07a', emissiveIntensity: 0.9}), 24, -10, -PSU.d / 2 - 3.6, g);
    psus.push(g);
  }

  // ------------------------------------------------------------ OCP NIC
  const nicG = group();
  nicG.position.set(mm(NIC.x), mm(S.board + 8), mm(S.rear + NIC.d / 2 + 2));
  box(NIC.w, 1.6, NIC.d, M('nic', {color: '#1d5446', roughness: 0.55}), 0, 0, 0, nicG);
  box(18, 6, 18, M('nic', {color: '#6f747b', metalness: 0.6, roughness: 0.45}), 6, 4, 10, nicG);
  box(NIC.w, 16, 2, M('nic', {color: '#b6bbc2', metalness: 0.7, roughness: 0.4}), 0, 6, -NIC.d / 2 - 1, nicG);
  const nicLeds = [];
  for (const s of [-1, 1]) {
    box(19, 10, 40, M('nic', {color: '#c6cacf', metalness: 0.8, roughness: 0.35}), s * 14, 6, -NIC.d / 2 + 18, nicG);
    nicLeds.push(box(2.5, 2.5, 1, M('nic', {color: '#3a3d41', emissive: '#f2a93b', emissiveIntensity: 0}), s * 14 + 7, 12.5, -NIC.d / 2 - 2.6, nicG));
  }

  // ------------------------------------------------------------ the lid
  const lidMat = M('lid', {color: '#cdd0d4', metalness: 0.5, roughness: 0.48});
  const lid = group();
  box(W, S.wall, D - 168, lidMat, 0, H - S.wall / 2, -84, lid);
  box(60, 3, 30, M('lid', {color: '#2b2d31', roughness: 0.55}), 0, H + 1.5, 30, lid, 1);
  // a service label, as a pale panel
  box(170, 0.3, 120, M('lid', {color: '#e8e6df', roughness: 0.85}), 90, H + 0.3, -170, lid);

  // ------------------------------------------------------------ airflow
  const N_AIR = 320;
  const airMat = new THREE.MeshBasicMaterial({transparent: true, opacity: 0, depthWrite: false, vertexColors: false});
  const air = new THREE.InstancedMesh(new THREE.CapsuleGeometry(mm(2.8), mm(18), 2, 6), airMat, N_AIR);
  air.frustumCulled = false;
  const lanes = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N_AIR; i++) lanes.push([(rnd() - 0.5) * (W - 40), 12 + rnd() * 66, rnd() * 700]);
  root.add(air);
  const tmpC = new THREE.Color();
  for (let i = 0; i < N_AIR; i++) air.setColorAt(i, COOL);

  // ------------------------------------------------------------ posing
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const sc = new THREE.Vector3(1, 1, 1);
  const pv = new THREE.Vector3();
  const hash = (a, b) => {
    const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const setOpacity = (focus, ghost) => {
    for (const g of GROUPS) {
      const keep = !focus || focus.includes(g) || g === 'chassis' && ghost < 0.01;
      const o = keep ? 1 : 1 - 0.82 * ghost;
      for (const m of mats[g]) {
        m.opacity = o;
        m.depthWrite = o > 0.6;
      }
    }
  };

  // ops: lid, drives, fans, shroud, hs, dimm, gpu, psu, nic (0..1 how far out), air (0..1), focus [groups], ghost (0..1)
  function update(r, ops = {}) {
    const o = (k) => clamp(ops[k] ?? 0, 0, 1);
    // lid: lifts and slides back, then rises out of the way
    lid.position.set(0, mm(o('lid') * 330), mm(-o('lid') * 430));
    // drives slide out of their bays, staggered by column then row
    for (const d of drives) {
      const k = clamp(o('drives') * 1.6 - (d.i % 4) * 0.12 - Math.floor(d.i / 4) * 0.06, 0, 1);
      d.g.position.z = mm(k * k * (3 - 2 * k) * 170);
    }
    for (let i = 0; i < leds.length; i++) {
      const on = hash(i, Math.floor(r.ioTotal / 30)) < 0.2 + 0.6 * r.L;
      leds[i].material.emissiveIntensity = on ? 0.95 : 0.06;
    }
    // fans: the whole wall lifts; each rotor turns at the integrated angle
    bracket.position.y = mm(o('fans') * 150);
    fans.forEach((f, i) => (f.rot.rotation.z = -(r.fanDeg + i * 23) * (Math.PI / 180)));
    shroud.position.set(0, mm(o('shroud') * 230), mm(-o('shroud') * 400));
    // heatsinks lift off the sockets; the heat shows as a glow from the base up
    const heat = clamp((r.cpuT - 42) / 42, 0, 1);
    for (const s of sinks) s.g.position.y = mm(S.board + 6.6 + o('hs') * 140);
    baseMat.emissiveIntensity = 0.75 * heat;
    finMat.emissiveIntensity = 0.1 * heat;
    ihsMat.emissiveIntensity = 0.55 * heat;
    for (const d of dimms) d.g.position.y = mm(S.board + 6 + o('dimm') * (64 + d.k * 10));
    gpuG.position.y = mm(o('gpu') * 170);
    gpuFin.emissiveIntensity = 0.12 * clamp((r.gpuT - 45) / 35, 0, 1);
    psus.forEach((p, i) => (p.position.z = mm(S.rear + PSU.d / 2 + 1 - o('psu') * (150 + i * 30))));
    nicG.position.z = mm(S.rear + NIC.d / 2 + 2 - o('nic') * 130);
    nicLeds.forEach((l, i) => (l.material.emissiveIntensity = hash(i + 40, Math.floor(r.netTotal * 1.5)) < 0.35 + 0.6 * r.L ? 0.95 : 0.1));
    // airflow: particles stream from the bezel to the rear, warming as they cross the sockets
    const a = o('air');
    airMat.opacity = 0.85 * a;
    air.visible = a > 0.01;
    if (air.visible) {
      for (let i = 0; i < N_AIR; i++) {
        const [x, y, z0] = lanes[i];
        const z = S.front - 30 - ((z0 + r.air) % 660);
        pv.set(mm(x), mm(y), mm(z));
        m4.compose(pv, q, sc);
        air.setMatrixAt(i, m4);
        const w = clamp((60 - z) / 120, 0, 1) * (0.35 + 0.65 * heat);
        air.setColorAt(i, tmpC.copy(COOL).lerp(HEAT, w));
      }
      air.instanceMatrix.needsUpdate = true;
      air.instanceColor.needsUpdate = true;
    }
    setOpacity(ops.focus, ops.ghost ?? 0);
  }

  // anchors for the callouts, in metres (scene space), following the moving parts
  const anchor = (name) => {
    const v = new THREE.Vector3();
    switch (name) {
      case 'cpu0': return sinks[0].g.localToWorld(v.set(0, mm(CPU.hs.h), 0));
      case 'cpu1': return sinks[1].g.localToWorld(v.set(0, mm(CPU.hs.h), 0));
      case 'socket': return v.set(mm(CPU.x[0]), mm(S.board + 6), mm(CPU.z));
      case 'fans': return fans[1].g.localToWorld(v.set(0, mm(30), 0));
      case 'dimm': return dimms[2].g.localToWorld(v.set(0, mm(DIMM.h), 0));
      case 'gpu': return card.localToWorld(v.set(mm(30), mm(10), mm(60)));
      case 'drive': return drives[3].g.localToWorld(v.set(0, mm(DRIVE.h / 2), mm(S.front - 60)));
      case 'psu': return psus[1].localToWorld(v.set(0, mm(PSU.h / 2), mm(-40)));
      case 'nic': return nicG.localToWorld(v.set(mm(14), mm(14), mm(-NIC.d / 2)));
      case 'backplane': return v.set(mm(140), mm(72), mm(BACKPLANE_Z));
      default: return v;
    }
  };
  root.updateMatrixWorld(true);
  return {root, update, anchor, mats};
}
