"""Score for the 2U server teardown: a calm bed (Dmaj9, 96 bpm) the whole way, a soft click on every button press,
a breath of air under each camera move, and the fans themselves: band noise whose pitch and level follow the fan
speed, rising when the workload slider is dragged to 90 %.

    python run_sfx.py <repo>/showcase/server-shared/score.py

Times and the fan model mirror server-shared/film.js (SCRIPT, loadAt) and kin.js (rpmFor, the 2.2 s fan loop).
"""

import math
import os

from sfx.score_kit import airy, bed, chords, env_fade, hz
from sfx.synth import bandnoise, click

TIMELINE = "../server-film/timeline.json"
OUT = os.path.join(os.environ.get("TEARDOWN_OUT", "teardown-out"), "server-score.wav")
TARGET_LUFS = -14.0
SEED = 21
SR = 48000

CHORDS = chords("Dmaj9:D3 F#3 A3 C#4 E4/D2", "Bm7:B2 D3 F#3 A3/B1", "Gmaj7:G2 B2 D3 F#3/G1", "A6:A2 C#3 E3 F#3/A1")
MOTIF = [(0.5, hz("F#5")), (1.5, hz("E5")), (2.5, hz("C#5"))]
CLICKS = (3.4, 6.6, 9.8, 13.2, 16.4, 19.6, 22.8, 26.0)
LOAD = (6.6, 0.12, 0.9, 1.6)


def smoother(x):
    u = min(1.0, max(0.0, x))
    return u * u * u * (u * (u * 6 - 15) + 10)


def load_at(t):
    t0, a, b, d = LOAD
    return a + (b - a) * smoother((t - t0) / d)


def heat(L):
    cpu = 40 + 165 * L ** 0.85
    return 2 * cpu + 30 + 120 * L + 16 * (2 + 2.5 * L) + 12 * (5 + 3 * L) + 58


def rpm_for(L):
    cfm = 3.16 * heat(L) / 20
    return min(16800, max(4200, cfm / 6 / 42 * 16800))


def rpm_curve(dur, dt=1 / 200):
    out, rpm, t = [], rpm_for(load_at(0)), 0.0
    while t < dur + 1:
        rpm += (rpm_for(load_at(t)) - rpm) * dt / 2.2
        out.append(rpm)
        t += dt
    return lambda tt: out[min(len(out) - 1, int(tt / dt))]


def fans(dur, rpm_at):
    n = int(dur * SR)
    x = bandnoise(n, lambda k: 260 + 0.06 * rpm_at(k / SR), q=0.9)
    return env_fade([x[k] * (rpm_at(k / SR) / 16800) ** 1.4 * 2.2 for k in range(n)], 0.8, 1.2)


def score(mix, tl):
    dur = tl["duration"]
    left, right, low, drums = bed(dur, 96, CHORDS, MOTIF, motif_voice="epiano", kicks=(0, 2.5), snares=(), hats=8, swing=0.0, keys_vel=0.65, keys_lp=3400)
    mix.put_stereo(0, left, right, 0.12)
    mix.put(0, low, 0.11)
    mix.put(0, drums, 0.035)
    mix.put(0, fans(dur, rpm_curve(dur)), 0.05)
    for t in CLICKS:
        mix.put(t, click(2400, 0.025), 0.055)
    mix.put(LOAD[0], airy(LOAD[3] + 0.8, 400, 1800, 0.6), 0.03)
    for t in CLICKS:
        if t != LOAD[0]:
            mix.put(t + 0.1, airy(1.3, 700, 1500, 0.6), 0.016)
