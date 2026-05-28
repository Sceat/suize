import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Note: StrictMode is intentionally omitted. Double-invocation of useEffect
// breaks imperative GL libraries (OGL) that hold context across renders.
createRoot(document.getElementById('root')).render(<App />)
