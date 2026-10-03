/**
 * SESSÃO DE TESTE LOCAL — cria uma sessão com crédito e email e imprime o cookie.
 * Uso: bun --env-file=../../.env scripts/test-session.ts [creditos]
 * NÃO usar em produção: bypassa o checkout.
 */
import { pool } from "../src/db";
import { newSessionId, seal, setEmail } from "../src/credits";

const credits = Number(process.argv[2] || 3);
const id = newSessionId();
const email = "teste-local@exemplo.com";

await pool.query("INSERT INTO sessions (id, email, credits) VALUES (?, ?, ?)", [id, email, credits]);
await setEmail(id, email);

console.log(JSON.stringify({ sessionId: id, credits, cookie: seal(id) }, null, 2));
await pool.end();