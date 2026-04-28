import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import InboxPage from './pages/InboxPage'
import ContactsPage from './pages/ContactsPage'
import PipelinePage from './pages/PipelinePage'
import AppLayout from './components/ui/AppLayout'
import ProtectedRoute from './components/ui/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* Todas as rotas dentro de AppLayout são protegidas */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
        </Route>

        {/* Redireciona / para /inbox */}
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
