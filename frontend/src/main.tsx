import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './styles.css'
import App from './App.tsx'
import { AuthProvider } from './services/auth.tsx'
import { ToastProvider } from './hooks/useToast.tsx'

// Every page was refetching from scratch (useState(null) + useEffect) on
// every visit, so navigating Dashboard -> History -> Dashboard blanked back
// to a loading skeleton each time even though nothing had changed -- felt
// like a full page refresh despite React Router never doing a hard
// navigation. React Query's cache is what fixes that: a query already in
// the cache renders its last-known data immediately on remount and
// revalidates quietly in the background, rather than the page going blank
// while it waits on a fresh network round-trip.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
