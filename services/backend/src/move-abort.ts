// MoveAbort parsing — ONE place that turns a Sui execution-failure string into
// `{ module, code }` so callers can map on-chain abort codes (a PUBLIC CONTRACT,
// per CLAUDE.md — never renumbered) onto HTTP statuses / relayer decisions.
//
// The failure string (from `effects.status.error`, and echoed in thrown
// dry-run/execution errors) looks like:
//   MoveAbort(MoveLocation { module: ModuleId { address: <hex>, name:
//     Identifier("charge_ledger") }, function: 3, instruction: 11,
//     function_name: Some("record_charge") }, 0) in command 1
// We extract the MODULE name (the first Identifier) and the abort CODE (the
// integer after the MoveLocation closes).

export interface MoveAbort {
  /** The aborting Move module name (e.g. "account", "charge_ledger"). */
  module: string;
  /** The abort code — scoped per module (see each package's abort contract). */
  code: number;
}

/** Parse a MoveAbort out of an execution-failure string, or null if it isn't one. */
export const parseMoveAbort = (error: string): MoveAbort | null => {
  const m = /MoveAbort\(MoveLocation \{.*?Identifier\("([^"]+)"\).*?\},\s*(\d+)\)/.exec(error);
  if (!m) return null;
  return { module: m[1]!, code: Number(m[2]!) };
};
