// PolySui dashboard route barrel. Play is the immersive betting screen (App.tsx);
// every dashboard tab is now a fully-built screen under src/screens/, re-exported
// here under the names main.tsx imports so the route wiring stays unchanged.
// (Leaderboard + AgentScreen are imported directly by main.tsx.)
export { HouseScreen as House } from '../screens/House'
export { Markets } from '../screens/Markets'
export { Portfolio } from '../screens/Portfolio'
