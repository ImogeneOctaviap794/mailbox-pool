import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { Shell } from "./components/layout/Shell"
import { Toaster } from "./components/ui/sonner"
import { getToken } from "./lib/api"
import { Login } from "./pages/Login"
import { Dashboard } from "./pages/Dashboard"
import { RootDomains } from "./pages/RootDomains"
import { Domains } from "./pages/Domains"
import { Mailboxes } from "./pages/Mailboxes"
import { Inbox } from "./pages/Inbox"
import { ApiDocs } from "./pages/ApiDocs"

function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const token = getToken()
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />
  return <>{children}</>
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/root-domains" element={<RootDomains />} />
          <Route path="/domains" element={<Domains />} />
          <Route path="/mailboxes" element={<Mailboxes />} />
          <Route path="/inbox/:email" element={<Inbox />} />
          <Route path="/docs" element={<ApiDocs />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  )
}
