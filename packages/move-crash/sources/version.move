/// Version gate for the Crash Sui router.
///
/// A single shared `Version` object carries the live package version. Every
/// user-facing router function takes `&Version` and calls `assert_latest()`
/// first, so a stale code path can be locked out after an upgrade, and admin can
/// emergency-freeze every user action at once by zeroing the version.
///
/// `router` depends on `version` (it imports `Version` and creates the singleton
/// in `init`). To avoid a dependency CYCLE this module must NOT reference
/// `router` — in particular it cannot see `router::AdminCap`. So the cap-gated
/// lifecycle entrypoints (`migrate`, `freeze_all`) live in `router` and call the
/// `public(package)` primitives below. This module exposes only the `Version`
/// type, `assert_latest`, a value read, the constructor `router::init` uses, and
/// the package-internal mutators the router wraps behind the cap.
module crash_sui::version;

/// Version the published code expects. Bump on every upgrade that changes
/// version-gated behavior, then call `router::migrate` to lift the shared value.
const PACKAGE_VERSION: u64 = 2;

/// Shared `Version` mismatches the code (frozen, or awaiting `migrate`).
const EVERSION_MISMATCH: u64 = 101;

/// Shared object holding the live version. `value == PACKAGE_VERSION` is "open";
/// any other value (notably `0` after a freeze) is "locked".
public struct Version has key {
    id: UID,
    value: u64,
}

/// First line of every version-gated router function. Aborts when frozen or when
/// a stale package version is in play.
public fun assert_latest(self: &Version) {
    assert!(self.value == PACKAGE_VERSION, EVERSION_MISMATCH);
}

/// Current version value (off-chain inspection / tests).
public fun value(self: &Version): u64 {
    self.value
}

/// Create + share the `Version` singleton at `PACKAGE_VERSION`. Called by
/// `router::init` at publish time. Shared here because `Version` has only `key`,
/// so `share_object` is restricted to this declaring module.
public(package) fun create_and_share(ctx: &mut TxContext) {
    transfer::share_object(Version { id: object::new(ctx), value: PACKAGE_VERSION });
}

/// Lift the shared `Version` to `PACKAGE_VERSION` after an upgrade. Asserts the
/// stored value is strictly older to avoid double-migrating. Cap-gated by
/// `router::migrate`.
public(package) fun do_migrate(self: &mut Version) {
    assert!(self.value < PACKAGE_VERSION, EVERSION_MISMATCH);
    self.value = PACKAGE_VERSION;
}

/// Emergency freeze: zero the version so `assert_latest()` fails for all
/// version-gated functions. Cap-gated by `router::freeze_all`.
public(package) fun do_freeze(self: &mut Version) {
    self.value = 0;
}

// === Tests ===

#[test_only]
use sui::test_scenario;

#[test_only]
/// Standalone `Version` at `PACKAGE_VERSION` (the real one is created by
/// `router::init`).
public fun test_make_version(ctx: &mut TxContext): Version {
    Version { id: object::new(ctx), value: PACKAGE_VERSION }
}

#[test_only]
fun destroy_for_test(v: Version) {
    let Version { id, value: _ } = v;
    id.delete();
}

#[test]
fun test_assert_latest_passes_at_current() {
    let mut scenario = test_scenario::begin(@0xA);
    let v = test_make_version(scenario.ctx());
    v.assert_latest();
    assert!(v.value() == PACKAGE_VERSION, 0);
    destroy_for_test(v);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EVERSION_MISMATCH)]
fun test_assert_latest_fails_when_frozen() {
    let mut scenario = test_scenario::begin(@0xA);
    let mut v = test_make_version(scenario.ctx());
    v.do_freeze();
    v.assert_latest(); // aborts EVERSION_MISMATCH
    destroy_for_test(v);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EVERSION_MISMATCH)]
fun test_migrate_rejects_when_already_current() {
    let mut scenario = test_scenario::begin(@0xA);
    let mut v = test_make_version(scenario.ctx());
    // value already == PACKAGE_VERSION, so do_migrate must abort (not < current).
    v.do_migrate();
    destroy_for_test(v);
    scenario.end();
}
