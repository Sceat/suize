import Navbar from './components/Navbar'
import Hero from './components/Hero'
import WalletSection from './components/WalletSection'
import CrashSection from './components/CrashSection'
import Footer from './components/Footer'
import { useScrollProgress } from './lib/hooks'

export default function App () {
  const progress = useScrollProgress()

  return (
    <>
      {/* Persistent ambient layers — outside <main> so they cover the whole doc */}
      <div className="bg-ambient" aria-hidden="true" />
      <div className="bg-grain" aria-hidden="true" />

      {/* Scroll progress — thin Sui-blue line at top */}
      <div
        aria-hidden="true"
        className="fixed top-0 left-0 right-0 h-[2px] z-50 pointer-events-none"
      >
        <div
          className="h-full origin-left"
          style={{
            transform: `scaleX(${progress})`,
            background:
              'linear-gradient(90deg, transparent 0%, var(--color-sui-bright) 30%, var(--color-sui) 70%, transparent 100%)',
            transition: 'transform 80ms linear',
            boxShadow: '0 0 12px var(--color-sui-bright)',
          }}
        />
      </div>

      <Navbar />

      <main className="relative">
        <Hero />
        <WalletSection />
        <CrashSection />
        <Footer />
      </main>
    </>
  )
}
