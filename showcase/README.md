# Showcase: a 2U server, taken apart

The film at the top of the README and the [interactive 3D page](https://crianezrx.github.io/rackbook/teardown/) are built from this folder with the [teardown](https://github.com/elvarofficial/teardown) kit (MIT, three.js).

| File | Job |
|---|---|
| `server-shared/kin.js` | The numbers: real part dimensions and the workload → power, airflow, fan speed, temperature model. No three.js. |
| `server-shared/server.js` | The geometry, built from code; `update(reading, ops)` poses it. |
| `server-shared/stage.js` | Studio, lights, soft shadow, GTAO. |
| `server-shared/console.js` | The overlay, in Rackbook's hand-drawn look. |
| `server-shared/film.js` | The tour as a pure function of time. |
| `server-shared/live.js` | The same machine in real time: buttons, workload slider, orbit, zoom, auto tour. |
| `server-shared/score.py` | The film's sound, on the same timeline. |

One input, the workload, drives everything. The fan controller follows the standard sizing rule CFM = 3.16 × W / ΔT(°F) for a 20 °F rise. Heatsink resistance falls with airflow, and thermal mass adds a few seconds of lag. The power and thermal figures are an illustrative model built from the parts' ratings, not measurements of one machine.

## Build

```bash
git clone https://github.com/elvarofficial/teardown ~/teardown && git -C ~/teardown checkout a91262a
cd ~/teardown && npm install
node sims/build.mjs <repo>/showcase/server-live     # → teardown-out/dist/server-live.html (the page, ~840 KB, offline)
node sims/build.mjs <repo>/showcase/server-film     # → the film page that capture renders
python3 run_sfx.py <repo>/showcase/server-shared/score.py
```

Copy `server-live.html` to `docs/teardown/index.html` to update the GitHub Pages copy.
