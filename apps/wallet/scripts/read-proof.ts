import { SuiGrpcClient } from '@mysten/sui/grpc'
import { graphqlUrl, grpcUrl } from '@suize/shared'
import { loadKiosks, loadOwnedSections, loadTokens } from '../src/data/wallet'

const address =
  process.argv[2] ?? '0x9036f4be5ca0d0c2b890f12b398c032a00952aa41c2776507db0d018002373a7'
const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: grpcUrl('mainnet') })

console.log(`Read pipeline address: ${address}`)
console.log('Network: Sui mainnet')

const [tokens, owned, kiosks] = await Promise.all([
  loadTokens(client, address),
  loadOwnedSections(graphqlUrl('mainnet'), address),
  loadKiosks(client, graphqlUrl('mainnet'), address),
])

const proof = {
  tokens: tokens.length,
  nfts: owned.nfts.length,
  kioskItems: kiosks.items.length,
  objects: owned.objects.length,
}

console.log(`Tokens: ${proof.tokens}`)
console.log(`NFTs: ${proof.nfts}`)
console.log(`Kiosk items: ${proof.kioskItems}`)
console.log(`Objects: ${proof.objects}`)
for (const item of kiosks.items) {
  const ok = !!item.imageUrl && /^https?:\/\//i.test(item.imageUrl)
  console.log(`Kiosk image [${ok ? 'OK' : 'MISSING'}] ${item.name}: ${item.imageUrl ?? '(none)'}`)
}
console.log(`PROOF_JSON=${JSON.stringify(proof)}`)
