/// Minimal upgrade gate for the `deploy_sui` package.
///
/// A single shared `Version` object carries the live package version. Every
/// state-changing function across `site` and `domain_registry` takes
/// `&Version` and calls `assert_version()` first, so a stale code path can be
/// locked out after an upgrade. `init` creates + shares the singleton at publish
/// time (so the gate is live from block one) and hands the `AdminCap` — the only
/// authority that can `migrate` or `freeze` the version — to the publisher (the
/// deploy service wallet).
///
/// Unlike `crash_sui`, there is no dependency cycle to avoid here: `version`
/// owns its own `AdminCap` and the cap-gated lifecycle entrypoints (`migrate`,
/// `freeze`) live in THIS module, and the other modules only ever import the
/// `Version` type + `assert_version`.
module deploy_sui::version;

/// Version the published code expects. Bump on every upgrade that changes
/// version-gated behavior, then call `migrate` to lift the shared value.
const PACKAGE_VERSION: u64 = 1;

// === Errors ===
// Abort codes are part of this package's public contract: tests pattern-match on
// the exact code. Do NOT renumber.

/// The shared `Version` does not match the running code (frozen after a
/// `freeze`, or awaiting `migrate` after an upgrade).
const EWrongVersion: u64 = 0;

// === Structs ===

/// Shared object holding the live version. `value == PACKAGE_VERSION` is "open";
/// any other value (notably `0` after a freeze) is "locked".
public struct Version has key {
    id: UID,
    value: u64,
}

/// Capability gating the version lifecycle (`migrate` / `freeze`). Held by the
/// publisher (the deploy service wallet); authority is the cap itself — no
/// address check. `store` so it can be held in a custody object if ever needed.
public struct AdminCap has key, store {
    id: UID,
}

// === Init ===

/// Publish-time setup: create + share the `Version` singleton at
/// `PACKAGE_VERSION` (value 1), and hand the `AdminCap` to the publisher.
fun init(ctx: &mut TxContext) {
    transfer::share_object(Version { id: object::new(ctx), value: PACKAGE_VERSION });
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

// === Gate ===

/// First line of every version-gated function. Aborts `EWrongVersion` when the
/// shared value does not match the running code (frozen, or stale).
public fun assert_version(self: &Version) {
    assert!(self.value == PACKAGE_VERSION, EWrongVersion);
}

/// Current version value (off-chain inspection / tests).
public fun value(self: &Version): u64 {
    self.value
}

// === Lifecycle (AdminCap-gated; deliberately NOT version-gated) ===
//
// NOT version-gated so admin recovery — notably `migrate` after a freeze —
// always works even while the package is frozen.

/// Lift the shared `Version` to the code's `PACKAGE_VERSION` after an upgrade.
/// Asserts the stored value is strictly older to avoid double-migrating.
public fun migrate(_: &AdminCap, self: &mut Version) {
    assert!(self.value < PACKAGE_VERSION, EWrongVersion);
    self.value = PACKAGE_VERSION;
}

/// Emergency freeze: zero the version so `assert_version()` fails for every
/// version-gated function at once. (`freeze` is a reserved name in Move, hence
/// `freeze_version`.)
public fun freeze_version(_: &AdminCap, self: &mut Version) {
    self.value = 0;
}

// === Test helpers ===

#[test_only]
/// Standalone shared `Version` + `AdminCap` to the sender, mirroring what `init`
/// does, for other modules' tests. The real ones are created by `init` at
/// publish time.
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx);
}

#[test_only]
/// Standalone `Version` at `PACKAGE_VERSION` (no sharing) for unit tests.
public fun new_version_for_testing(ctx: &mut TxContext): Version {
    Version { id: object::new(ctx), value: PACKAGE_VERSION }
}

#[test_only]
/// Drop a test `Version` (it has only `key`, so it cannot be implicitly dropped).
public fun destroy_version_for_testing(v: Version) {
    let Version { id, value: _ } = v;
    id.delete();
}

// === Tests ===

#[test_only]
use sui::test_scenario;

#[test]
fun test_init_shares_version_and_gives_admin_cap() {
    let publisher = @0xA;
    let mut scenario = test_scenario::begin(publisher);

    { init(scenario.ctx()); };

    scenario.next_tx(publisher);
    {
        let v = scenario.take_shared<Version>();
        let cap = scenario.take_from_sender<AdminCap>();
        assert!(v.value() == PACKAGE_VERSION, 0);
        v.assert_version();
        scenario.return_to_sender(cap);
        test_scenario::return_shared(v);
    };

    scenario.end();
}

#[test]
fun test_assert_version_passes_at_current() {
    let mut scenario = test_scenario::begin(@0xA);
    let v = new_version_for_testing(scenario.ctx());
    v.assert_version();
    destroy_version_for_testing(v);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EWrongVersion)]
fun test_assert_version_fails_when_frozen() {
    let publisher = @0xA;
    let mut scenario = test_scenario::begin(publisher);
    { init(scenario.ctx()); };

    scenario.next_tx(publisher);
    {
        let mut v = scenario.take_shared<Version>();
        let cap = scenario.take_from_sender<AdminCap>();
        cap.freeze_version(&mut v);
        v.assert_version(); // aborts EWrongVersion
        scenario.return_to_sender(cap);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EWrongVersion)]
fun test_migrate_rejects_when_already_current() {
    let publisher = @0xA;
    let mut scenario = test_scenario::begin(publisher);
    { init(scenario.ctx()); };

    scenario.next_tx(publisher);
    {
        let mut v = scenario.take_shared<Version>();
        let cap = scenario.take_from_sender<AdminCap>();
        // value already == PACKAGE_VERSION, so migrate must abort (not < current).
        cap.migrate(&mut v);
        scenario.return_to_sender(cap);
        test_scenario::return_shared(v);
    };
    scenario.end();
}
