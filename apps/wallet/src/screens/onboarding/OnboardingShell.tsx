/**
 * Onboarding — the first-run state machine, FOUR beats (SPEC §1.5):
 *   hello -> name -> strategy -> setup -> onDone({ name, strategy })
 *
 *   1. hello    — modern clean reveal of the welcome headline (no macro anim)
 *   2. name     — pick a simple name: <name>@suize (debounced availability)
 *   3. strategy — Safe (default) / Risky choice cards (no AI explanation)
 *   4. setup    — the calm Loader, runs the stubbed bootstrap, hands to Home
 *
 * NO marketing prose, NO Fund/Dial/Authorize steps — the agent sandbox is set up
 * later, from inside the wallet. The strategy choice made here maps to which
 * mandate is minted (SAFE=navi, RISKY=swap) behind the data seam.
 *
 * Public API (locked — the App shell + `?mock=` capture states line up on it):
 *   OnboardingShell { name?, startBeat?, hold?, onDone(result) }
 *   where result: OnboardingResult = { name, strategy }
 */

import { useEffect, useState } from 'react';
import type { Strategy } from '../../data/types';
import { StepHello } from './StepHello';
import { StepName } from './StepName';
import { StepStrategy } from './StepStrategy';
import { StepSettingUp } from './StepSettingUp';

/** The four onboarding beats, in order. */
export type OnboardingBeat = 'hello' | 'name' | 'strategy' | 'setup';

/** What onboarding produces — threaded into the (stubbed) bootstrap. */
export interface OnboardingResult {
  /** the chosen <name> (the part before @suize). */
  name: string;
  /** the chosen risk strategy (drives which mandate is minted later). */
  strategy: Strategy;
}

export interface OnboardingShellProps {
  /** optional pre-filled name suggestion. */
  name?: string;
  /** entry beat — used by the `?mock=` capture states; defaults to 'hello'. */
  startBeat?: OnboardingBeat;
  /** freeze on the entered beat (the `?mock=` capture states) — no auto-advance. */
  hold?: boolean;
  /** called once setup completes, with the user's choices. */
  onDone: (result: OnboardingResult) => void;
}

export function OnboardingShell({
  name: initialName = '',
  startBeat = 'hello',
  hold = false,
  onDone,
}: OnboardingShellProps) {
  const [beat, setBeat] = useState<OnboardingBeat>(startBeat);
  const [name, setName] = useState(initialName);
  const [strategy, setStrategy] = useState<Strategy>('safe'); // Safe is the default selection

  // hello auto-advances to the name field after a calm beat — unless we're
  // holding a single beat for an isolated `?mock=` capture.
  useEffect(() => {
    if (hold || beat !== 'hello') return;
    const t = setTimeout(() => setBeat('name'), 2400);
    return () => clearTimeout(t);
  }, [hold, beat]);

  if (beat === 'hello') {
    return <StepHello />;
  }

  if (beat === 'name') {
    return (
      <StepName
        value={name}
        onChange={setName}
        onNext={(n) => {
          setName(n);
          setBeat('strategy');
        }}
      />
    );
  }

  if (beat === 'strategy') {
    return (
      <StepStrategy
        value={strategy}
        onSelect={setStrategy}
        onNext={() => setBeat('setup')}
      />
    );
  }

  // setup: the loader runs while the REAL handle issuance happens (StepSettingUp
  // claims `<name>@suize`, gasless), then hands off to Home. `hold` parks it for
  // the dev-only `?preview=setup` capture (no real claim fires while held).
  return <StepSettingUp name={name} onComplete={() => onDone({ name, strategy })} hold={hold} />;
}
