const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export interface LoginResult {
  user: {
    id: string
    name: string | null
    email: string
    role: 'owner' | 'member'
    organizationId: string
  }
}

export async function login(email: string, password: string): Promise<LoginResult> {
  let csrfRes: Response
  try {
    csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`, { credentials: 'include' })
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Aguarde o deploy e tente novamente.')
  }
  if (!csrfRes.ok) throw new Error('Falha ao iniciar autenticação')
  const { csrfToken } = await csrfRes.json() as { csrfToken: string }

  const body = new URLSearchParams({ csrfToken, email, password, redirect: 'false' })
  let loginRes: Response
  try {
    loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      credentials: 'include',
      redirect: 'manual',
    })
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Aguarde o deploy e tente novamente.')
  }

  if (loginRes.type === 'opaqueredirect' || (loginRes.status >= 300 && loginRes.status < 400)) {
    // Auth.js redireciona em sucesso — segue para checar a sessão
  } else if (!loginRes.ok && loginRes.status !== 0) {
    const text = await loginRes.text().catch(() => '')
    if (text.includes('MissingCSRF') || loginRes.status === 403) {
      throw new Error('Falha de autenticação (CSRF). Atualize a página e tente novamente.')
    }
  }

  let sessionRes: Response
  try {
    sessionRes = await fetch(`${BASE_URL}/api/auth/session`, { credentials: 'include' })
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Aguarde o deploy e tente novamente.')
  }
  const session = await sessionRes.json() as { user?: LoginResult['user'] }

  if (!session?.user?.id) throw new Error('Email ou senha inválidos')

  return { user: session.user }
}

export async function logout(): Promise<void> {
  await fetch(`${BASE_URL}/api/auth/signout`, {
    method: 'POST',
    credentials: 'include',
  })
}
