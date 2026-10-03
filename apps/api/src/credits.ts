import crypto from "crypto";
import { pool } from "./db";

const ABACATEPAY_API = "https://api.abacatepay.com/v2";
const CREDITS_PER_PURCHASE = Number(process.env.CREDITS_PER_PURCHASE || 10);

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET ausente");
  return s;
}

/* ---------------------------------------------------------------- sessao --
 * Identidade sem login: cookie httpOnly assinado, gerado no primeiro acesso.
 * O cliente não consegue forjar (HMAC) nem apagar sem perder o saldo.
 */

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function newSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

export function seal(sessionId: string) {
  const payload = `${sessionId}.${sign(sessionId)}`;
  return Buffer.from(payload).toString("base64url");
}

export function unseal(cookieValue: string | undefined | null): string | null {
  if (!cookieValue) return null;
  let payload: string;
  try {
    payload = Buffer.from(cookieValue, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const sep = payload.lastIndexOf(".");
  if (sep < 0) return null;
  const sessionId = payload.slice(0, sep);
  const mac = payload.slice(sep + 1);
  const expected = sign(sessionId);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return sessionId;
}

export async function ensureSession(sessionId: string) {
  await pool.query("INSERT IGNORE INTO sessions (id) VALUES (?)", [sessionId]);
}

export async function getCredits(sessionId: string) {
  await ensureSession(sessionId);
  const [rows]: any = await pool.query("SELECT credits FROM sessions WHERE id = ?", [sessionId]);
  return Number(rows[0]?.credits || 0);
}

/** Debita 1 crédito atomicamente e registra no histórico. Retorna false se não houver saldo. */
export async function spendCredit(sessionId: string, candidate: string | null = null): Promise<boolean> {
  await ensureSession(sessionId);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res]: any = await conn.query(
      "UPDATE sessions SET credits = credits - 1 WHERE id = ? AND credits > 0",
      [sessionId],
    );
    if (res.affectedRows !== 1) {
      await conn.rollback();
      return false;
    }
    await conn.query(
      "INSERT INTO credit_ledger (session_id, kind, credits, candidate) VALUES (?, 'spend', -1, ?)",
      [sessionId, candidate],
    );
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Existe compra ainda não confirmada? É o que habilita o botão "Já paguei". */
export async function hasPendingPurchase(sessionId: string): Promise<boolean> {
  const [rows]: any = await pool.query(
    "SELECT 1 FROM purchases WHERE session_id = ? AND status <> 'PAID' LIMIT 1",
    [sessionId],
  );
  return rows.length > 0;
}

export async function setEmail(sessionId: string, email: string) {
  await ensureSession(sessionId);
  await pool.query("UPDATE sessions SET email = ? WHERE id = ?", [email, sessionId]);
}

/** Email da sessão, ou "" se nunca foi informado. */
export async function getEmail(sessionId: string): Promise<string> {
  await ensureSession(sessionId);
  const [rows]: any = await pool.query("SELECT email FROM sessions WHERE id = ?", [sessionId]);
  return String(rows[0]?.email || "");
}

/* --------------------------------------------------------------- checkout -- */

export async function createCheckout(sessionId: string, origin: string, candidate?: string) {
  // Volta para a tela do partido de onde a pessoa saiu (slug validado: só vira path da URL).
  const back = candidate && /^[a-z0-9-]{1,32}$/.test(candidate) ? `/${candidate}` : "/";
  const res = await fetch(`${ABACATEPAY_API}/checkouts/create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ABACATEPAY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{ id: process.env.ABACATEPAY_PRODUCT_ID, quantity: 1 }],
      methods: ["PIX", "CARD"],
      card: { maxInstallments: 1 },
      returnUrl: `${origin}${back}`,
      // Só a volta. Nenhum crédito vem pela URL.
      completionUrl: `${origin}${back}?paid=1`,
      // Único por tentativa: a AbacatePay devolve o MESMO checkout para um externalId repetido,
      // então reusar o da sessão reabria a cobrança antiga (já paga → "link não encontrado").
      externalId: `sess_${sessionId.slice(0, 16)}_${Date.now().toString(36)}`,
      metadata: { sessionId, credits: CREDITS_PER_PURCHASE },
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data?.error || "checkout error");
  }
  const billId = data.data.id as string;

  // externalId tem limite de tamanho; guardamos a sessão no metadata,
  // que volta no payload. Esta tabela é a fonte de verdade da vinculação.
  await pool.query(
    "INSERT INTO purchases (session_id, bill_id, credits, status) VALUES (?, ?, ?, 'PENDING') " +
      "ON DUPLICATE KEY UPDATE session_id = VALUES(session_id)",
    [sessionId, billId, CREDITS_PER_PURCHASE],
  );

  return { billId, url: data.data.url as string };
}

/* ----------------------------------------------------------------- crédito -- */

async function creditForBill(billId: string) {
  const [rows]: any = await pool.query(
    "SELECT session_id, credits, status FROM purchases WHERE bill_id = ?",
    [billId],
  );
  const purchase = rows[0];
  if (!purchase) return { ok: false as const, reason: "purchase_not_found" };
  if (purchase.status === "PAID") return { ok: true as const, already: true };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // O status <> 'PAID' no WHERE é a trava: duas chamadas simultâneas não creditam duas vezes.
    const [upd]: any = await conn.query(
      "UPDATE purchases SET status = 'PAID' WHERE bill_id = ? AND status <> 'PAID'",
      [billId],
    );
    if (upd.affectedRows === 1) {
      await conn.query("UPDATE sessions SET credits = credits + ? WHERE id = ?", [
        purchase.credits,
        purchase.session_id,
      ]);
      await conn.query(
        "INSERT INTO credit_ledger (session_id, kind, credits, bill_id) VALUES (?, 'purchase', ?, ?)",
        [purchase.session_id, purchase.credits, billId],
      );
    }
    await conn.commit();
    return { ok: true as const, already: upd.affectedRows === 0 };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Confere na AbacatePay se o checkout foi pago e credita.
 * É o caminho de verdade dos créditos: não usamos webhook, então quem paga
 * precisa perguntar. Chamado pelo botão "Já paguei".
 */
export async function reconcileSessionPurchases(sessionId: string) {
  const [rows]: any = await pool.query(
    "SELECT bill_id FROM purchases WHERE session_id = ? AND status <> 'PAID'",
    [sessionId],
  );
  for (const row of rows) {
    const billId = row.bill_id as string;
    try {
      const res = await fetch(`${ABACATEPAY_API}/checkouts/get?id=${encodeURIComponent(billId)}`, {
        headers: { Authorization: `Bearer ${process.env.ABACATEPAY_API_KEY}` },
      });
      const data = await res.json();
      if (data?.success && data?.data?.status === "PAID") {
        await creditForBill(billId);
      }
    } catch (e) {
      console.error("[credits] reconcile falhou para", billId, (e as Error).message);
    }
  }
}

/** Histórico de créditos da sessão, mais novo primeiro. */
export async function getLedger(sessionId: string, limit = 50) {
  const [rows]: any = await pool.query(
    "SELECT kind, credits, candidate, created_at FROM credit_ledger " +
      "WHERE session_id = ? ORDER BY id DESC LIMIT ?",
    [sessionId, limit],
  );
  return rows;
}

export { CREDITS_PER_PURCHASE };