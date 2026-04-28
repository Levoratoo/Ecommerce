import "dotenv/config"
import express from "express"
import cors from "cors"
import { ExpressAuth } from "@auth/express"
import { authConfig } from "./auth.config"

const app = express()
const PORT = process.env.PORT || 3000

// Permite que o frontend acesse a API e envie cookies de sessão
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true, // necessário para o cookie de sessão do Auth.js funcionar
  })
)

app.use(express.json())
// Necessário para o Auth.js ler o body do formulário de login (email, senha, csrfToken)
app.use(express.urlencoded({ extended: true }))

// Auth.js cuida de todas as rotas em /api/auth/*
// Inclui: POST /api/auth/signin, POST /api/auth/signout, GET /api/auth/session
app.use("/api/auth/*", ExpressAuth(authConfig))

// Rota de verificação — útil para checar se o servidor está no ar
app.get("/health", (_req, res) => {
  res.json({ status: "ok" })
})

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`)
})

export default app
