import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import './index.css'
import App from './App.tsx'
import Survey from './Survey.tsx'
import GiftRequest from './GiftRequest.tsx'

// The customer survey is a public page: no login, no admin menu.
const path = window.location.pathname.replace(/\/+$/, '')
const isSurvey = path === '/survey'
// So is the gift-website request form, opened from a private link: /request/<token>.
const isRequest = /^\/request\/[^/]+$/.test(path)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSurvey ? <Survey /> : isRequest ? <GiftRequest /> : <App />}
  </StrictMode>,
)
