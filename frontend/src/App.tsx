import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import InboxPage from './pages/InboxPage'
import ClientsPage from './pages/ClientsPage'
import AppLayout from './components/ui/AppLayout'
import ProtectedRoute from './components/ui/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/inbox"    element={<InboxPage />} />
          <Route path="/clients"  element={<ClientsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
