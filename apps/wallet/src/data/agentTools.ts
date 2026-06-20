/**
 * The agent tool contract — the seam between the wallet's verbs (WalletDeck, which
 * holds useAccount / useAgent / useSubscriptions) and the chat UI (Assistant, which
 * renders the confirm card + drives the brain loop).
 *
 * The brain (backend) proposes a tool; the Assistant calls `runAgentTool(tool, input)`;
 * the WALLET decides what to do:
 *   • READS answer instantly → an `immediate` result the model reads.
 *   • WRITES return a `card` PLAN — the decoded on-chain details + a `commit()` that
 *     actually signs + executes LOCALLY. The Assistant shows the card; only on the
 *     user's tap does it call commit(). This is where the number wall lands on the
 *     client: the AMOUNT/recipient shown + signed are computed HERE from the user's
 *     request, never taken as authoritative from the model.
 */

/** The result of running one agent tool. */
export type ToolRun =
  | {
      /** answered immediately (a read, or a validation/decline) — no confirm card. */
      kind: 'immediate';
      /** short plain-text result the model reads back. */
      content: string;
      /** true marks a failure/decline the model should acknowledge (not retry). */
      isError?: boolean;
      /** an AUTO-APPROVED money action (no card) still drops a visible ✓ receipt in the
       *  chat so the user always SEES what moved (title + a meta line, e.g. "$5.00 · auto").
       *  `digest` (when on-chain) anchors the receipt's explorer link. */
      receipt?: { title: string; meta?: string; digest?: string };
    }
  | {
      /** a money action — the Assistant shows a confirm card before anything happens. */
      kind: 'card';
      /** card heading, e.g. "Send to alice@suize". */
      title: string;
      /** optional one-line caption under the title. */
      subtitle?: string;
      /** the decoded on-chain details (recipient, amount, fee, …) shown on the card. */
      rows: { k: string; v: string }[];
      /** the confirm button label, e.g. "Send". */
      cta: string;
      /** signs + executes the action LOCALLY; resolves to `{ message, digest? }` — `message`
       *  is the short success line the model reads back, `digest` (when on-chain) anchors the
       *  receipt's explorer link. Throws on failure. Called ONLY after the user taps. `onStep`
       *  (optional) reports live progress for slow actions (e.g. a deploy: building payment →
       *  authorizing → publishing) so the working state is legible. */
      commit: (onStep?: (label: string) => void) => Promise<{ message: string; digest?: string }>;
    };

/** Run an agent tool by name with its (model-proposed) input. */
export type AgentToolRunner = (
  tool: string,
  input: Record<string, unknown>,
) => Promise<ToolRun>;
