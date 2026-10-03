import { join } from "path";
import { existsSync } from "fs";
import { ensureSchema, pool } from "./db";
import { authorize, renderMetrics } from "./metrics";
import { allowEvent, isClientEvent, logEvent, summary } from "./events";
import { getImage, listImages, saveImage } from "./images";
import { buildPrompt, candidatePhotoFile, isKnownCandidate, sealFile } from "./imagePrompt";
import { appPageSeo, applySeo } from "./blog";
import { getPosts, renderIndex, renderNotFound, renderPost, renderRobots, renderRss, renderSitemap } from "./blog";
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
        const body = await req.json().catch(() => ({}));
        const { billId, url } = await createCheckout(id, origin, typeof body.candidate === "string" ? body.candidate : undefined);
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

    if (url.pathname === "/api/events" && req.method === "POST") {
      const { id, isNew } = sessionFor(req);
      const body = await req.json().catch(() => ({}));
      if (isClientEvent(body.name) && allowEvent(id)) {
        await logEvent(id, body.name, body.path, body.props);
      }
      const res = new Response(null, { status: 204 });
      return isNew ? withCookie(res, id) : res;
    }

    // Tela interna de métricas: aberta (só leitura, sem dado pessoal). Com ADMIN_TOKEN definido, exige senha.
    if ((url.pathname === "/interno/metricas" || url.pathname === "/interno/metricas/") && req.method === "GET") {
      const auth = authorize(req);
      if (auth === "denied") {
        return new Response("Autenticação necessária", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="Métricas Já Votei", charset="UTF-8"' },
        });
      }
      return new Response(await renderMetrics(Number(url.searchParams.get("days") || 7)), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
      });
    }

    // Painel: só com ADMIN_TOKEN configurado (Authorization: Bearer <token>).
    if (url.pathname === "/api/admin/events" && req.method === "GET") {
      const token = process.env.ADMIN_TOKEN;
      if (!token || req.headers.get("authorization") !== `Bearer ${token}`) {
        return new Response("Not found", { status: 404 });
      }
      return Response.json(await summary(Number(url.searchParams.get("days") || 7)));
    }

    if (url.pathname === "/api/images" && req.method === "GET") {
      const { id, isNew } = sessionFor(req);
      const res = Response.json({ images: await listImages(id) });
      return isNew ? withCookie(res, id) : res;
    }

    const imgMatch = url.pathname.match(/^\/api\/images\/(\d+)$/);
    if (imgMatch && req.method === "GET") {
      const { id } = sessionFor(req);
      const img = await getImage(id, Number(imgMatch[1]));
      if (!img) return new Response("Imagem não encontrada ou expirada.", { status: 404 });
      return new Response(img, {
        headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" },
      });
    }

    if (url.pathname === "/api/edit-image" && req.method === "POST") {
      const { id, isNew } = sessionFor(req);
      const form = await req.formData();
      const file = form.get("image");
      const prompt = String(form.get("prompt") ?? ""); // ajustes de estilo, opcionais
      const candidate = form.get("candidate");
      // Toggle do front: o candidato entra ou não na imagem gerada.
      const includeCandidate = form.get("includeCandidate") === "true";
      if (!(file instanceof File)) {
        return Response.json({ error: "Envie uma imagem." }, { status: 400 });
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

      if (!isKnownCandidate(candidate)) {
        return Response.json({ error: "Escolha um partido válido." }, { status: 400 });
      }

      // A foto da pessoa + o selo oficial do partido entram como imagens de referência.
      // Com o toggle ligado, a foto do candidato entra no meio (prompt conta as posições).
      const fd = new FormData();
      fd.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-1");
      fd.append("prompt", buildPrompt(candidate, prompt, includeCandidate));
      fd.append("image[]", file);
      if (includeCandidate) {
        const photo = candidatePhotoFile(candidate);
        fd.append("image[]", new File([await photo.arrayBuffer()], photo.name, { type: photo.type }));
      }
      fd.append("image[]", new File([await sealFile(candidate).arrayBuffer()], `selo-${candidate}.webp`, { type: "image/webp" }));
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

      // Guarda a imagem ANTES de debitar: se algo falhar daqui em diante, ela já está salva.
      const b64 = data.data?.[0]?.b64_json;
      let imageId: number | null = null;
      if (b64) {
        try {
          imageId = await saveImage(id, candidate, b64);
        } catch (e) {
          console.error("[images] falha ao salvar:", (e as Error).message);
        }
      }

      // Só debita depois que a imagem saiu.
      const spent = await spendCredit(id, candidate);
      await logEvent(id, "image_generated", `/${candidate}`, { candidate });
      const out = Response.json({
        image: b64 ? `data:image/png;base64,${b64}` : data.data?.[0]?.url,
        imageId,
        credits: await getCredits(id),
        spent,
      });
      return isNew ? withCookie(out, id) : out;
    }

    /* ------------------------------------------------------- blog / SEO -- */

    const html = (body: string, status = 200) =>
      new Response(body, {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
      });
    const xml = (body: string, type: string) =>
      new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "public, max-age=3600" } });

    if (url.pathname === "/api/blog" && req.method === "GET") {
      return Response.json(
        getPosts().map(p => ({ slug: p.slug, title: p.title, description: p.description, date: p.date })),
        { headers: { "Cache-Control": "public, max-age=300" } },
      );
    }

    if (req.method === "GET") {
      if (url.pathname === "/robots.txt") return xml(renderRobots(), "text/plain");
      if (url.pathname === "/sitemap.xml") return xml(renderSitemap(), "application/xml");
      if (url.pathname === "/blog/rss.xml") return xml(renderRss(), "application/rss+xml");
      if (url.pathname === "/blog" || url.pathname === "/blog/") return html(renderIndex());
      const m = url.pathname.match(/^\/blog\/([a-z0-9-]+)\/?$/);
      if (m) {
        const post = getPosts().find(p => p.slug === m[1]);
        return post ? html(renderPost(post)) : html(renderNotFound(), 404);
      }
    }

    // static frontend
    const filePath = join(WEB_DIST, url.pathname === "/" ? "index.html" : url.pathname);
    if (existsSync(filePath)) {
      return new Response(Bun.file(filePath));
    }
    const index = join(WEB_DIST, "index.html");
    if (existsSync(index)) {
      // Telas de partido: título, descrição e link canônico próprios no HTML (robôs de busca e de rede social não rodam JS).
      const seo = appPageSeo(url.pathname);
      if (seo) return new Response(applySeo(await Bun.file(index).text(), seo), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      return new Response(Bun.file(index));
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`[api] running on http://localhost:${PORT}`);