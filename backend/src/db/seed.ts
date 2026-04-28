import "dotenv/config"
import bcrypt from "bcryptjs"
import { db } from "./index"

// ============================================================
// SEED INICIAL — cria a primeira organização e usuário owner
// Altere os valores abaixo antes de rodar:
//   npm run seed
// ============================================================

const ORG_NAME = "Projeto Sardinha"
const ORG_SLUG = "projeto-sardinha" // só letras minúsculas e hífens
const USER_NAME = "Admin"
const USER_EMAIL = "user@example.com"
const USER_PASSWORD = "your_password_here" // TROQUE antes de rodar em produção

async function seed() {
  console.log("Iniciando seed...\n")

  try {
    // 1. Cria a organização (tenant)
    const [org] = await db`
      INSERT INTO organizations (name, slug)
      VALUES (${ORG_NAME}, ${ORG_SLUG})
      RETURNING id, name, slug
    `
    console.log(`✓ Organização criada: ${org.name} (id: ${org.id})`)

    // 2. Cria o usuário owner com senha hasheada pelo bcrypt
    // O número 12 é o "salt rounds" — quanto maior, mais seguro (e mais lento)
    const passwordHash = await bcrypt.hash(USER_PASSWORD, 12)
    const [user] = await db`
      INSERT INTO users (organization_id, email, name, role, password_hash)
      VALUES (${org.id}, ${USER_EMAIL}, ${USER_NAME}, 'owner', ${passwordHash})
      RETURNING id, email, name, role
    `
    console.log(`✓ Usuário criado: ${user.email} (id: ${user.id})`)

    // 3. Cria as colunas padrão do pipeline para essa organização
    const stages = [
      { name: "Novo lead", position: 0 },
      { name: "Em contato", position: 1 },
      { name: "Proposta enviada", position: 2 },
      { name: "Fechado", position: 3 },
      { name: "Perdido", position: 4 },
    ]

    for (const stage of stages) {
      await db`
        INSERT INTO pipeline_stages (organization_id, name, position, is_default)
        VALUES (${org.id}, ${stage.name}, ${stage.position}, true)
      `
    }
    console.log(`✓ Pipeline criado com ${stages.length} colunas padrão`)

    console.log("\n--- Seed concluído com sucesso! ---")
    console.log(`\nCredenciais para login:`)
    console.log(`  Email: ${USER_EMAIL}`)
    console.log(`  Senha: ${USER_PASSWORD}`)
    console.log("\nIMPORTANTE: altere a senha após o primeiro login em produção.")
  } catch (error) {
    console.error("Erro durante o seed:", error)
    process.exit(1)
  } finally {
    await db.end()
  }
}

seed()
