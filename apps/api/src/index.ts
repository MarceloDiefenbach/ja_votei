import { join } from "path";
import { existsSync } from "fs";
import { ensureSchema, pool } from "./db";

const PORT = Number(process.env.PORT || 3000);
const WEB_DIST = process.env.WEB_DIST || join(import.meta.dir, "../../web/dist");

try {
  await ensureSchema();
} catch (e) {
  console.error("[db] ensureSchema failed (server continues):", (e as Error).message);
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
      const [res]: any = await pool.query("INSERT INTO votes (option) VALUES (?)", [body.option]);
      return Response.json({ id: res.insertId });
    }

    if (url.pathname === "/api/checkout" && req.method === "POST") {
      const origin = req.headers.get("origin") || `http://localhost:5173`;
      const res = await fetch("https://api.abacatepay.com/v2/checkouts/create", {
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
          completionUrl: `${origin}/?credits=10`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) return Response.json({ error: data?.error || "checkout error" }, { status: 400 });
      return Response.json({ url: data.data.url });
    }

    if (url.pathname === "/api/edit-image" && req.method === "POST") {
      const form = await req.formData();
      const file = form.get("image");
      const prompt = form.get("prompt");
      if (!(file instanceof File) || typeof prompt !== "string" || !prompt) {
        return Response.json({ error: "image and prompt required" }, { status: 400 });
      }
      const fd = new FormData();
      fd.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-1");
      fd.append("prompt", prompt);
      fd.append("image", file);
      const res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) return Response.json({ error: data?.error?.message || "openai error" }, { status: res.status });
      const b64 = data.data?.[0]?.b64_json;
      const urlImg = data.data?.[0]?.url;
      return Response.json({ image: b64 ? `data:image/png;base64,${b64}` : urlImg });
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
