import { pool } from "./db";

/**
 * Log de eventos próprio (sem terceiros): quem entrou, em quais telas e em quais botões clicou.
 * O "usuário" é o id da sessão anônima (cookie httpOnly). Não guardamos IP, nome, email
 * nem user-agent: só o que o funil precisa.
 */

// Eventos que o navegador pode registrar. Qualquer outro nome é descartado.
const CLIENT_EVENTS = new Set([
  "page_view",
  "candidate_selected",
  "photo_selected",
  "photo_removed",
  "photo_changed",
  "generate_clicked",
  "checkout_started",
  "ja_paguei_clicked",
  "image_download",
  "blog_click",
  "blog_cta_click",
  "email_saved",
]);

export function isClientEvent(name: unknown): name is string {
  return typeof name === "string" && CLIENT_EVENTS.has(name);
}

function clean(value: unknown, max: number): string | null {
  return typeof value === "string" && value ? value.slice(0, max) : null;
}

/** Só objetos pequenos e rasos: texto, número ou boolean. Evita lixo e dado pessoal por acidente. */
function cleanProps(props: unknown): string | null {
  if (!props || typeof props !== "object" || Array.isArray(props)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props as Record<string, unknown>).slice(0, 10)) {
    if (!/^[a-z0-9_]{1,32}$/.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 120);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

export async function logEvent(sessionId: string, name: string, path?: unknown, props?: unknown) {
  try {
    await pool.query("INSERT INTO events (session_id, name, path, props) VALUES (?, ?, ?, ?)", [
      sessionId,
      name,
      clean(path, 255),
      cleanProps(props),
    ]);
  } catch (e) {
    // Métrica nunca pode derrubar o app.
    console.error("[events] falha ao registrar:", (e as Error).message);
  }
}

// Limite simples por sessão (em memória): impede um script de encher a tabela.
const hits = new Map<string, { n: number; reset: number }>();
export function allowEvent(sessionId: string): boolean {
  const now = Date.now();
  const h = hits.get(sessionId);
  if (!h || now > h.reset) {
    hits.set(sessionId, { n: 1, reset: now + 60_000 });
    if (hits.size > 5000) hits.clear();
    return true;
  }
  return ++h.n <= 120;
}

/** Resumo para o painel: visitantes únicos, telas, botões e funil. */
export async function summary(days: number) {
  const d = Math.min(Math.max(days, 1), 90);
  const since = "created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)";
  const [[visitors]]: any = await pool.query(
    `SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE name = 'page_view' AND ${since}`,
    [d],
  );
  const [byPath]: any = await pool.query(
    `SELECT path, COUNT(*) AS views, COUNT(DISTINCT session_id) AS visitors FROM events
     WHERE name = 'page_view' AND ${since} GROUP BY path ORDER BY views DESC LIMIT 50`,
    [d],
  );
  const [byEvent]: any = await pool.query(
    `SELECT name, COUNT(*) AS total, COUNT(DISTINCT session_id) AS visitors FROM events
     WHERE ${since} GROUP BY name ORDER BY total DESC`,
    [d],
  );
  const [byDay]: any = await pool.query(
    `SELECT DATE(created_at) AS day, COUNT(DISTINCT session_id) AS visitors FROM events
     WHERE name = 'page_view' AND ${since} GROUP BY day ORDER BY day`,
    [d],
  );
  // Funil: quantas pessoas únicas chegaram em cada etapa.
  const steps = ["page_view", "candidate_selected", "photo_selected", "checkout_started", "purchase_paid", "image_generated"];
  const [funnelRows]: any = await pool.query(
    `SELECT name, COUNT(DISTINCT session_id) AS visitors FROM events WHERE name IN (?) AND ${since} GROUP BY name`,
    [steps, d],
  );
  const funnel = steps.map(name => ({
    name,
    visitors: Number(funnelRows.find((r: any) => r.name === name)?.visitors ?? 0),
  }));
  return { days: d, uniqueVisitors: Number(visitors.n), funnel, byPath, byEvent, byDay };
}
