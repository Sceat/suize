// One page per product. The page IS the agent journey — a manually-stepped,
// deep-dive walkthrough. Each step carries its own detail + under-the-hood tech.
// Vision sold big; proof points stay literally true (claim ladder still governs).

export type Action = { label: string; href: string; primary?: boolean };

/** A piece of under-the-hood tech surfaced inside a journey step. */
export type StepTech = {
  kind: 'npm' | 'spec' | 'module' | 'endpoint' | 'primitive';
  label: string; // '@suize/x402' · 'subs::subscription' · 'POST /settle'
  note: string; // what it is / does, one line
  href?: string; // npm / suivision / docs
};

/** One step of the journey — a rich, presenter-advanced "slide". */
export type JourneyStep = {
  actor: string; // who acts
  title: string; // the action headline
  overview: string; // 1–2 sentences: what happens
  points: string[]; // the deep detail — what we extract, the response paths, the guarantees
  tech?: StepTech[]; // the under-the-hood for THIS step
  artifact?: { caption: string; body: string }; // optional code/JSON to show
};

/** A sub-product shown AFTER the core journey (e.g. the agents directory). */
export type SubProduct = {
  name: string;
  tagline: string;
  points: string[];
  actions?: Action[];
  tech?: StepTech[];
};

export type TrackPage = {
  id: string;
  tab: string;
  /** the product category / Sui ecosystem space */
  track: string;
  /** one-line framing of the space */
  trackline: string;
  productName: string;
  /** the big, ambitious pitch line */
  pitch: string;
  /** headline proof points — the meat, shown up top */
  proof: string[];
  /** the journey spine */
  journey: JourneyStep[];
  actions: Action[];
  /** show the live facilitator probe on this page */
  live?: boolean;
  /** sub-products shown after the journey */
  subProducts?: SubProduct[];
  /** the package suite + tech, shown with substance */
  stack: StepTech[];
  /** roadmap / what's next — at the very end */
  roadmap: string[];
};
