# deploy_sui (Move package)

The on-chain half of Suize Deploy, published on Sui mainnet at
[`0xec2dcd65…`](https://suivision.xyz/package/0xec2dcd65271127019351678ddd05287176a0b9b7fc59ef6ceef34fdbc36e87db).

| Module | What it owns |
|---|---|
| `site` | The `Site` object (shared; its `owner` field is the recovered payer, "whoever pays, owns"), the settled-payment digest registry (replay wall: one site or extension per payment), `create_site` / `extend_site` / owner-only `delete_site`. |
| `domain_registry` | Custom-domain records: which domain points at which Site, repointable by the owner. |
| `allowlist` | Seal access control for private sites: the on-chain viewer list plus the `AllowlistCap` held by the site owner. |
| `version` | Package version gate for upgrade safety. |

Conventions: Move edition 2024. Abort codes are a public contract, scoped per module,
never renumbered. Cap possession is the auth for admin functions; site ownership is the
`owner` field, enforced explicitly (`delete_site` aborts unless the sender is the owner).

```bash
sui move test   # 26 tests
```
