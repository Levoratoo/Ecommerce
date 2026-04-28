// Script de teste do fluxo de autenticação
// Roda com: node test-auth.mjs

const BASE_URL = "http://localhost:3000"
const EMAIL = "user@example.com"
const PASSWORD = "your_password_here"

// Gerencia os cookies manualmente (o que o browser faz automaticamente)
let cookieJar = {}

function parseCookies(response) {
  const setCookie = response.headers.getSetCookie?.() ?? []
  for (const cookie of setCookie) {
    const [nameValue] = cookie.split(";")
    const eqIndex = nameValue.indexOf("=")
    const name = nameValue.slice(0, eqIndex).trim()
    const value = nameValue.slice(eqIndex + 1).trim()
    cookieJar[name] = value
  }
}

function cookieHeader() {
  return Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
}

async function main() {
  // 1. Busca o CSRF token (necessário para o POST de login)
  console.log("1. Buscando CSRF token...")
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`, {
    headers: { Cookie: cookieHeader() },
  })
  parseCookies(csrfRes)
  const { csrfToken } = await csrfRes.json()
  console.log("   CSRF token recebido:", csrfToken.slice(0, 20) + "...")

  // 2. Em Auth.js v5, credentials usam /callback/credentials (não /signin)
  console.log("\n2. Fazendo login...")
  const signinRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(),
      Origin: BASE_URL,
    },
    body: new URLSearchParams({
      email: EMAIL,
      password: PASSWORD,
      csrfToken,
      redirect: "false",
      callbackUrl: BASE_URL,
    }).toString(),
    redirect: "manual",
  })
  parseCookies(signinRes)
  const location = signinRes.headers.get("location") ?? ""
  console.log("   Status:", signinRes.status)
  console.log("   Redirecionou para:", location)

  if (location.includes("error=")) {
    console.log("\n❌ Login falhou. Verifique email/senha no banco.")
    return
  }

  // 3. Busca a sessão para confirmar que organizationId está no JWT
  console.log("\n3. Verificando sessão...")
  const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, {
    headers: { Cookie: cookieHeader() },
  })
  const session = await sessionRes.json()

  if (!session?.user) {
    console.log("❌ Sessão vazia — algo deu errado no login.")
    console.log("   Resposta:", JSON.stringify(session))
    return
  }

  console.log("\n✅ Fase 1 concluída com sucesso!")
  console.log("   Usuário:", session.user.email)
  console.log("   ID:", session.user.id)
  console.log("   organizationId:", session.user.organizationId)
  console.log("   role:", session.user.role)
}

main().catch(console.error)
