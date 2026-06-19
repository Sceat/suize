#[test_only]
module trace::trace_tests {
    use trace::trace;

    /// a valid 32-byte (sha256-shaped) digest
    fun h32(): vector<u8> {
        x"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
    }

    #[test]
    fun anchor_ok() {
        let ctx = sui::tx_context::dummy();
        trace::anchor(b"walrus-blob-id", h32(), 7, &ctx);
    }

    #[test]
    // abort_code 0 == EBadHash (the public abort contract)
    #[expected_failure(abort_code = 0)]
    fun anchor_rejects_short_hash() {
        let ctx = sui::tx_context::dummy();
        trace::anchor(b"walrus-blob-id", x"deadbeef", 1, &ctx);
    }

    #[test]
    fun seal_approve_self_ok() {
        let ctx = sui::tx_context::dummy();
        // the owner unlocks their own identity (id == their address bytes)
        let me = sui::address::to_bytes(ctx.sender());
        trace::seal_approve(me, &ctx);
    }

    #[test]
    // abort_code 1 == ENoAccess
    #[expected_failure(abort_code = 1)]
    fun seal_approve_rejects_other() {
        let ctx = sui::tx_context::dummy();
        // a different identity than the requester → denied
        trace::seal_approve(b"some-other-identity-not-the-sender", &ctx);
    }
}
