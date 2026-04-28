import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '../types'

// persist salva o estado no localStorage — o usuário continua logado ao recarregar
interface AuthState {
  user: User | null
  token: string | null
  setAuth: (user: User, token: string) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      setAuth: (user, token) => set({ user, token }),
      clearAuth: () => set({ user: null, token: null }),
    }),
    { name: 'melao-auth' }
  )
)
