// Funções de autenticação — login e logout via Auth.js no backend.

const BASE_URL = import.meta.env.VITE_API_URL as string

export interface LoginResult {
  token: string
  user: {
    id: string
    name: string | null
    email: string
    role: 'owner' | 'member'
    organizationId: string
  }
}

export async function login(email: string, password: string): Promise<LoginResult> {
  // Auth.js v5: endpoint de credentials é /api/auth/callback/credentials
  const response = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error((error as { message?: string }).message ?? 'Email ou senha inválidos')
  }

  return response.json() as Promise<LoginResult>
}

export async function logout(apiUrl: string): Promise<void> {
  await fetch(`${apiUrl}/api/auth/signout`, { method: 'POST' })
}
