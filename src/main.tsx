import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { initEditor } from '@/state/editor'
import App from './App.tsx'
import './index.css'

void initEditor()
void document.fonts.load('700 72px Heebo')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={250}>
      <App />
    </TooltipProvider>
  </StrictMode>,
)
