# Suize — Marketing Direction

> "Agents discover, agents pay, humans don't touch it."

This is the operating doc for everything that leaves the building: tweets, cards, mascot work, threads, and the launch run-up to Sui Overflow 2026 + the Objectomics arXiv drop. If a piece of content doesn't pass the tests in this doc, it doesn't ship.

---

## 1. North star

**Public-facing line:** *Ask Sui in plain English.*

**Engineer-facing line:** *Objectomics — every object on Sui writes its own autobiography. We read 50M of them in parallel.*

**Deck tagline:** *Chainalysis hires analysts. We hire the chain.*

We do **not** chase humans. Our customer is an autonomous agent. Every piece of content is read first by an LLM scraping for hooks, second by an engineer deciding whether to integrate, third by a crypto follower deciding whether to retweet. Optimize in that order.

---

## 2. Brand DNA

### The Droplet (Suize's mascot)

A 22×22 pixel-art water droplet — pointed top, rounded bottom, three-band blue shading, expressive face. Lives in the React codebase (`landing/src/components/Droplet.jsx`) with three canonical poses:

| Pose | Use |
|---|---|
| `hero` | Holds a gold $ coin (left) and a `{ }` brace (right). The "I do both jobs" pose. Default for launch/announcement cards. |
| `hello` | Both arms raised, waving, no items. Friendly greeting. Use for community / onboarding / "we're live" moments. |
| `rest` | No arms. Tiny footer or sticker base. Use when the card already has a busy headline. |

**The mascot is canon.** We do not redesign it per card. We *render it once*, save the master PNG, and composite it into card backgrounds. Every Gemini generation must either use the master PNG as a reference image OR describe the droplet to exact pixel spec in the prompt (see §7).

**Vocabulary to build (sticker-pack mentality):** sleeping droplet, droplet typing at a CRT, droplet paying with a coin, droplet receiving a coin, surprised droplet, sweating droplet (incident mode), confident smug droplet, droplet with sunglasses, droplet pointing at a graph. Pudgy Penguins won by being a *vocabulary*, not a portrait — we follow.

### Palette (locked)

```
--sui-glow    #B9DEFA   light haze, sparkles, ambient
--sui-bright  #7AC4FF   highlights, edges, accent text
--sui         #4DA2FF   primary blue, headline shimmer
--sui-deep    #2E7BD6   body shadows, CTAs
--sui-deeper  #1F5FB6   deepest shadow band
--bg          #050D1A   carbon-dark background
--bg-elev     #0A172C   elevated surface
--ink         #E8F2FF   primary text
--ink-dim     #93B4D8   secondary text
--ink-mute    #5A7A9C   tertiary mono / labels
```

Backgrounds are *blue-tinted carbon*, not black. Cards use a radial mesh gradient (the `.bg-ambient` recipe in `landing/src/index.css`) — soft blue glow top-right, deeper blue plume bottom-left, fading to carbon. **Never** a pure flat color background. Never neon. Never warm.

The only non-blue brand color is the gold coin (#FACC15 / #B07B0E) on the `hero` pose. Used sparingly — it earns its presence by signaling "money happens here."

### Typography

- **Display & UI:** Space Grotesk Medium (500). Tracking tight (-0.045em on big headlines, -0.02em on body).
- **Mono:** JetBrains Mono. Used for endpoint paths, status chips, latency numbers, the marquee.
- **Card headlines:** 4–7 words max. Never a sentence. Cards are billboards.
- **Card body (optional):** one supporting line, mono or thin sans.

### Tone of voice

Direct, slightly esoteric, never corporate. Read the room: this is crypto-Twitter + ML-Twitter, where condescension goes further than enthusiasm.

- **Confident, not promotional.** "Ask Sui in plain English." — not "The world's first agentic Sui interface!"
- **Receipts > vibes.** Numbers in every post: `0.01 USDsui · 240ms · 50M objects/day`.
- **Agentic-coded.** Refer to the reader as an agent operator, not a "user." Use `agent.ask()` syntax instead of "send a request."
- **Quiet humor.** Mascot does the joking. Copy stays tight.
- **No emojis** except 🟦 (the droplet's home flag) and ⌬ / ◆ / ▲ for structural accents in threads. Especially not 🚀 🔥 💎 — those are SHIB-era.

---

## 3. Visual system

### Card spec

| Format | Dimensions | Aspect | Use |
|---|---|---|---|
| **Timeline standard** | 1200×675 | 16:9 | Default. Single-image tweets, threads, announcements. |
| **Mobile-dense** | 1080×1350 | 4:5 | When we want to dominate the feed. Reserve for launch posts. |
| **Square avatar/sticker** | 1024×1024 | 1:1 | Mascot stickers, profile assets, embed thumbnails. |
| **Banner** | 1500×500 | 3:1 | Profile header only. |

### Composition rules (non-negotiable)

1. **One idea per card.** If you need a second concept, it's a second card.
2. **40% negative space minimum.** Cards die when packed. Hold the line.
3. **One focal point.** Either the mascot OR the headline is the hero, not both. The other supports.
4. **Brand mark in ONE corner.** A tiny `suize.io` mono lockup. Never two.
5. **Rule of thirds.** Mascot on a third-line, headline on the opposing third-line. Center compositions read flat.
6. **No drop shadows, no lens flare, no gradient mesh on type, no isometric, no 3D, no generic SaaS illustration.** If it could be on a Slack landing page, kill it.
7. **The slop test:** if the image could be on *any* SaaS landing page, kill it. If it could only be Suize, ship it.

### Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| Heavy negative space, one focal point | Pack the card with chips, icons, text columns |
| Pixel mascot + clean vector type | Pixelate the type too (reads as NFT 2021) |
| Carbon-dark with blue mesh ambient | Pure black or pure white backgrounds |
| Mono ticker / status chip in one corner | Sprinkle multiple chips like a dashboard mockup |
| Big rotated headline (-1.5° / +1.5° accents) | Centered serif headlines (corporate slide deck energy) |
| Show one number, prominently | List four metrics in a grid |
| Mascot has a *reason* for the pose | Mascot is just decoration in the corner |

---

## 4. Voice — five narrative pillars

Every post fits one of these. If it doesn't, we don't post it.

### Pillar 1 — **Plain English first**
The hero claim. Frame every demo around an intent a human would actually type: *"profitable arb route for USDC,"* *"recently-deployed Pokemon meme coin with >1M volume,"* *"largest validator this epoch."* Never lead with the architecture.

### Pillar 2 — **Receipts > vibes**
Olas brags 700K txns/month, 30% MoM, 3.5M total. We do the same. Every week: txns served, p95 latency, agents integrated, new clusters discovered. Numbers carry the credibility — we don't add adjectives.

### Pillar 3 — **Infrastructure is the bottleneck, not intelligence**
The 2026 meta. Models are good enough. What they lack is *paid, structured, low-latency access to chain state*. We are that. Frame Suize as the missing rail — not another LLM, not another wallet, not another indexer. The pipe between agents and Sui.

### Pillar 4 — **Objectomics (the IP angle)**
The arXiv paper is the credibility multiplier. Drip-feed the theory: type-quotient convergence, PTB structural fingerprinting, hot-potato intent atoms, the case-id property of Sui object IDs. Engineer-Twitter loves a paper. *"Every object on Sui writes its own autobiography"* is the headline metaphor — use it.

### Pillar 5 — **The x402 rail**
Don't fight the ecosystem — ride it. Co-occur with @coinbase, @CircleCoin, @base, @SuiNetwork, x402 maintainers. Every relevant post tags "built on x402." Their distribution is our distribution. The narrative is already wide open (x402 ecosystem ~$7B valuation, ~$28K/day real volume — we ship the real volume).

---

## 5. Content mix & cadence

**Cadence target:** 3 posts/day, 7 days/week (~19/week, per Hootsuite 2025 peak engagement window). Plus 5–20 high-signal replies/day to known accounts.

**Pillar mix:**

| Share | Pillar | Examples |
|---|---|---|
| 30% | **Build-in-public** | Latency screenshots, "agent #5,000 just paid $0.01 for a quote," cluster discovery logs, indexer throughput |
| 25% | **Educational threads** | "How AI agents discover infrastructure," "$0.01 economics," "Why MCP + x402 is the agent stack," Objectomics primer |
| 20% | **Mascot / memes** | Droplet reaction stickers, sleeping droplet on idle, droplet paying invoices, droplet incident mode |
| 15% | **Reply-guy** | Targeted replies to @brian_armstrong, @karpathy, @sama, @aeyakovenko, @SuiNetwork, x402 devs |
| 10% | **Alpha drops** | arXiv paper teases, Overflow countdown, benchmark numbers, mystery-protocol demos |

**Critical:** community-first projects (5–20 daily replies on others' posts) get 3–5× more impressions than broadcast-only accounts. At zero followers, **reply-guy mode is the moat**.

**Meta-narrative bait (free engagement):** let an agent post the weekly Suize digest *using Suize*. "This thread was written by an autonomous agent that paid Suize $0.07 to gather the data." Olas does this — it lands.

---

## 6. Card series — first 10 concepts (ready to brief)

These are sequenced for week 1–2 launch run. Each is a single card unless noted.

### S1 · **Mascot canon portrait** (1:1)
The droplet in `hero` pose, dead-center on the carbon-blue ambient mesh, no text, generous negative space. This is the master PNG we composite into every other card going forward. Generate this first; never re-roll.

### S2 · **"Ask Sui in plain English."** (16:9)
Big rotated headline upper-third, droplet in `hero` pose lower-right third. Tiny mono chip top-left: `POST /ask · 0.01 USDsui`. The launch card.

### S3 · **"Agents pay. Humans don't."** (16:9)
Droplet in `hero` pose center-left, holding the gold coin prominent. Headline right-aligned upper-right. Tiny mono `x402 · gasless` lower-right. The narrative anchor.

### S4 · **"One endpoint. Atomic."** (16:9)
No mascot. Just the endpoint, terminal-styled, on the carbon-blue gradient. Mono headline:
```
POST /ask
{ intent, x_payment } → answer
```
Tiny droplet sticker in corner. For engineer-Twitter.

### S5 · **"The chain answers itself."** (16:9)
Objectomics tease. Droplet in `rest` pose at the base of the card, looking up at an abstract minimalist graph/cluster diagram floating above — emergent taxonomy hint. Headline anchored bottom-left. arXiv link in mono corner.

### S6 · **Receipts card** (4:5)
Mobile-dense. Big number center: `50,847,219` (or whatever real number we have). Mono label above: `objects indexed · last 24h`. Droplet `rest` pose tiny in lower corner. Reusable template — swap the number weekly.

### S7 · **Mystery protocol demo** (16:9 carousel, 3 cards)
Card A: "Name any Sui protocol deployed in the last 30 days." (droplet `hello`, confident smile)
Card B: A real demo screenshot — protocol name + Suize's auto-labeled cluster + the English answer.
Card C: "Type-quotient convergence. No humans wrote 'STAKE.'" + arXiv link.

### S8 · **Sticker pack** (1:1 × 6)
Six 1024×1024 droplet stickers, transparent background, for thread reactions:
- Sleeping droplet (idle node)
- Droplet typing at CRT (build-in-public)
- Droplet holding coin up (payment confirmed)
- Surprised droplet (incident / cluster anomaly)
- Smug sunglasses droplet (we shipped)
- Tiny waving droplet (good morning)

### S9 · **"Chainalysis hires analysts. We hire the chain."** (16:9)
Pure typography card. No mascot. Big serif-like display (still Space Grotesk Medium, not actual serif). Sharp, almost confrontational. The deck tagline as a billboard. For when we want to provoke.

### S10 · **Overflow countdown** (4:5)
Mobile-dense. Big mono number: `T-87 days`. Subtext: `Sui Overflow 2026 · Objectomics paper · live demo`. Droplet `hero` pose corner. Update weekly until launch.

---

## 7. Image-generation playbook (Gemini 3 Pro Image Preview)

**Model:** `gemini-3-pro-image-preview` (locked by global rule — no other generators).

**Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent`

**Always pass `responseModalities: ["IMAGE"]` and `imageConfig.aspectRatio`** matching the target format (16:9, 4:5, 1:1, 3:1).

### Prompt template

```
[SUBJECT]
A 22×22 pixel-art water droplet character ("Suize the droplet"):
pointed top, rounded bottom, 3-band blue shading
(highlight #7AC4FF, body #4DA2FF, shadow #2E7BD6),
dark pixel eyes #0A1A2E with single white sparkle pixel,
light cyan cheek blush pixels #9BD6FF.
Pose: {hero | hello | rest}.
{Items if hero: tiny gold coin (#FACC15) in left hand, mono "{ }" brace in right hand.}

[COMPOSITION]
Card layout, {16:9 / 4:5 / 1:1} aspect ratio.
Droplet positioned {lower-left third / center / lower-right third}.
40% negative space minimum.
{Headline text "<EXACT WORDS>" rendered in tight tracked sans-serif (Space Grotesk Medium),
weight 500, color #E8F2FF, positioned {upper-right / upper-left} third, rotated -1.5°.}

[BACKGROUND]
Carbon-dark background #050D1A,
soft radial mesh gradient: glow #7AC4FF at 20% opacity top-right,
deeper #2E7BD6 plume at 15% opacity bottom-left,
fading to base carbon. Subtle 0.04 opacity grain overlay.
NO flat color. NO neon. NO warm hues.

[ACCENTS]
Tiny mono chip in {top-left / bottom-right} corner: "<TEXT>"
in JetBrains Mono, color #7AC4FF, on translucent #0A172C pill.

[BRAND MARK]
Bottom-{left/right} corner: "suize.io" wordmark in JetBrains Mono,
color #5A7A9C, 10px equivalent.

[STYLE]
Editorial tech aesthetic. Reference: Stripe documentation cards,
Anthropic announcement cards, Linear changelog headers.
Clean vector type, crisp pixel mascot — the contrast is the brand.
```

### Negative prompts (paste verbatim)

```
busy, cluttered, multiple subjects, text artifacts, watermark, logos other than suize,
photorealistic skin, drop shadows on type, gradient mesh on text, lens flare,
oversaturated, neon, warm hues, 3D rendering, isometric, generic SaaS illustration,
corporate clip art, stock photo, gen-AI smoothness, blurry pixels, anti-aliased mascot,
crypto bro aesthetic, rocket emoji, lambo, money rain, NFT 2021 vibe
```

### Workflow

1. **Generate mascot canon once** (S1 above). Save as `marketing/assets/droplet-hero-master.png` and `droplet-hello-master.png` and `droplet-rest-master.png`.
2. **For every subsequent card, pass the master PNG as a reference image** in the Gemini request (multipart `inlineData` part before the text prompt). This prevents brand drift.
3. **Generate at native target resolution.** Don't upscale pixel art with AI — it smooths the pixels. If we need a bigger sprite, nearest-neighbor upscale in post.
4. **Three rolls per card minimum.** Keep the best. Discard generously. Output quality is bimodal.
5. **Composite final text in Figma when type breaks.** Gemini renders text well at 4–7 words, gets shaky beyond. For long thread cards, generate the bg + mascot, then drop the headline in Figma.
6. **Save the winning prompt** to `marketing/prompts/<card-id>.txt`. Reproducibility = no drift across sessions.

---

## 8. Asset hygiene

**Folder structure:**
```
marketing/
├── DIRECTION.md          (this file)
├── prompts/              (one .txt per card — the winning prompt)
│   ├── s01-mascot-canon.txt
│   ├── s02-ask-sui.txt
│   └── ...
├── cards/                (generated PNGs, ready to post)
│   ├── s01-mascot-canon-v1.png
│   ├── s01-mascot-canon-final.png
│   └── ...
├── assets/               (master mascot renders, sticker source)
│   ├── droplet-hero-master.png
│   ├── droplet-hello-master.png
│   └── droplet-rest-master.png
└── scripts/
    └── gen-image.mjs     (Gemini API wrapper)
```

**Naming convention:** `s<NN>-<slug>-<version>.png`. Versions: `v1`, `v2`, ..., then `final`. Only one `final` per series.

**Gitignore the generated PNGs** until they're approved, then commit just the `final` ones. Prompts always commit.

---

## 9. Risks & off-limits

**Things we never post:**
- "Best" / "highest" / "safest" recommendations on any chain data — Tier-3 hallucination liability. Reframe as enumeration. Agent ranks.
- Price predictions, yield predictions, "next 10x" framing.
- "Crypto bro" aesthetic in any form: rocket emojis, lambo, money rain, "WAGMI."
- Mysten competitive framing — founder's locked stance, we don't pick that fight.
- Centered serif corporate slide-deck cards.
- AI-generated mascot that doesn't match the canon pixel droplet. Brand consistency > novelty.
- Multi-chain framing in v1 narrative — Sui's type system IS the moat, dilute it and we dilute the paper.

**Risks to watch:**
- **Pixel art reading as "NFT 2021"** — mitigation: pixel mascot only, vector everywhere else, modern type, dark blue carbon (not Pudgy-pink).
- **x402 narrative front-running real traction** — mitigation: ship receipts (txn counts) within 2 weeks of launch, or the narrative gets brittle.
- **Mascot fatigue from over-rolling** — mitigation: 3-pose canon, never redesign per card, sticker vocabulary instead of new portraits.
- **Looking like another AI-slop project** — mitigation: real numbers, real demos, the paper. Slop projects don't ship benchmarks.

---

## 10. Animated mascot scenes — the moving content engine

Twitter video gets ~6× the engagement of static images in 2026, and a looping mascot scene reads as native crypto/AI culture (Pudgy GIFs, Clawd plushie clips, $TURBO loops). We need a real moving-image pipeline, not just static cards.

### The two-layer architecture

**Layer 1 — Scene library (React + SVG).** Each scene is a self-contained React component that composes the canonical `Droplet` mascot with props, particle effects, type, and a fixed timeline (typically 2–10 seconds). The mascot stays canon — we never redraw it per scene, we *direct* it. Existing CSS keyframes (`breathe`, `blink`, `armWave`, `sparkle`) compose with scene-level animation primitives.

**Layer 2 — Render pipeline (Remotion + FFmpeg).**
- **Remotion** is the standard for "React → video" — deterministic frame rendering via Puppeteer, native MP4/WebM/GIF output, audio support, Twitter-ready presets. Reuses our existing `Droplet.jsx` as-is.
- **FFmpeg** handles format conversion, GIF palette generation, and dimension/bitrate tuning for Twitter's encoder.

```
marketing/
├── video/
│   ├── remotion.config.ts
│   ├── package.json
│   ├── src/
│   │   ├── Root.tsx                       (registers all scenes)
│   │   ├── scenes/
│   │   │   ├── Ritual.tsx
│   │   │   ├── CoinDrop.tsx
│   │   │   ├── ClusterBloom.tsx
│   │   │   ├── PlainEnglish.tsx
│   │   │   └── …
│   │   └── primitives/
│   │       ├── DropletStage.tsx           (centers the canon mascot)
│   │       ├── PixelRain.tsx              (reusable particle field)
│   │       ├── TerminalType.tsx           (typing-cursor primitive)
│   │       └── CoinFly.tsx                (animated USDsui coin)
│   ├── public/                            (refs, sounds, fonts)
│   └── out/                               (generated mp4/webm/gif)
```

Each scene imports the existing mascot directly — zero duplication:

```tsx
import { AbsoluteFill, useCurrentFrame, spring, interpolate } from 'remotion'
import Droplet from '../../../landing/src/components/Droplet'

export const Ritual = () => {
  const frame = useCurrentFrame()
  const enter = spring({ frame, fps: 30, config: { damping: 14 } })
  // …
  return (
    <AbsoluteFill style={{ background: '#050D1A' }}>
      <Droplet pose="hero" size={360 * enter} />
    </AbsoluteFill>
  )
}
```

### Format choice — what to ship where

| Format | Codec | Where | Constraints |
|---|---|---|---|
| **MP4** | H.264, AAC silent | Default for Twitter posts (auto-loops <60s) | 1280×720 or 1080×1350, ≤512MB, ≤140s |
| **WebM** | VP9 | Landing-page embeds, Discord | Smaller files, better quality at low bitrate |
| **GIF** | — | Only for sticker loops ≤3s and ≤1MB | Anything longer → post as video, not GIF |
| **Animated SVG (SMIL/CSS)** | — | suize.io embeds, README, GitHub previews | No video player needed — runs in any browser/markdown viewer |
| **Lottie JSON** | — | Optional future: in-app embeds, RN, mobile | Heavier toolchain, defer until needed |

**The render commands (target conventions, lock these in):**

```bash
# Twitter post format — 1080×1080 (square), 30fps, H.264
npx remotion render Ritual out/ritual.mp4 --codec=h264 --width=1080 --height=1080

# Mobile-feed dense — 1080×1350 (4:5), great real estate
npx remotion render Ritual out/ritual-portrait.mp4 --codec=h264 --width=1080 --height=1350

# WebM for landing
npx remotion render Ritual out/ritual.webm --codec=vp9 --width=1280 --height=720

# Sticker GIF — tight loop, 480px, palette-optimized
npx remotion render CoinDrop out/coin-drop.gif --codec=gif --width=480 --every-nth-frame=2
ffmpeg -i out/coin-drop.gif -vf "fps=24,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 out/coin-drop-optim.gif
```

### Scene catalog — first 10 animated scenes (ready to brief)

These are the moving counterparts to the static card series in §6. Sequenced by production priority.

#### A1 · **"The Ritual"** (6s, signature loop)
Empty carbon-blue stage. A typing cursor materializes: `agent.ask("best USDC pool")`. The droplet pixel-rains in from above and assembles at center in `hero` pose. The coin in its hand glows, then a USDsui token flies from the hand to the right edge (the "endpoint"). JSON response cascades back from the right, droplet smiles, sparkles bloom, fade to loop. **The complete intent→payment→answer cycle in one shot.** Hero asset for the launch tweet and the pinned tweet.

#### A2 · **"Coin Drop" sticker** (1.5s, GIF loop)
Tight crop. A USDsui coin falls into the droplet's outstretched hand. Droplet catches it, smiles, single sparkle pixel. Loops forever. Posted alongside every "agent #N paid" receipt tweet. **Highest-frequency asset — make it sticky.**

#### A3 · **"Cluster Discovery Bloom"** (8s, Objectomics teaser)
Black field. PTB dots stream from the top. Magnetic clustering — they snap into 7 colored groups one at a time. Each cluster gets a label that types into existence: `swap-route`, `nft-mint`, `borrow-loop`, `meme-launch`, `validator-rotation`, `liquid-stake`, `hot-potato-flash`. Droplet watches from the bottom-right corner. End frame: *"No human wrote these labels."* + arXiv link mono in corner. **Thread cover for the paper announcement.**

#### A4 · **"Plain English"** (5s)
A typing cursor types out a messy human question: `"profitable arb route for USDC, give me the contracts"`. The line holds. Droplet appears, snaps its arm (sparkle), and the messy text dissolves into clean structured JSON beside it. **The translation promise.**

#### A5 · **"Sleeping → Woke"** (3s, gag)
Droplet sleeping in `rest` pose, snore-sparkles drifting. A `POST /ask` notification slides in. Droplet's eyes pop open, jumps into `hero` pose with coin and brace fully equipped. Hard cut. **The "we never sleep" / always-on infra brag.**

#### A6 · **"Pixel Materialize" avatar loop** (2s)
Scattered pixel cloud → assembles into the droplet → waves once → loops. Use as the official Suize Twitter avatar / profile GIF / login screen splash. **Identity asset.**

#### A7 · **"Latency challenge"** (3s)
Big mono number tickers down: `247ms → 198ms → 174ms → 158ms`. Droplet in corner sweating one frame, then thumbs-up the next. **Live latency brag — re-record weekly with real numbers.**

#### A8 · **"The Tap"** (4s)
Three agent silhouettes (just terminal cursors with different colors) walk up to the droplet in sequence. Each taps the droplet, receives a JSON object and a coin-slot ding. **MCP discovery / many-agents-one-endpoint card.**

#### A9 · **"Pipeline reveal"** (10s, paper thread cover)
The 5-layer Objectomics pipeline animates left-to-right:
1. PTBs streaming from a checkpoint icon
2. Decomposed to atom shapes
3. Type-quotient clustering (atoms snap to clusters)
4. Cluster labels appear one by one
5. English question answers on the right
Droplet floats above the pipeline. Thought-bubble text appears: *"Every object writes its own autobiography."* **Long-form thread cover, also embed it on the paper landing page.**

#### A10 · **"Mystery protocol"** (8s, demo)
Three mystery boxes labeled `???` slide in. They open in sequence revealing real protocol names judges might shout. Droplet labels each one with its emergent cluster within ~1 second per box (visible latency counter). End frame: *"Type-quotient convergence. Live on testnet."* **Hackathon demo bait — Sui Overflow judges will share this.**

### Animation discipline (do/don't)

| ✅ Do | ❌ Don't |
|---|---|
| Hold the mascot canon — use existing `Droplet.jsx` poses | Redraw the mascot in different styles |
| Animate at 30fps for video, 24fps for GIF | Animate at 60fps (Twitter recompresses; wasted bits) |
| One narrative beat per scene (~3 visual events max) | Cram 6 scenes into a 10s reel |
| End on a held frame (300ms freeze) for screenshot-ability | Cut mid-motion (people screenshot the worst frame) |
| Quiet sound or silent — Twitter autoplays muted | Music — most viewers never unmute |
| Lock the carbon-blue palette across every scene | Introduce a new accent color per scene |
| Easing curves: `cubic-bezier(0.16, 1, 0.3, 1)` for entrances, springs for interactions | Linear interpolation (reads as robotic SaaS animation) |

### Production cadence

- **Week 1:** Scaffold `marketing/video/`, ship A1 (Ritual), A2 (Coin Drop), A6 (Avatar loop). Pin Ritual on profile, set avatar to A6.
- **Week 2:** A4 (Plain English), A5 (Sleeping→Woke), A7 (Latency).
- **Week 3:** A3 (Cluster Bloom), A8 (The Tap).
- **Week 4 (paper drop):** A9 (Pipeline reveal), A10 (Mystery protocol).
- **Ongoing:** A7 (Latency) re-recorded weekly with fresh numbers. A2 (Coin Drop) reposted with every receipt thread.

### Animated SVG fallbacks (for non-video surfaces)

Some surfaces (Twitter cards, README badges, GitHub social previews, embed previews) won't play video. For those:

- **SMIL/CSS-animated SVG** — the existing `Droplet.jsx` already does this. Export a static `droplet-animated.svg` with the same CSS keyframes inlined for use in `<img src=…>` contexts.
- **APNG** for stickers when GIF compression butchers the palette.
- **WebP animated** — better than GIF, worse than video. Discord/Slack-friendly.

These are *fallbacks*, not primary outputs. Don't build the pipeline around them.

---

## 11. Inspirations (study, don't copy)

- **Anthropic / Claude / Clawd** — quiet humanity, terminal-native mascot, emotion via pose. The closest analog. Steal the cadence, not the colors.
- **Pudgy Penguins** — mascot vocabulary, sticker-first, mainstream merch path. Aspiration tier for the droplet long-term.
- **Stripe** — documentation as marketing, editorial tech aesthetic, never gimmicky. The bar for engineer-credibility cards.
- **Linear** — changelog cards, restrained palette, the headline does the work.
- **Olas (@autonolas)** — agent-economy narrative, weekly receipts, meta-narrative ("written by agents"). Closest playbook match.
- **a16z crypto** — "orange ball" mystery launches. Information density inverted — mystery > details. Use sparingly.

---

## Appendix — The one-sentence test for every post

> "If this tweet got pulled out of context and shown to a senior crypto engineer five years from now, would it read as a useful infrastructure announcement, a credible paper tease, or a real receipt — or would it read as marketing fluff?"

If the answer trends toward fluff, rewrite or kill.

---

*Last updated: 2026-05-27. Owned by founder + Nox. Update when the narrative shifts, the mascot vocabulary expands, or a card pattern fails to land twice in a row.*
