/**
 * JournalHome — the WIRING container that composes the journal leaves into the
 * JournalShell. It threads the SAME `home: HomeApi` to every leaf, owns the
 * SELECTED-account state (which account's detail fills the right pane), and computes
 * the demo presence.
 *
 * App.tsx renders THIS for the `home` phase, on the EXISTING auth / WS / Enoki /
 * onboarding flow — nothing else changes.
 *
 * ── LAYOUT MODEL ────────────────────────────────────────────────────────────────
 * Each account owns its detail. Selecting (clicking) an account card fills the right
 * pane with that account's view:
 *   main   → MainAccountView (currencies held + Add funds / Send / Convert)
 *   spend  → SpendingChat    (the AI Spending chat — USDC only)
 *   invest → InvestingStrategies (toggles + percent sliders)
 * The activity LOG is a persistent corner widget (CornerLog), not a section.
 *
 * ── PRESENCE (demo harness) ─────────────────────────────────────────────────────
 * The Fresh / In-use ribbon is a dev/demo harness: 'used' = both AI sub accounts on;
 * 'fresh' = both off (their details show a calm "turned off" line). It never mutates
 * real on-chain state.
 */
import { useCallback, useMemo, useState } from 'react';
import type { HomeApi } from '../data/types';
import {
  JournalShell,
  type JournalDemoMode,
  type JournalPresence,
} from './JournalShell';
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
}

export function JournalHome({ home }: JournalHomeProps) {
  const { state } = home;

  // Which account card is selected — its detail fills the right pane. Default: Main.
  const [selected, setSelected] = useState<DrawerKey>('main');

  // The demo ribbon mode (mirrors the shell's ribbon so presence stays coherent).
  const [demoMode, setDemoMode] = useState<JournalDemoMode>('used');

  const presence = useMemo<JournalPresence>(() => {
    if (demoMode === 'fresh') {
      return { spending: false, investing: false, activity: false };
    }
    if (demoMode === 'used') {
      return { spending: true, investing: true, activity: true };
    }
    return {
      spending: !state.spending.paused,
      investing: !state.investing.paused,
      activity: state.log.length > 0,
    };
  }, [demoMode, state.spending.paused, state.investing.paused, state.log.length]);

  const onDemoChange = useCallback((m: JournalDemoMode) => setDemoMode(m), []);
  const onSelect = useCallback((key: DrawerKey) => setSelected(key), []);

  return (
    <JournalShell
      home={home}
      selected={selected}
      presence={presence}
      onDemoChange={onDemoChange}
      slots={{
        balanceHero: (
          <JournalBalanceHero
            totalUsd={state.totalUsd}
            showDemoDelta={demoMode === 'used'}
          />
        ),
        accountLedger: (
          <AccountLedger home={home} selected={selected} onSelect={onSelect} />
        ),
        mainView: <MainAccountView home={home} />,
        spendingChat: <SpendingChat home={home} />,
        investingStrats: <InvestingStrategies home={home} />,
        cornerLog: <CornerLog entries={state.log} />,
        overlays: <MoveMoney home={home} />,
      }}
    />
  );
}

export default JournalHome;
