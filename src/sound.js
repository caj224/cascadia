/*
 * Sound.
 *
 * Everything here is synthesised with the Web Audio API — there are no asset
 * files, so audio works offline the moment the app loads and `public/sw.js`
 * has nothing extra to cache.
 */

const MUTE_KEY = "cascadia:muted";

/*
 * Custom audio, optional.
 *
 * Any file dropped into src/sounds/ is picked up at build time — there is no
 * registration step and no manifest to keep in sync. The basename is the role:
 *
 *   drumroll.*   the roll that plays while the result is hidden
 *   fanfare.*    any win, unless the winner has their own file
 *   win-<name>.* that person's win — win-dad.* plays when Dad wins
 *   tie.*        the tie (optional — the fanfare file covers it)
 *
 * The name in win-<name>.* is matched the way names are matched everywhere
 * else: trimmed and lower-cased, so win-dad.* covers "Dad" and "dad".
 *
 * mp3, m4a, aac, wav, ogg and flac all work. Anything missing, undecodable, or
 * blocked falls back to the synthesised versions further down, so a bad asset
 * can never leave the app silent.
 */
const FILES = import.meta.glob("./sounds/*.{mp3,m4a,aac,wav,ogg,flac}", {
  eager: true,
  query: "?url",
  import: "default",
});

const SAMPLE_URL = {};
for (const path in FILES) {
  const role = path.split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
  SAMPLE_URL[role] = FILES[path];
}
const HAS_FILES = Object.keys(SAMPLE_URL).length > 0;

const samples = {}; // role -> AudioBuffer, once decoded
let loading = null;

/* A drumroll file sets the length of the reveal, but not without limit — a
   file left long by accident should not strand anyone on the roll screen. */
const ROLL_SECONDS = 2.2;
const MAX_ROLL_SECONDS = 6;
const SAMPLE_GAIN = 0.9;

let ctx = null;
let noise = null;
let kicked = false;

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch (err) {
    return false; // private mode: default to audible
  }
}

let muted = readMuted();

export const isMuted = () => muted;

export function setMuted(v) {
  muted = !!v;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch (err) {
    /* the setting just won't survive a reload */
  }
  if (muted && ctx) ctx.suspend();
}

/* The context alone, without resuming it. decodeAudioData works on a suspended
   context, so samples can be decoded long before the first tap. */
function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/* iOS only starts audio inside a user gesture, so every play path runs through
   here and every play path is reached from a tap. */
function audio() {
  if (muted) return null;
  const ac = ensureCtx();
  if (!ac) return null;
  if (ac.state === "suspended") ac.resume();
  return ac;
}

/* Fetch and decode whatever is in src/sounds/. Runs at import time so the
   files are ready — and cached by the service worker — before the first game
   is ever recorded. Failures are swallowed: the synth is always there. */
function preload() {
  if (loading || !HAS_FILES) return loading;
  const ac = ensureCtx();
  if (!ac) return null;
  loading = Promise.all(
    Object.keys(SAMPLE_URL).map((role) =>
      fetch(SAMPLE_URL[role])
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((b) => ac.decodeAudioData(b))
        .then((buf) => {
          samples[role] = buf;
        })
        .catch(() => {}) // stay on the synthesised fallback for this role
    )
  );
  return loading;
}
preload();

function playSample(ac, role, at, limit) {
  const buf = samples[role];
  if (!buf) return null;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = SAMPLE_GAIN;
  src.connect(g).connect(ac.destination);
  src.start(at);
  if (limit) src.stop(at + limit);
  return src;
}

/*
 * Call from inside a tap before anything is scheduled.
 *
 * resume() alone is not always enough on iOS — the context reports "running"
 * but stays silent until a buffer has actually been played inside a gesture.
 * Starting a one-sample silent buffer here is the standard way to force it.
 */
export function unlock() {
  const ac = audio();
  if (!ac || kicked) return;
  const src = ac.createBufferSource();
  src.buffer = ac.createBuffer(1, 1, 22050);
  src.connect(ac.destination);
  src.start(0);
  kicked = true;
}

/* Whether audio is actually able to play, for the UI to warn about. */
export const audioBlocked = () =>
  !muted && !!ctx && ctx.state !== "running";

/* Short confirmation blip, so the sound toggle proves itself out loud. */
export function blip() {
  const ac = audio();
  if (!ac) return;
  tone(ac, ac.currentTime + 0.01, 880, 0.16, 0.18);
}

/* One second of white noise, shared by every drum hit and the crash. */
function noiseBuffer(ac) {
  if (!noise || noise.sampleRate !== ac.sampleRate) {
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

function hit(ac, at, { gain, freq, q = 0.9, decay, type = "bandpass" }) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(at);
  src.stop(at + decay + 0.02);
  return src;
}

function tone(ac, at, freq, dur, gain, type = "triangle") {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.02);
  g.gain.setValueAtTime(gain, at + dur * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
  return osc;
}

/*
 * Snare roll: separate hits tightening from ~85ms apart down to ~22ms and
 * swelling as they go, with a low rumble underneath. Returns a stop() so the
 * reveal can cut it short when someone taps to skip.
 */
export function drumroll(seconds = ROLL_SECONDS) {
  const ac = audio();
  if (!ac) return { stop: () => {}, seconds };

  /* A supplied file replaces the synth outright, and its own duration drives
     how long the reveal stays hidden. */
  if (samples.drumroll) {
    const length = Math.min(samples.drumroll.duration, MAX_ROLL_SECONDS);
    const src = playSample(ac, "drumroll", ac.currentTime + 0.02, length);
    return {
      seconds: length,
      stop: () => {
        try {
          if (src) src.stop();
        } catch (err) {
          /* already stopped */
        }
      },
    };
  }

  const start = ac.currentTime + 0.06;
  const nodes = [];

  const rumble = ac.createOscillator();
  rumble.type = "sine";
  rumble.frequency.setValueAtTime(48, start);
  const rg = ac.createGain();
  rg.gain.setValueAtTime(0.0001, start);
  rg.gain.linearRampToValueAtTime(0.09, start + seconds * 0.85);
  rg.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  rumble.connect(rg).connect(ac.destination);
  rumble.start(start);
  rumble.stop(start + seconds + 0.05);
  nodes.push(rumble);

  let t = 0;
  let i = 0;
  while (t < seconds) {
    const p = t / seconds; // 0 → 1 across the roll
    nodes.push(
      hit(ac, start + t, {
        gain: (0.1 + 0.3 * p * p) * (i % 4 === 0 ? 1.25 : 1),
        freq: 1400 + 900 * p,
        decay: 0.06,
      })
    );
    t += 0.085 - 0.063 * p; // accelerando
    i++;
  }

  return {
    seconds,
    stop: () =>
      nodes.forEach((n) => {
        try {
          n.stop();
        } catch (err) {
          /* already stopped */
        }
      }),
  };
}

/* The payoff. A win gets a rising fanfare, a tie gets a flat two-note shrug. */
export function fanfare(tie = false, winner = "") {
  const ac = audio();
  if (!ac) return;
  const at = ac.currentTime + 0.02;

  /* Most specific first: this winner's own file, then the tie file, then the
     general one. A tie never uses somebody's personal win sound. */
  const order = tie ? ["tie", "fanfare"] : [`win-${winner}`, "fanfare"];
  const role = order.find((r) => samples[r]);
  if (role) {
    playSample(ac, role, at);
    return;
  }

  hit(ac, at, { gain: 0.45, freq: 4800, q: 0.3, decay: 1.5, type: "highpass" });

  if (tie) {
    tone(ac, at, 587.33, 0.42, 0.15);
    tone(ac, at + 0.24, 493.88, 0.75, 0.15);
    return;
  }
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
  notes.forEach((f, i) =>
    tone(ac, at + i * 0.13, f, i === notes.length - 1 ? 1.1 : 0.5, 0.16)
  );
}
