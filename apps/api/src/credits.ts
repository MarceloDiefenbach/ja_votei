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

/** Debita 1 crédito atomicamente. Retorna false se não houver saldo. */
export async function spendCredit(sessionId: string): Promise<boolean> {
  await ensureSession(sessionId);
  const [res]: any = await pool.query(
    "UPDATE sessions SET credits = credits - 1 WHERE id = ? AND credits > 0",
    [sessionId],
  );
  return res.affectedRows === 1;
}

export async function setEmail(sessionId: string, email: string) {
  await ensureSession(sessionId);
  await pool.query("UPDATE sessions SET email = ? WHERE id = ?", [email, sessionId]);
}

/* --------------------------------------------------------------- checkout -- */

export async function createCheckout(sessionId: string, origin: string) {
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
      returnUrl: `${origin}/`,
      // Só a volta. Nenhum crédito vem pela URL.
      completionUrl: `${origin}/?paid=1`,
      externalId: `sess_${sessionId}`,
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

async function creditForBill(billId: string, eventId: string | null) {
  const [rows]: any = await pool.query(
    "SELECT session_id, credits, status FROM purchases WHERE bill_id = ?",
    [billId],
  );
  const purchase = rows[0];
  if (!purchase) return { ok: false as const, reason: "purchase_not_found" };
  if (purchase.status === "PAID") return { ok: true as const, already: true };

  // Trava: duas entregas simultâneas do mesmo evento não creditam duas vezes.
  if (eventId) {
    const [ins]: any = await pool.query(
      "INSERT IGNORE INTO webhook_events (id, event) VALUES (?, 'checkout.completed')",
      [eventId],
    );
    if ((ins as any).affectedRows === 0) {
      return { ok: true as const, already: true };
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [upd]: any = await conn.query(
      "UPDATE purchases SET status = 'PAID' WHERE bill_id = ? AND status <> 'PAID'",
      [billId],
    );
    if (upd.affectedRows === 1) {
      await conn.query("UPDATE sessions SET credits = credits + ? WHERE id = ?", [
        purchase.credits,
        purchase.session_id,
      ]);
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
 * Cobre o caso de o usuário fechar o browser antes do webhook chegar.
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
        await creditForBill(billId, null);
      }
    } catch (e) {
      console.error("[credits] reconcile falhou para", billId, (e as Error).message);
    }
  }
}

export async function handleWebhook(rawBody: string, signature: string | null, eventId: string, event: string) {
  const expected = crypto
    .createHmac("sha256", process.env.ABACATEPAY_PUBLIC_KEY || process.env.WEBHOOK_SECRET || "")
    .update(rawBody)
    .digest("base64");
  if (signature) {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false as const, reason: "invalid_signature" };
    }
  }
  if (event !== "checkout.completed") return { ok: true as const, ignored: true };

  const body = JSON.parse(rawBody);
  const billId = body?.data?.billing?.id || body?.data?.id || body?.data?.checkoutId;
  if (!billId) return { ok: true as const, ignored: true };

  const result = await creditForBill(billId, eventId);
  return { ok: true as const, ...result };
}

export { CREDITS_PER_PURCHASE };