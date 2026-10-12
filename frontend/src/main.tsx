import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import './index.css'
import App from './App.tsx'
import Survey from './Survey.tsx'

// The customer survey is a public page: no login, no admin menu.
const isSurvey = window.location.pathname.replace(/\/+$/, '') === '/survey'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSurvey ? <Survey /> : <App />}
  </StrictMode>,
)
