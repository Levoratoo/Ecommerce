// Cliente central de HTTP — todas as chamadas à API passam por aqui.
// Injeta o token JWT automaticamente em cada requisição.

const BASE_URL = import.meta.env.VITE_API_URL as string

function getToken(): string | null {
  try {
    const raw = localStorage.getItem('melao-auth')
    if (!raw) return null
    const parsed = JSON.parse(raw) as { state?: { token?: string } }
    return parsed?.state?.token ?? null
  } catch {
    return null
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erro desconhecido' }))
    throw new Error((error as { message?: string }).message ?? `HTTP ${response.status}`)
  }

  // 204 No Content não tem body
  if (response.status === 204) return undefined as T

  return response.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
