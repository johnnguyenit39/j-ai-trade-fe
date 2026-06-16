import { AuthProvider, useAuth } from './auth/AuthContext'
import { ChatScreen } from './components/ChatScreen'
import { LoginPage } from './components/LoginPage'

function Gate() {
  const { user, loading, configured } = useAuth()

  // No Firebase config → skip auth entirely (in-memory mode).
  if (!configured) return <ChatScreen />

  // Resolving the restored session → loading screen.
  if (loading) {
    return (
      <div className="loading">
        <div className="loading__spinner" />
      </div>
    )
  }

  // No session → login; session present → app.
  return user ? <ChatScreen /> : <LoginPage />
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
