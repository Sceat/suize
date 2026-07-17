import { Folio } from './components/Folio'
import { Masthead } from './components/Masthead'
import { Lead } from './components/Lead'
import { Figures } from './components/Figures'
import { Gallery } from './components/Gallery'
import { Trust } from './components/Trust'
import { Privacy } from './components/Privacy'
import { Colophon } from './components/Colophon'
import { HeroShader } from './HeroShader'
import { useHashRoute } from './viewer/router'
import { ViewerPage } from './viewer/ViewerPage'
import { AccessPage } from './viewer/AccessPage'
import { lazy, Suspense } from 'react'
import { MySites } from './components/MySites'
import { useLive } from './useLive'
import './viewer/viewer.css'

// DEV-ONLY operator tool (#/publish), lazy-loaded ONLY in dev. In a production
// build `import.meta.env.DEV` is the constant `false`, so this is `null` and
// Rollup drops the dynamic import entirely — the whole module (and its "MAINNET"
// copy) is tree-shaken out of the prod bundle. The router gate already ensures
// the route never resolves in prod; this makes the code absent too.
const PublishPage = import.meta.env.DEV
  ? lazy(() => import('./dev/PublishPage').then((m) => ({ default: m.PublishPage })))
  : null

// suize.io — "The Dispatch". The gallery is the front-page news; the two doors
// (agent mcp one-liner / human connect-wallet) sit in the lead editorial. Hash
// routes peel off to the wallet dashboard (#/sites) and the sealed-site viewer /
// viewer-list manager; the front page is the default.
export function App() {
  const route = useHashRoute()
  if (route.kind === 'sites') return <MySites />
  if (route.kind === 'view') return <ViewerPage siteId={route.id} />
  if (route.kind === 'view-dev') return <ViewerPage devManifestBlobId={route.id} />
  if (route.kind === 'access') return <AccessPage allowlistId={route.id} />
  if (route.kind === 'publish' && PublishPage)
    return (
      <Suspense fallback={null}>
        <PublishPage />
      </Suspense>
    )
  return <Landing />
}

function Landing() {
  // ONE live fetch of the real gallery + counters (honesty law — nothing on the
  // public page is fabricated; a read blip shows an empty state, never fake rows).
  const live = useLive()
  return (
    <>
      <HeroShader />
      <Folio />
      <Masthead />
      <Lead />
      <Figures live={live} />
      <Gallery live={live} />
      <Trust />
      <Privacy />
      <Colophon />
    </>
  )
}
