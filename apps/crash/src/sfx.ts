// ============================================================================
// sfx — a tiny Web Audio SYNTH layer. No external files, no deps.
// ----------------------------------------------------------------------------
// Every cue is built live from OscillatorNode + GainNode: short, pleasant
// "bips" rather than realistic samples. A single disposable osc->env->master
// chain per beep keeps the graph trivial; the browser GCs the nodes once they
// finish. One master GainNode lets us hard-mute by ramping to 0.
//
// LOUDNESS: the previous synth peaked around 0.04–0.2 and was inaudible. Cue
// peaks here sit ~0.3–0.5 through a master of 1.0 — clearly audible, not harsh.
//
// AUTOPLAY POLICY (critical): an AudioContext created before a user gesture is
// born `suspended` and Chrome/Safari refuse to start it. We create the context
// LAZILY — only inside `unlock()`, which the app calls from a real pointer/click
// handler — and `resume()` it there. Before that first gesture every cue is a
// silent no-op (never throws). The mute choice persists in localStorage; default
// is ON (unmuted), but sound only begins after a gesture, so we never violate
// the policy.
// ============================================================================

const LS_MUTED = 'crashsui.muted'

// Per-cue PEAK gains (~0.3–0.5). These ride a master of 1.0. Loud + clean.
const GAIN = {
  tap: 0.3,
  tick: 0.3,
  placed: 0.42,
  win: 0.45,
  loss: 0.42,
  coin: 0.4,
  ignite: 0.38,
  splash: 0.4,
  heartbeat: 0.45,
  stake: 0.32,
  charge: 0.3,
  whoosh: 0.4,
  tension: 0.3,
  coin_shower: 0.34,
  deflate: 0.42,
} as const

let ctx: AudioContext | null = null
// Master gain — lets us hard-mute by ramping to 0 without tearing down the graph.
let master: GainNode | null = null
let muted = false

// Throttles so fast poll cadences can't machine-gun the recurring cues.
let last_tick = 0
let last_beat = 0
let last_charge = 0
let last_tension = 0

// Read the persisted mute choice once at module load (default: NOT muted).
const load_muted = (): boolean => {
  try {
    return localStorage.getItem(LS_MUTED) === '1'
  } catch {
    return false
  }
}
muted = load_muted()

// Lazily build the audio graph. Returns the context, or null if Web Audio is
// unavailable (older browsers) — every caller treats null as "stay silent".
const ensure_ctx = (): AudioContext | null => {
  if (ctx) return ctx
  const Ctor =
    typeof window !== 'undefined'
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext)
      : undefined
  if (!Ctor) return null
  try {
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 1
    master.connect(ctx.destination)
    return ctx
  } catch {
    return null
  }
}

// Call from the FIRST real user gesture (pointerdown/click). Creates + resumes
// the context within the gesture so the browser permits playback. Idempotent and
// safe to call on every gesture.
export const unlock = (): void => {
  const c = ensure_ctx()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
}

export const is_muted = (): boolean => muted

// Set the mute state explicitly, persist it, and apply it to the live master
// gain. EVERY cue funnels through `beep()` which early-returns while muted (and the
// master rides to 0), so this silences ALL sfx — taps, ticks, tension, heartbeat,
// win/loss — regardless of any other state (e.g. the settling-bip gate).
export const set_muted = (b: boolean): void => {
  muted = b
  try {
    localStorage.setItem(LS_MUTED, muted ? '1' : '0')
  } catch {
    // private mode / disabled storage — keep the in-memory choice anyway.
  }
  if (master && ctx)
    master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02)
}

// Toggle mute, persist the choice, and apply it to the live master gain. Returns
// the new muted state so the caller can update its toggle UI.
export const toggle_mute = (): boolean => {
  set_muted(!muted)
  return muted
}

// One short synth "bip": osc -> env -> master, with a fast attack and an
// exponential decay so it never clicks. `peak` is the cue gain, `freq` the start
// pitch in Hz; if `to` is given the pitch glides there (rising/falling bips).
// `dur` is the beep length in seconds, `when` delays it for cascades, `type`
// picks the waveform. A no-op while muted, before unlock, or without Web Audio.
const beep = (
  freq: number,
  peak: number,
  dur: number,
  opts: {
    to?: number
    when?: number
    type?: OscillatorType
  } = {},
): void => {
  if (muted) return
  const c = ctx
  if (!c || !master || c.state !== 'running') return
  const { to, when = 0, type = 'triangle' } = opts
  const t0 = c.currentTime + Math.max(0, when)
  const osc = c.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (to != null && to !== freq)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur)
  const env = c.createGain()
  // Fast 6ms attack, then exponential decay to silence — clean, no clicks.
  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(peak, t0 + 0.006)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(env)
  env.connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

// soft, tiny click on press — a single short high bip.
export const tap = (): void => beep(880, GAIN.tap, 0.05, { type: 'square' })

// confident "bet placed" cue — a quick rising two-note bip.
export const placed = (): void => {
  beep(440, GAIN.placed, 0.08)
  beep(660, GAIN.placed, 0.1, { when: 0.07 })
}

// short rising tick as the cash-out value climbs (throttled to ~5/s max).
export const tick = (): void => {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (now - last_tick < 180) return
  last_tick = now
  beep(1320, GAIN.tick, 0.04, { type: 'square' })
}

// triumphant WIN — a bright ascending three-note arpeggio.
export const win = (): void => {
  beep(660, GAIN.win, 0.1, { type: 'triangle' })
  beep(880, GAIN.win, 0.1, { when: 0.08, type: 'triangle' })
  beep(1320, GAIN.win, 0.16, { when: 0.16, type: 'triangle' })
}

// LOSS — a short low descending two-tone.
export const loss = (): void => {
  beep(330, GAIN.loss, 0.12, { to: 220, type: 'sawtooth' })
  beep(196, GAIN.loss, 0.18, { when: 0.1, to: 130, type: 'sawtooth' })
}

// bright bell-ish ping when the balance increases (coin-ish).
export const coin = (): void => beep(1568, GAIN.coin, 0.12, { type: 'sine' })

// ignite — a low rising swell layered under placed() as the directional core
// fills.
export const ignite = (): void =>
  beep(220, GAIN.ignite, 0.18, { to: 440, type: 'sawtooth' })

// splash — a quick bright down-glide burst on cash-out.
export const splash = (): void =>
  beep(1400, GAIN.splash, 0.16, { to: 600, type: 'sine' })

// heartbeat — a low pulse for the countdown's final seconds. Throttled so the
// 1s tick cadence can't double-fire it.
export const heartbeat = (): void => {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (now - last_beat < 500) return
  last_beat = now
  beep(120, GAIN.heartbeat, 0.14, { type: 'sine' })
}

// ============================================================================
// JUICE additions — heavier game-feel feedback (synth, mute/autoplay-safe).
// ============================================================================

// stake_select(step) — a select bip whose pitch RISES with the stake step
// (0 = smallest preset … 1 = biggest). Bigger stake feels like charging up.
export const stake_select = (step: number): void => {
  const s = Math.max(0, Math.min(1, step))
  beep(520 + s * 720, GAIN.stake, 0.05, { type: 'square' })
}

// charge(level) — a soft rising bip reflecting how big the potential gain is
// (level 0..1). Throttled; the "potential gain grew" cue.
export const charge = (level: number): void => {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (now - last_charge < 120) return
  last_charge = now
  const l = Math.max(0, Math.min(1, level))
  beep(600 + l * 700, GAIN.charge, 0.05, { type: 'square' })
}

// whoosh — a quick up-glide layered under placed() on a bet.
export const whoosh = (): void =>
  beep(300, GAIN.whoosh, 0.12, { to: 900, type: 'sine' })

// tension(closeness) — a rising bip as the live price nears the entry line
// (closeness 0 far … 1 right on the line). Throttled so it stays tense, not
// machine-gunned.
export const tension = (closeness: number): void => {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (now - last_tension < 220) return
  last_tension = now
  const c = Math.max(0, Math.min(1, closeness))
  beep(700 + c * 800, GAIN.tension, 0.05, { type: 'square' })
}

// coin_shower — a quick cascade of bright bell pings stacked on a win.
export const coin_shower = (): void => {
  for (let i = 0; i < 5; i++)
    beep(1400 + Math.random() * 600, GAIN.coin_shower, 0.1, {
      when: i * 0.07,
      type: 'sine',
    })
}

// deflate — a slow falling tone layered under loss().
export const deflate = (): void =>
  beep(300, GAIN.deflate, 0.26, { to: 90, type: 'sawtooth' })
