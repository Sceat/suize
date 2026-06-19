/// Suize — the trace module: the on-chain half of the PAY wallet's PRIVATE,
/// user-owned conversation + action history (the "verifiable agent activity log").
///
/// Two responsibilities, both tiny:
///
/// 1. `anchor` — emit a tamper-proof COMMITMENT to one flush of the user's history:
///    the Walrus `blob_id`, the `content_hash` (sha256 of the canonical plaintext),
///    the entry `count`, and the epoch. No content, no PII ever touches the chain.
///    `owner = ctx.sender()` — the anchor IS the ownership source of truth; no one can
///    forge another user's anchor (the signature is the authorization). The user's
///    wallet session signs it; the backend only SPONSORS the gas.
///
/// 2. `seal_approve` — the Seal access-control policy. The full history blob is
///    encrypted CLIENT-SIDE with Mysten **Seal** (threshold IBE) to the owner's
///    identity (their address bytes). Seal's key servers DRY-RUN this entry with the
///    REQUESTER as sender before releasing key shares; it aborts unless the requester
///    is that owner. So only YOU can unlock YOUR history — Suize never holds the key.
///
/// NUMBER-WALL NOTE (load-bearing): the trace is WRITE-ONLY from the AI brain's
/// perspective — an action LOG, never a source the LLM reads on-chain numbers from.
/// Never feed trace history back into the model as an authoritative amount/address;
/// the deterministic core re-derives every on-chain number regardless.
module trace::trace {
    use sui::event;

    /// Abort contract (PUBLIC — never renumber, scoped per module):
    /// 0 = EBadHash    — `content_hash` was not a 32-byte sha256 digest.
    /// 1 = ENoAccess   — the Seal requester is not the owner of this identity.
    const EBadHash: u64 = 0;
    const ENoAccess: u64 = 1;

    /// The on-chain commitment to one flush of a user's encrypted history blob.
    public struct TraceAnchored has copy, drop {
        owner: address,
        blob_id: vector<u8>,
        content_hash: vector<u8>,
        count: u64,
        epoch: u64,
    }

    /// Anchor a history segment: emit a tamper-proof commitment owned by the signer.
    /// - `blob_id`      — the Walrus blob id of the Seal-encrypted rolling history segment
    /// - `content_hash` — sha256 of the canonical plaintext (exactly 32 bytes, asserted)
    /// - `count`        — entries in the segment (monotonic per owner by client
    ///                    discipline; a verifier picks max(count))
    public fun anchor(
        blob_id: vector<u8>,
        content_hash: vector<u8>,
        count: u64,
        ctx: &TxContext,
    ) {
        assert!(content_hash.length() == 32, EBadHash);
        event::emit(TraceAnchored {
            owner: ctx.sender(),
            blob_id,
            content_hash,
            count,
            epoch: ctx.epoch(),
        });
    }

    /// Seal access-control policy (owner-only). Seal key servers call this via a
    /// dry-run with the REQUESTER as the transaction sender; it MUST abort to deny.
    /// The data is encrypted to the owner's identity = their 32-byte address, so a
    /// requester may unlock iff `id == their own address bytes`. Suize cannot pass
    /// this for you — only your zkLogin session can sign a request as your address.
    entry fun seal_approve(id: vector<u8>, ctx: &TxContext) {
        assert!(id == sui::address::to_bytes(ctx.sender()), ENoAccess);
    }
}
