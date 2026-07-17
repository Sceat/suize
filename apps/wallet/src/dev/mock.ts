// Dev-only fixture for screenshotting the populated + searched wallet without a
// live wallet connection. Faithfully mirrors the real read of
// 0x9036…373a7 (19 tokens · 18 NFTs · 1 kiosk item · 415 objects, 404 of them
// VaporeonKeys drowning out one DeployerCap) so the global-search proof is real.
//
// Imported ONLY behind `import.meta.env.DEV && ?mock=1`; the dynamic import is
// dead-code-eliminated from production builds.
import type { DisplayItem, KioskData, OwnedSections, PlainObject, TokenBalance } from '../data/wallet'

export const MOCK_ADDRESS = '0x9036f4be5ca0d0c2b890f12b398c032a00952aa41c2776507db0d018002373a7'
export const MOCK_SUINS = 'suize.sui'

const DEPLOYER_CAP_ID = '0x235e9170233b6aaa022df9cd336b12f3de5d65ac6bbf88b42ff32f56b68df59c'
const SITE_PKG = '0xec2dcd65271127019351678ddd05287176a0b9b7fc59ef6ceef34fdbc36e87db'
const VAPOREON_PKG = '0x270f7a64af25345c30b2f52c59b34a7d3b71c71714b4371b494cc525a3500d8b'

// Deterministic 0x + 64-hex id generator so fixtures are stable across renders.
function hexId(seed: number): string {
  let x = (seed * 2654435761) >>> 0
  let out = ''
  while (out.length < 64) {
    x = (x * 1664525 + 1013904223) >>> 0
    out += x.toString(16).padStart(8, '0')
  }
  return `0x${out.slice(0, 64)}`
}

function token(
  symbol: string,
  name: string,
  decimals: number,
  balance: string,
  coinType: string,
  iconUrl: string | null = null,
): TokenBalance {
  return {
    coinType,
    balance,
    coinBalance: balance,
    addressBalance: '0',
    decimals,
    name,
    symbol,
    description: '',
    iconUrl,
  }
}

const TOKENS: TokenBalance[] = [
  token('SUI', 'Sui', 9, '184260000000', '0x2::sui::SUI'),
  token('USDC', 'USD Coin', 6, '412750000', '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'),
  token('WAL', 'Walrus', 9, '96400000000', '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL'),
  token('BB', 'BabyBlub', 6, '50000000000', '0xecdc81bd6e5a1b889d428d19c7949ff45708045d445c9f937c51e25bb85e39d0::bb::BB', 'https://api.movepump.com/uploads/photo_2024_08_25_21_43_55_25d7724dc1.jpeg'),
  token('BLUB', 'BLUB v2 (bridge at blubv2.com)', 2, '42000000', '0x5bba407b36a3700b47a3c95b303d737d00da70f6aa3f313aec5828dabccbf9cf::blub::BLUB'),
  token('BUBBLE', 'Bubble', 9, '2310000000000', '0x1111111111111111111111111111111111111111111111111111111111110001::bubble::BUBBLE'),
  token('BTCat', 'Bitcoin Cat', 0, '73', '0x1111111111111111111111111111111111111111111111111111111111110002::btcat::BTCAT'),
  token('DGG', 'Degen Gaming', 6, '5400000000', '0x1111111111111111111111111111111111111111111111111111111111110003::dgg::DGG'),
  token('GMB', 'Gamba', 9, '88000000000', '0x1111111111111111111111111111111111111111111111111111111111110004::gmb::GMB'),
  token('Grow', 'Grow', 6, '129000000', '0x1111111111111111111111111111111111111111111111111111111111110005::grow::GROW'),
  token('GSui', 'Ghost Sui', 3, '4210', '0x1111111111111111111111111111111111111111111111111111111111110006::gsui::GSUI'),
  token('HSUI', 'Haedal Sui', 9, '31200000000', '0x1111111111111111111111111111111111111111111111111111111111110007::hsui::HSUI'),
  token('MAYA', 'Maya', 0, '1200', '0x1111111111111111111111111111111111111111111111111111111111110008::maya::MAYA'),
  token('SBOX', 'Sui Box', 1, '905', '0x1111111111111111111111111111111111111111111111111111111111110009::sbox::SBOX'),
  token('VAPOREON', 'Vaporeon', 8, '640000000', `${VAPOREON_PKG}::vaporeon::VAPOREON`),
  token('XYZ', 'XYZ Protocol', 9, '7700000000', '0x111111111111111111111111111111111111111111111111111111111111000a::xyz::XYZ'),
  token('GMB2', 'Gomble', 9, '15000000000', '0x111111111111111111111111111111111111111111111111111111111111000b::gm::GMB'),
  token('REAP', 'Reap Token', 6, '2650000000', '0xde2d3e02ba60b806f81ee9220be2a34932a513fe8d7f553167649e95de21c066::reap_token::REAP_TOKEN'),
  token('SEND', 'Suisend', 6, '910000000', '0x111111111111111111111111111111111111111111111111111111111111000c::send::SEND'),
]

function nft(objectId: string, name: string, collection: string, type: string, imageUrl: string | null): DisplayItem {
  return { objectId, type, name, collection, description: null, imageUrl, publicTransfer: true }
}

const NFT_SEED: Array<[string, string, string, string | null]> = [
  ['💎 Admit One', 'liquid::Liquidpool', '0x63c0888eca9c6cd90eca97f9becdd73f24d96d604d8437c9759acacf779d5091::liquid::Liquidpool', 'https://i.ibb.co/hsRrPZm/t1-Phwf-O2-ZZYBhr8-Tnkx-GH8-Jw-Oe-Jr0-Vo0zdr-TTB9-8-Gn-ZOCl2-Ic-MH5-X5gs-O3-Hd-Fk-SBTg-Yn-Z0-Iy38-XU.gif'],
  ['aresrpg', 'profile::ProfileOwnerCap', '0xf45f752bc45dadff2ebc867c69af682c7192686d2455f655e2c54c9c75e95cff::profile::ProfileOwnerCap', 'https://arweave.net/N_lYIWAajj5IX_6B9CAVk1NV_zZmADL5uP7O1MzOkp4?ext=png'],
  ['aresrpg.sceat.sui', 'suins::SuinsRegistration', '0xd22b24490e0bae52676651b4f56660a5ff8022a2576e0089f79b3c88d44e08f0::suins_registration::SuinsRegistration', null],
  ['bitfinex.sceat.sui', 'suins::SuinsRegistration', '0xd22b24490e0bae52676651b4f56660a5ff8022a2576e0089f79b3c88d44e08f0::suins_registration::SuinsRegistration', null],
  ['cold.sceat.sui', 'suins::SuinsRegistration', '0xd22b24490e0bae52676651b4f56660a5ff8022a2576e0089f79b3c88d44e08f0::suins_registration::SuinsRegistration', null],
  ['Coonland', 'coonland::Coon', '0x2222222222222222222222222222222222222222222222222222222222220001::coonland::Coon', null],
  ['Liquidpool', 'liquid::Liquidpool', '0x63c0888eca9c6cd90eca97f9becdd73f24d96d604d8437c9759acacf779d5091::liquid::Liquidpool', null],
  ['NS Claim NFT', 'claim::ClaimNFT', '0x2222222222222222222222222222222222222222222222222222222222220002::claim::ClaimNFT', null],
  ['Quest 3 Rewards Live', 'quest::Reward', '0x2222222222222222222222222222222222222222222222222222222222220003::quest::Reward', null],
  ['sceat.sui', 'suins::SuinsRegistration', '0xd22b24490e0bae52676651b4f56660a5ff8022a2576e0089f79b3c88d44e08f0::suins_registration::SuinsRegistration', null],
  ['SEND Claim NFT', 'claim::ClaimNFT', '0x2222222222222222222222222222222222222222222222222222222222220004::claim::ClaimNFT', null],
  ['Sui Tickets', 'tickets::Ticket', '0x2222222222222222222222222222222222222222222222222222222222220005::tickets::Ticket', null],
  ['Suisses', 'suisses::Suisse', '0x2222222222222222222222222222222222222222222222222222222222220006::suisses::Suisse', null],
  ['suize.sui', 'suins::SuinsRegistration', '0xd22b24490e0bae52676651b4f56660a5ff8022a2576e0089f79b3c88d44e08f0::suins_registration::SuinsRegistration', null],
  ['Sweeb Discount Ticket', 'sweebs::Discount', '0x2222222222222222222222222222222222222222222222222222222222220007::sweebs::Discount', null],
  ['Sweeb Discount Ticket', 'sweebs::Discount', '0x2222222222222222222222222222222222222222222222222222222222220007::sweebs::Discount', null],
  ['treasury.suize.sui', 'suins::SuinsRegistration', '0xd22b24490e0bae52676651b4f56660a5ff8022a2576e0089f79b3c88d44e08f0::suins_registration::SuinsRegistration', null],
  ['Welcome to SuiWin', 'suiwin::Welcome', '0x2222222222222222222222222222222222222222222222222222222222220008::suiwin::Welcome', null],
]

const NFTS: DisplayItem[] = NFT_SEED.map(([name, collection, type, image], i) =>
  nft(hexId(90000 + i), name, collection, type, image),
)

function obj(objectId: string, type: string): PlainObject {
  return { objectId, type, publicTransfer: true }
}

// 11 distinct misc objects (real types; DeployerCap keeps its real id) + 404
// generated VaporeonKeys = 415, exactly like the live wallet.
const MISC_OBJECTS: PlainObject[] = [
  obj(DEPLOYER_CAP_ID, `${SITE_PKG}::site::DeployerCap`),
  obj(hexId(1), `${SITE_PKG}::version::AdminCap`),
  obj(hexId(2), '0x2::package::Publisher'),
  obj(hexId(3), '0x2::package::UpgradeCap'),
  obj(hexId(4), '0x2::kiosk::KioskOwnerCap'),
  obj(hexId(5), `0x2::display::Display<${VAPOREON_PKG}::vaporeon::Vaporeon>`),
  obj(hexId(6), '0x8572ff8c709a3d28723b665ba6d35aacc0040486349285515521b63d18f770c1::chess::Chess'),
  obj(hexId(7), '0xd441d82fa791d7e7fc89eb2a40b0714bd9a6a1aaf0c897d702802d30109c1f7b::final_winner::FinalWinner'),
  obj(hexId(8), '0xd441d82fa791d7e7fc89eb2a40b0714bd9a6a1aaf0c897d702802d30109c1f7b::final_winner::FinalWinner'),
  obj(hexId(9), '0x10786d3c5b9aa5ab3efb05dd7b349ad03e20c175d2995a8f895ad2145bf29a6e::lock::Lock<0xde2d3e02ba60b806f81ee9220be2a34932a513fe8d7f553167649e95de21c066::reap_token::REAP_TOKEN>'),
  obj(hexId(10), '0xe87f1b2d498106a2c61421cec75b7b5c5e348512b0dc263949a0e7a3c256571a::spool_account::SpoolAccount<0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf::reserve::MarketCoin<0x2::sui::SUI>>'),
]

const VAPOREON_KEYS: PlainObject[] = Array.from({ length: 404 }, (_, i) =>
  obj(hexId(1000 + i), `${VAPOREON_PKG}::vaporeon::VaporeonKey`),
)

const OBJECTS: PlainObject[] = [...MISC_OBJECTS, ...VAPOREON_KEYS].sort((a, b) =>
  a.type.localeCompare(b.type),
)

const KIOSK: KioskData = {
  kioskCount: 1,
  items: [
    {
      objectId: '0x3fef68dc1120b77f0b7610b792edbbb63c46ad37be9c6e9f4dd3dd0288bb42bf',
      type: '0x256cf2cbe798fd0458fa04464a7b6e127d57f754535d20b96243e231c1964910::SWEEBS::SweebNFT',
      name: 'Sweeb #3052',
      collection: 'SWEEBS::SweebNFT',
      description: 'The Culture Layer of Sui',
      // Same real Sweeb #3052 art (CID QmbWvQ…), served via a reachable gateway
      // so the screenshot harness can load it; production resolveMediaUrl maps
      // ipfs:// through its own gateway unchanged.
      imageUrl: 'https://gateway.pinata.cloud/ipfs/QmbWvQ6PpdKPKyCVqte3WrPXvCEHNZJLdGudyHAgsGXwoc',
      publicTransfer: false,
      kioskId: '0xf7387811b5d0e349baa146a1648fc20f03afd2909450d98966e343bd632ebc15',
    },
  ],
}

export interface MockData {
  address: string
  suinsName: string
  tokens: TokenBalance[]
  owned: OwnedSections
  kiosks: KioskData
}

export function buildMock(): MockData {
  return {
    address: MOCK_ADDRESS,
    suinsName: MOCK_SUINS,
    tokens: TOKENS,
    owned: { nfts: NFTS, objects: OBJECTS },
    kiosks: KIOSK,
  }
}
