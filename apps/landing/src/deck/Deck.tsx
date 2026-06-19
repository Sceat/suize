import { Ambient } from './Ambient';
import { Wall } from './decks/Wall';
import { ProductPage } from './decks/ProductPage';
import { tracks } from './tracks';
import { navigate } from '../ui';
import './deck-base.css';

// The pitch deck, mounted at suize.io/deck inside the landing SPA. The landing's
// path router gives us the route; the 2nd segment selects the product page.
// onJump routes within /deck via the landing's navigate(); the deck brings its
// own background shader (App suppresses the landing <Backdrop/> on /deck).
const subOf = (route: string) => route.replace(/^\/+deck\/?/, '').split('/')[0];

export function Deck({ route }: { route: string }) {
  const sub = subOf(route);
  const page = tracks.find((t) => t.id === sub);
  const go = (id: string) => navigate(id ? `/deck/${id}` : '/deck');

  return (
    <div className="deck-root">
      <div className="amb" />
      <Ambient variant={page ? 1 : 2} />
      <div className="grain" />
      {page ? <ProductPage page={page} onJump={go} /> : <Wall onJump={go} />}
    </div>
  );
}
