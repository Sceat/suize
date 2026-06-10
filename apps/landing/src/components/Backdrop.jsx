// ============================================================================
// <Backdrop> — the site-wide CLEAN EDITORIAL SURFACE. (Owner cut the global
// living-matter shader: "way too intense, it should not steal the focus that
// much; it'd feel like we found a shader and just posted our timeline on top.")
//
// So the page no longer sits on a focus-stealing matter field. The global
// backdrop is now a CALM, CLEAN surface — just the themed --bg-paper floor + a
// subtle film grain + a very faint vignette (all pure CSS in backdrop.css). No
// GL canvas, no cursor-warp, no scroll-travel behind the whole site. The rest
// of the page reads clean + editorial; the ONE matter moment now lives, bounded
// and dialed-back, inside the hero only (components/HeroScene).
//
// There is nothing to spin up here — the surface is static CSS — so reduced
// motion / touch / no-WebGL need no special path. The host just exists for the
// paper + grain + vignette layers to paint on, retinted per theme + the
// business room via backdrop.css.
// ============================================================================

export default function Backdrop() {
  return <div className="sx-bg" aria-hidden="true" />
}
