import "dotenv/config"
import express from "express"
import cors from "cors"
import { ExpressAuth } from "@auth/express"
import { authConfig } from "./auth.config"
import conversationsRouter from "./routes/conversations"
import messagesRouter from "./routes/messages"
import eventsRouter from "./routes/events"
import clientsRouter from "./routes/clients"
import companiesRouter from "./routes/companies"
import remindersRouter from "./routes/reminders"
import webhooksRouter from "./routes/webhooks"

const app = express()
const PORT = Number(process.env.PORT) || 3000

// Necessário atrás do proxy da Vercel para Auth.js gerar cookies Secure e URLs https://
app.set("trust proxy", 1)

const allowedOrigins = new Set(
  [
    process.env.FRONTEND_URL,
    "http://localhost:5173",
    "http://localhost:4173",
    "https://ecommerce-levorato.vercel.app",
    "https://ecommerce-eight-snowy-19.vercel.app",
    "https://ecommerce-git-main-levorato.vercel.app",
  ].filter(Boolean) as string[]
)

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || origin.endsWith("-levorato.vercel.app")) {
        callback(null, true)
        return
      }
      callback(null, false)
    },
    credentials: true,
  })
)

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use("/api/v1", (_req, res, next) => { res.set("Cache-Control", "no-store"); next() })

app.use("/api/auth/*", ExpressAuth(authConfig))

app.use("/api/v1/conversations", conversationsRouter)
app.use("/api/v1/messages", messagesRouter)
app.use("/api/v1/clients", clientsRouter)
app.use("/api/v1/companies", companiesRouter)
app.use("/api/v1/reminders", remindersRouter)
app.use("/api/events", eventsRouter)
app.use("/webhooks", webhooksRouter)

app.get("/health", (_req, res) => {
  res.json({ status: "ok" })
})

if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor rodando na porta ${PORT}`)
  })
}

export default app
