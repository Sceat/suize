import { Folio } from './components/Folio'
import { Masthead } from './components/Masthead'
import { Lead } from './components/Lead'
import { Figures } from './components/Figures'
import { Gallery } from './components/Gallery'
import { Trust } from './components/Trust'
import { Privacy } from './components/Privacy'
import { Colophon } from './components/Colophon'

// suize.io — "The Dispatch". The gallery is the front-page news; the two doors
// (agent mcp one-liner / human connect-wallet) sit in the lead editorial.
export function App() {
  return (
    <>
      <Folio />
      <Masthead />
      <Lead />
      <Figures />
      <Gallery />
      <Trust />
      <Privacy />
      <Colophon />
    </>
  )
}
