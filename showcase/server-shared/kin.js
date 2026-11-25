// The server's numbers. A 2U, two-socket rack server laid out like the common 12-bay machines (Dell R750, HPE DL380
// class): real outside dimensions, real part sizes, and one input, the workload L (0..1), from which every reading on
// the console and every moving part is computed. The power and thermal figures are an illustrative model built from
// the parts' published ratings (named next to each); they are shaped like a real machine, not measured from one.
// No three.js in here: all lengths in millimetres, x across (left -), y up, z toward the front bezel (+).

export const S = {
  w: 434, h: 86.8, d: 700, // 2U chassis body (19" rack, without ears): 2 × 44.45 mm less clearance
  wall: 1.2,
  front: 350, // z of the bezel
  rear: -350,
  board: 6, // y of the motherboard top
};

// 12 × 3.5" LFF bays in 3 rows of 4. A 3.5" drive is 101.6 × 26.1 × 147 mm; the caddy adds a front and rails.
export const DRIVE = {w: 101.6, h: 26.1, d: 147, cols: 4, rows: 3, pitchX: 104, pitchY: 27.4};
export const BACKPLANE_Z = S.front - 172;
// six 60 × 60 × 56 mm hot-swap fans (the "6056" size) in a wall behind the backplane
export const FAN = {n: 6, size: 60, depth: 56, z: 122, rpmMin: 4200, rpmMax: 16800, cfmMax: 42, wMax: 22};
// two sockets side by side; a 2U heatsink is about 90 × 64 mm with 110 mm of fins along the airflow
export const CPU = {x: [-104, 104], z: -10, hs: {w: 90, h: 64, d: 110}, ihs: 56, name: '32-core · 205 W TDP', tdp: 205, idle: 40, cores: 32};
// eight DIMM slots each side of each socket would be 32; this one has 16 populated, 4 per side, 32 GB DDR4-3200
// a DIMM stands 31.25 mm tall and 133.35 mm long, slot pitch 7.6 mm
export const DIMM = {len: 133.35, h: 31.25, t: 4, pitch: 7.6, perSide: 4, gb: 32, wIdle: 2, wLoad: 4.5};
// one single-slot, full-height full-length GPU on the rear riser (the 150 W class: 267 × 111 mm)
export const GPU = {len: 267, h: 111, t: 20, x: 0, y: 34, z: -205, tdp: 150, idle: 30, mem: 24};
// two 1400 W Platinum PSUs at the rear corners: 86 × 40 × 185 mm
export const PSU = {w: 86, h: 40, d: 185, x: [-166, 166], watts: 1400, eff: 0.94};
// an OCP 3.0 NIC with two 25 GbE SFP28 ports
export const NIC = {w: 76, h: 11.5, d: 115, x: 0, ports: 2, gbps: 25};

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smoother = (x) => {
  const u = clamp(x, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
};
export const ss = (a, b, t) => smoother((t - a) / (b - a));

// ---------------------------------------------------------------- the steady-state model for a workload L
// CPU package power rises a little faster than linearly at low load (turbo), flattening at TDP.
export const cpuWatts = (L) => CPU.idle + (CPU.tdp - CPU.idle) * Math.pow(clamp(L, 0, 1), 0.85);
export const gpuWatts = (L) => GPU.idle + (GPU.tdp - GPU.idle) * clamp(L, 0, 1);
export const memWatts = (L) => 16 * (DIMM.wIdle + (DIMM.wLoad - DIMM.wIdle) * L);
export const diskWatts = (L) => 12 * (5 + 3 * L); // 7,200 rpm SATA: ~5 W idle, ~8 W seeking
export const fanWatts = (rpm) => FAN.n * FAN.wMax * Math.pow(rpm / FAN.rpmMax, 3); // fan laws: power ∝ speed³
const BOARD = 58; // chipset, BMC, VRM losses, NIC
// heat the fans must carry away, then the airflow that keeps a 20 °F (11 K) rise front to back:
// CFM = 3.16 × W / ΔT(°F), the standard sizing rule for forced-air electronics cooling
export const heatWatts = (L) => 2 * cpuWatts(L) + gpuWatts(L) + memWatts(L) + diskWatts(L) + BOARD;
export const rpmFor = (L) => {
  const cfm = (3.16 * heatWatts(L)) / 20;
  return clamp((cfm / FAN.n / FAN.cfmMax) * FAN.rpmMax, FAN.rpmMin, FAN.rpmMax);
};
// a CPU heatsink's resistance (case to air) falls with airflow: ~0.19 K/W at full fan speed, ~0.36 K/W at idle speed
export const rHeatsink = (rpm) => 0.19 * Math.pow(FAN.rpmMax / rpm, 0.45);
export const INLET = 24; // °C cold aisle

// ---------------------------------------------------------------- integrating over time
// Thermal mass makes temperatures and the fan controller lag the load: first-order responses, integrated once at
// load into tables, so any frame reads them as a pure function of t. loadAt is the film's or the page's workload.
export function integrate(loadAt, duration, dt = 1 / 240, play = 200) {
  const n = Math.ceil(duration / dt) + 2;
  const T = {dt, rpm: new Float32Array(n), cpuT: new Float32Array(n), gpuT: new Float32Array(n), fan: new Float32Array(n), air: new Float32Array(n), io: new Float32Array(n), net: new Float32Array(n)};
  let L0 = loadAt(0);
  let rpm = rpmFor(L0);
  let cT = INLET + cpuWatts(L0) * rHeatsink(rpm);
  let gT = INLET + 6 + gpuWatts(L0) * 0.22;
  let fan = 0;
  let air = 0;
  let io = 0;
  let net = 0;
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const L = loadAt(t);
    rpm += (rpmFor(L) - rpm) * (dt / 2.2); // the BMC's fan loop: ~2 s
    cT += (INLET + cpuWatts(L) * rHeatsink(rpm) - cT) * (dt / 3.0); // heatsink mass: ~3 s
    gT += (INLET + 6 + gpuWatts(L) * 0.22 * Math.pow(FAN.rpmMax / rpm, 0.25) - gT) * (dt / 4.0);
    fan += ((rpm / 60) * 360 * dt) / play; // degrees of fan rotation, shown at 1/play speed
    air += ((rpm / FAN.rpmMax) * 520 + 40) * dt; // mm of particle travel on screen
    io += (40 + 1400 * L) * dt; // MB moved
    net += (1.5 + 21 * L) * dt; // Gb moved
    T.rpm[i] = rpm;
    T.cpuT[i] = cT;
    T.gpuT[i] = gT;
    T.fan[i] = fan;
    T.air[i] = air;
    T.io[i] = io;
    T.net[i] = net;
  }
  const at = (arr, t) => {
    const u = clamp(t / dt, 0, n - 2);
    const i = Math.floor(u);
    return arr[i] + (arr[i + 1] - arr[i]) * (u - i);
  };
  return {
    T,
    // every reading the console shows, for time t
    read(t) {
      const L = loadAt(t);
      const r = at(T.rpm, t);
      const cpu = cpuWatts(L);
      const gpu = gpuWatts(L);
      const dc = 2 * cpu + gpu + memWatts(L) + diskWatts(L) + BOARD + fanWatts(r);
      return {
        L,
        rpm: r,
        cpuW: cpu,
        cpuT: at(T.cpuT, t),
        cpuT1: at(T.cpuT, t) - 2.4, // socket 1 sits in socket 0's wake… a little cooler here, the shroud splits the flow
        gpuW: gpu,
        gpuT: at(T.gpuT, t),
        gpuU: clamp(L * 1.05, 0, 1),
        memGB: 96 + 340 * L,
        diskMB: 40 + 1400 * L,
        netGb: 1.5 + 21 * L,
        fanW: fanWatts(r),
        dc,
        wall: dc / PSU.eff,
        cfm: (r / FAN.rpmMax) * FAN.cfmMax * FAN.n,
        fanDeg: at(T.fan, t),
        air: at(T.air, t),
        ioTotal: at(T.io, t),
        netTotal: at(T.net, t),
      };
    },
  };
}

// The same responses stepped in real time, for the live page where the visitor drags the workload.
export function liveModel(L0 = 0.12, play = 200) {
  const s = {L: L0, rpm: rpmFor(L0), cT: 0, gT: 0, fan: 0, air: 0, io: 0, net: 0};
  s.cT = INLET + cpuWatts(L0) * rHeatsink(s.rpm);
  s.gT = INLET + 6 + gpuWatts(L0) * 0.22;
  return {
    step(dt, L) {
      dt = Math.min(dt, 0.1);
      s.L = L;
      s.rpm += (rpmFor(L) - s.rpm) * (dt / 2.2);
      s.cT += (INLET + cpuWatts(L) * rHeatsink(s.rpm) - s.cT) * (dt / 3.0);
      s.gT += (INLET + 6 + gpuWatts(L) * 0.22 * Math.pow(FAN.rpmMax / s.rpm, 0.25) - s.gT) * (dt / 4.0);
      s.fan += ((s.rpm / 60) * 360 * dt) / play;
      s.air += ((s.rpm / FAN.rpmMax) * 520 + 40) * dt;
      s.io += (40 + 1400 * L) * dt;
      s.net += (1.5 + 21 * L) * dt;
    },
    read() {
      const L = s.L;
      const cpu = cpuWatts(L);
      const gpu = gpuWatts(L);
      const dc = 2 * cpu + gpu + memWatts(L) + diskWatts(L) + BOARD + fanWatts(s.rpm);
      return {L, rpm: s.rpm, cpuW: cpu, cpuT: s.cT, cpuT1: s.cT - 2.4, gpuW: gpu, gpuT: s.gT, gpuU: clamp(L * 1.05, 0, 1), memGB: 96 + 340 * L, diskMB: 40 + 1400 * L, netGb: 1.5 + 21 * L, fanW: fanWatts(s.rpm), dc, wall: dc / PSU.eff, cfm: (s.rpm / FAN.rpmMax) * FAN.cfmMax * FAN.n, fanDeg: s.fan, air: s.air, ioTotal: s.io, netTotal: s.net};
    },
  };
}
