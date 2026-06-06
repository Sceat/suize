/**
 * JournalHome — the WIRING container that composes the journal leaves into the
 * JournalShell. It threads the SAME `home: HomeApi` to every leaf, owns the
 * SELECTED-account state (which account's detail fills the right pane), and computes
 * the presence from real account state.
 *
 * App.tsx renders THIS for the `home` phase, on the EXISTING auth / WS / Enoki /
 * onboarding flow — nothing else changes.
 *
 * ── LAYOUT MODEL ────────────────────────────────────────────────────────────────
 * Each account owns its detail. Selecting (clicking) an account card fills the right
 * pane with that account's view:
 *   main   → MainAccountView (currencies held + Add money / Send / Convert)
 *   spend  → SpendingChat    (the AI Spending chat — USDC only)
 *   invest → InvestingStrategies (the split-bar + per-tier steppers)
 * The activity LOG is a persistent corner widget (CornerLog), not a section.
 *
 * ── PRESENCE (real account state) ───────────────────────────────────────────────
 * Presence reflects the live account state — which AI sub accounts are on (not
 * paused) and whether the activity log has rows. A paused AI account's detail shows
 * its calm "turned off" line.
 */
import { useCallback, useMemo, useState } from 'react';
import type { HomeApi } from '../data/types';
import { JournalShell, type JournalPresence } from './JournalShell';
import {
  AccountLedger,
  type DrawerKey,
} from '../components/journal/AccountDrawer';
import { JournalBalanceHero } from '../components/journal/JournalBalanceHero';
import { MainAccountView } from '../components/journal/MainAccountView';
import { SpendingChat } from '../components/SpendingChat';
import { InvestingStrategies } from '../components/InvestingStrategies';
import { CornerLog } from '../components/journal/CornerLog';
import { MoveMoney } from '../components/MoveMoney';

export interface JournalHomeProps {
  /** the data hook result (useHome). */
  home: HomeApi;
  /**
   * DEV-ONLY design preview flag. `true` ONLY under the `?preview` hatch (App.tsx,
   * import.meta.env.DEV) → the seed-bearing leaves (SpendingChat, InvestingStrategies,
   * CornerLog) render the populated sample design. ALWAYS `false` in production → those
   * leaves show honest states (real/empty), never fabricated activity/positions/P&L.
   */
  demo: boolean;
}

export function JournalHome({ home, demo }: JournalHomeProps) {
  const { state } = home;

  // Which account card is selected — its detail fills the right pane. Default: Main.
  const [selected, setSelected] = useState<DrawerKey>('main');

  // Presence from real account state: AI accounts on (not paused) + activity present.
  const presence = useMemo<JournalPresence>(
    () => ({
      spending: !state.spending.paused,
      investing: !state.investing.paused,
      activity: state.log.length > 0,
    }),
    [state.spending.paused, state.investing.paused, state.log.length],
  );

  const onSelect = useCallback((key: DrawerKey) => setSelected(key), []);

  return (
    <JournalShell
      home={home}
      selected={selected}
      presence={presence}
      slots={{
        balanceHero: <JournalBalanceHero totalUsd={state.totalUsd} />,
        accountLedger: (
          <AccountLedger home={home} selected={selected} onSelect={onSelect} />
        ),
        mainView: <MainAccountView home={home} />,
        spendingChat: <SpendingChat home={home} demo={demo} />,
        investingStrats: <InvestingStrategies home={home} demo={demo} />,
        cornerLog: <CornerLog entries={state.log} demo={demo} />,
        overlays: <MoveMoney home={home} />,
      }}
    />
  );
}

export default JournalHome;
