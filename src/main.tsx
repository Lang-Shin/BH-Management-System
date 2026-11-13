import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './app'
import { ErrorBoundary } from './components/shared/states'
import { PrototypeProvider } from './state/prototype-context'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><ErrorBoundary><PrototypeProvider><BrowserRouter><App /></BrowserRouter></PrototypeProvider></ErrorBoundary></StrictMode>,
)
