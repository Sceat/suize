/**
 * AccountLedger — the §02 "three accounts" body (re-export).
 *
 * The ledger lives alongside AccountDrawer (it composes three of them + threads the
 * HomeApi) so the drawer↔ledger seam stays in one file. This module re-exports it at
 * the path the port plan named, so JournalShell can import either entry point.
 *
 * Renders into JournalShell's `accountLedger` slot. See AccountDrawer.tsx for wiring.
 */
export { AccountLedger as default, AccountLedger } from './AccountDrawer';
export type { AccountLedgerProps, DrawerKey } from './AccountDrawer';
