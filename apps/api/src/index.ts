import { join } from "path";
import { existsSync } from "fs";
import { ensureSchema, pool } from "./db";
import {
  CREDITS_PER_PURCHASE,
  createCheckout,
  getCredits,
  getEmail,
  getLedger,
  hasPendingPurchase,
  newSessionId,
  reconcileSessionPurchases,
  seal,
  setEmail,
  spendCredit,
  unseal,
} from "./credits";

const PORT = Number(process.env.PORT || 3000);
const WEB_DIST = process.env.WEB_DIST || join(import.meta.dir, "../../web/dist");
const COOKIE = "jv_session";

try {
  await ensureSchema();
} catch (e) {
  console.error("[db] ensureSchema failed (server continues):", (e as Error).message);
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function withCookie(res: Response, sessionId: string) {
  res.headers.append(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(seal(sessionId))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
  );
  return res;
}

/** Devolve o id da sessão, criando uma nova se necessário. */
function sessionFor(req: Request): { id: string; isNew: boolean } {
  const cookies = parseCookies(req.headers.get("cookie"));
  const existing = unseal(cookies[COOKIE]);
  if (existing) return { id: existing, isNew: false };
  return { id: newSessionId(), isNew: true };
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/votes" && req.method === "GET") {
      const [rows] = await pool.query("SELECT * FROM votes ORDER BY id DESC LIMIT 100");
      return Response.json(rows);
    }

    if (url.pathname === "/api/votes" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (!body.option) return Response.json({ error: "option required" }, { status: 400 });
      const [res]: any = await pool.query("INSERT INTO votes (\`option\`) VALUES (?)", [body.option]);
      return Response.json({ id: res.insertId });
    }

    /* ------------------------------------------------------------- créditos -- */

    if (url.pathname === "/api/credits" && req.method === "GET") {
      const { id, isNew } = sessionFor(req);
      // Reconcilia na leitura: quem pagou e voltou sem clicar em nada ainda recebe crédito.
      await reconcileSessionPurchases(id);
      const credits = await getCredits(id);
      const email = await getEmail(id);
      const pending = await hasPendingPurchase(id);
      const res = Response.json({ credits, email, pending, price: CREDITS_PER_PURCHASE });
      return isNew ? withCookie(res, id) : res;
    }

    if (url.pathname === "/api/credits/email" && req.method === "POST") {
      const { id, isNew } = sessionFor(req);
      const body = await req.json().catch(() => ({}));
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return Response.json({ error: "email inválido" }, { status: 400 });
      }
      await setEmail(id, email);
      const credits = await getCredits(id);
      const res = Response.json({ ok: true, email, credits });
      return isNew ? withCookie(res, id) : res;
    }

    if (url.pathname === "/api/checkout" && req.method === "POST") {
      const { id, isNew } = sessionFor(req);
      const origin = req.headers.get("origin") || `http://localhost:5173`;
      try {
        const { billId, url } = await createCheckout(id, origin);
        const res = Response.json({ url, billId });
        return isNew ? withCookie(res, id) : res;
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 400 });
      }
    }

    if (url.pathname === "/api/credits/check" && req.method === "POST") {
      const { id, isNew } = sessionFor(req);
      // O saldo ANTES é a referência: "confirmado" quer dizer que o Pix caiu agora,
      // não que a pessoa tem crédito sobrando de uma compra anterior.
      const before = await getCredits(id);
      await reconcileSessionPurchases(id);
      const credits = await getCredits(id);
      const pending = await hasPendingPurchase(id);
      const res = Response.json({
        credits,
        pending,
        confirmed: credits > before,
      });
      return isNew ? withCookie(res, id) : res;
    }

    if (url.pathname === "/api/credits/history" && req.method === "GET") {
      const { id, isNew } = sessionFor(req);
      const res = Response.json({ entries: await getLedger(id) });
      return isNew ? withCookie(res, id) : res;
    }

    if (url.pathname === "/api/edit-image" && req.method === "POST") {
      const { id, isNew } = sessionFor(req);
      const form = await req.formData();
      const file = form.get("image");
      const prompt = form.get("prompt");
      const candidate = form.get("candidate");
      if (!(file instanceof File) || typeof prompt !== "string" || !prompt) {
        return Response.json({ error: "image and prompt required" }, { status: 400 });
      }

      // O saldo é validado no servidor. O front não decide se pode gerar.
      const credits = await getCredits(id);
      if (credits <= 0) {
        const res = Response.json({ error: "Sem créditos. Compre mais para gerar imagens." }, { status: 402 });
        return isNew ? withCookie(res, id) : res;
      }

      // Sem email não há como saber de quem é o crédito — então não se gasta.
      // Confere antes de chamar a OpenAI: é o único jeito de não cobrar por nada.
      const email = await getEmail(id);
      if (!email) {
        const res = Response.json(
          { error: "Informe seu email para usar os créditos.", code: "email_required" },
          { status: 403 },
        );
        return isNew ? withCookie(res, id) : res;
      }

      const fd = new FormData();
      fd.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-1");
      fd.append("prompt", prompt);
      fd.append("image", file);
      const res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_IMAGE_KEY || process.env.OPENAI_API_KEY}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        const r = Response.json({ error: data?.error?.message || "openai error" }, { status: res.status });
        return isNew ? withCookie(r, id) : r;
      }

      // Só debita depois que a imagem saiu.
      const spent = await spendCredit(id, typeof candidate === "string" ? candidate.slice(0, 64) : null);
      const b64 = data.data?.[0]?.b64_json;
      const urlImg = data.data?.[0]?.url;
      const out = Response.json({
        image: b64 ? `data:image/png;base64,${b64}` : urlImg,
        credits: await getCredits(id),
        spent,
      });
      return isNew ? withCookie(out, id) : out;
    }

    // static frontend
    const filePath = join(WEB_DIST, url.pathname === "/" ? "index.html" : url.pathname);
    if (existsSync(filePath)) {
      return new Response(Bun.file(filePath));
    }
    const index = join(WEB_DIST, "index.html");
    if (existsSync(index)) return new Response(Bun.file(index));

    return new Response("Not found", { status: 404 });
  },
});

console.log(`[api] running on http://localhost:${PORT}`);