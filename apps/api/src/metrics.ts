import { timingSafeEqual } from "crypto";
import { pool } from "./db";

/**
 * Tela interna /interno/metricas: números do log de eventos (events.ts).
 * Protegida por HTTP Basic (a senha é o ADMIN_TOKEN; o usuário pode ser qualquer um).
 * Sem ADMIN_TOKEN no ambiente a tela fica desligada (404).
 */

export function authorize(req: Request): "ok" | "off" | "denied" {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return "off";
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Basic ")) return "denied";
  const pass = Buffer.from(header.slice(6), "base64").toString().split(":").slice(1).join(":");
  const a = Buffer.from(pass);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "denied";
}

// created_at está em UTC no servidor; o dia exibido é o de Brasília (UTC-3, sem horário de verão).
const DAY = "DATE_FORMAT(DATE_SUB(created_at, INTERVAL 3 HOUR), '%Y-%m-%d')";
const SINCE = "created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)";

type Row = Record<string, any>;
const q = async (sql: string, params: any[] = []): Promise<Row[]> => (await pool.query(sql, params))[0] as Row[];
const prop = (key: string) => `JSON_UNQUOTE(JSON_EXTRACT(props, '$.${key}'))`;

async function collect(days: number) {
  const [{ n: visitors }] = await q(`SELECT COUNT(DISTINCT session_id) n FROM events WHERE name='page_view' AND ${SINCE}`, [days]);
  const [{ n: views }] = await q(`SELECT COUNT(*) n FROM events WHERE name='page_view' AND ${SINCE}`, [days]);

  const steps = [
    ["page_view", "Entrou no site"],
    ["candidate_selected", "Escolheu um partido"],
    ["photo_selected", "Enviou uma foto"],
    ["generate_clicked", "Clicou em criar foto"],
    ["checkout_started", "Iniciou a compra"],
    ["purchase_paid", "Pagou"],
    ["image_generated", "Gerou uma imagem"],
  ];
  const f = await q(`SELECT name, COUNT(DISTINCT session_id) n FROM events WHERE name IN (?) AND ${SINCE} GROUP BY name`, [steps.map(s => s[0]), days]);
  const funnel = steps.map(([name, label]) => ({ label, n: Number(f.find(r => r.name === name)?.n ?? 0) }));

  const byDay = await q(
    `SELECT ${DAY} day, COUNT(DISTINCT session_id) visitors, COUNT(*) views FROM events WHERE name='page_view' AND ${SINCE} GROUP BY day ORDER BY day`,
    [days],
  );
  const byPath = await q(
    `SELECT path, COUNT(*) views, COUNT(DISTINCT session_id) visitors FROM events WHERE name='page_view' AND ${SINCE} GROUP BY path ORDER BY views DESC LIMIT 20`,
    [days],
  );
  const byEvent = await q(
    `SELECT name, COUNT(*) total, COUNT(DISTINCT session_id) people FROM events WHERE name <> 'page_view' AND ${SINCE} GROUP BY name ORDER BY total DESC`,
    [days],
  );
  const sources = await q(
    `SELECT COALESCE(NULLIF(${prop("ref")}, ''), NULLIF(${prop("utm_source")}, ''), '(direto)') source, COUNT(DISTINCT session_id) visitors
     FROM events WHERE name='page_view' AND ${SINCE} GROUP BY source ORDER BY visitors DESC LIMIT 15`,
    [days],
  );
  const picked = await q(
    `SELECT ${prop("candidate")} item, COUNT(*) n FROM events WHERE name='candidate_selected' AND props IS NOT NULL AND ${SINCE} GROUP BY item ORDER BY n DESC`,
    [days],
  );
  const generated = await q(
    `SELECT ${prop("candidate")} item, COUNT(*) n FROM events WHERE name='image_generated' AND props IS NOT NULL AND ${SINCE} GROUP BY item ORDER BY n DESC`,
    [days],
  );
  const buyWhere = await q(
    `SELECT COALESCE(${prop("where")}, '(n/d)') item, COUNT(*) n FROM events WHERE name='checkout_started' AND ${SINCE} GROUP BY item ORDER BY n DESC`,
    [days],
  );
  const blog = await q(
    `SELECT ${prop("slug")} item, COUNT(*) n FROM events WHERE name='blog_click' AND props IS NOT NULL AND ${SINCE} GROUP BY item ORDER BY n DESC LIMIT 15`,
    [days],
  );
  const [{ n: paid }] = await q(`SELECT COUNT(*) n FROM events WHERE name='purchase_paid' AND ${SINCE}`, [days]);
  const [{ n: gen }] = await q(`SELECT COUNT(*) n FROM events WHERE name='image_generated' AND ${SINCE}`, [days]);
  return { visitors: Number(visitors), views: Number(views), paid: Number(paid), gen: Number(gen), funnel, byDay, byPath, byEvent, sources, picked, generated, buyWhere, blog };
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1).replace(".", ",")}%` : "—");

const table = (head: string[], rows: (string | number)[][]) =>
  rows.length
    ? `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows
        .map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${esc(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`
    : `<p class="empty">Sem dados no período.</p>`;

const simple = (rows: Row[], label: string) => table([label, "Total"], rows.map(r => [r.item ?? "(n/d)", Number(r.n)]));

export async function renderMetrics(daysParam: number): Promise<string> {
  const days = [1, 7, 30, 90].includes(daysParam) ? daysParam : 7;
  const d = await collect(days);
  const maxDay = Math.max(1, ...d.byDay.map(r => Number(r.visitors)));
  const top = d.funnel[0].n;

  const funnel = d.funnel
    .map((s, i) => {
      const prev = i ? d.funnel[i - 1].n : s.n;
      return `<div class="step"><div class="lbl">${esc(s.label)}</div><div class="bar"><span style="width:${top ? Math.max(2, (s.n / top) * 100) : 0}%"></span></div><div class="val"><b>${s.n}</b> <small>${i ? `${pct(s.n, top)} do total · ${pct(s.n, prev)} da etapa anterior` : "100%"}</small></div></div>`;
    })
    .join("");

  const daily = d.byDay.length
    ? d.byDay
        .map(r => `<div class="col" title="${esc(r.day)}: ${r.visitors} visitantes"><span style="height:${(Number(r.visitors) / maxDay) * 100}%"></span><small>${esc(String(r.day).slice(5))}</small><b>${r.visitors}</b></div>`)
        .join("")
    : `<p class="empty">Sem dados no período.</p>`;

  const range = [1, 7, 30, 90].map(n => `<a href="?days=${n}"${n === days ? ' class="on"' : ""}>${n === 1 ? "24 h" : `${n} dias`}</a>`).join("");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Métricas | Já Votei</title>
<style>
:root{--fg:#171717;--muted:#6b7280;--line:#e5e7eb;--bg:#f5f5f4;--red:#dc2626;--card:#fff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:20px 16px 60px}
header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:18px}
h1{font-size:22px;margin:0}h2{font-size:15px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.range a{display:inline-block;padding:6px 12px;border-radius:999px;background:#fff;border:1px solid var(--line);color:var(--fg);text-decoration:none;margin-left:6px;font-size:14px}
.range a.on{background:var(--fg);color:#fff;border-color:var(--fg)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.kpi,.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.kpi b{display:block;font-size:28px;line-height:1.1}.kpi span{color:var(--muted);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-bottom:16px}
.step{display:grid;grid-template-columns:150px 1fr 190px;gap:10px;align-items:center;padding:5px 0}
.step .bar{background:#f0efed;border-radius:6px;height:14px;overflow:hidden}.step .bar span{display:block;height:100%;background:var(--red);border-radius:6px}
.step small{color:var(--muted)}.lbl{font-size:14px}
.daily{display:flex;align-items:flex-end;gap:6px;height:150px;overflow-x:auto}
.col{flex:1;min-width:26px;max-width:64px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:2px}
.col span{width:100%;background:var(--red);border-radius:4px 4px 0 0;min-height:2px}.col small{color:var(--muted);font-size:10px}.col b{font-size:11px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600;font-size:12px}.num{text-align:right;font-variant-numeric:tabular-nums}th:not(:first-child){text-align:right}
.empty{color:var(--muted);margin:4px 0}.note{color:var(--muted);font-size:12px;margin-top:18px}
@media(max-width:600px){.step{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<header><h1>Métricas · Já Votei</h1><div class="range">${range}</div></header>
<div class="kpis">
<div class="kpi"><b>${d.visitors}</b><span>visitantes únicos</span></div>
<div class="kpi"><b>${d.views}</b><span>visualizações de tela</span></div>
<div class="kpi"><b>${d.paid}</b><span>compras pagas</span></div>
<div class="kpi"><b>${pct(d.paid, d.visitors)}</b><span>visitantes que pagaram</span></div>
<div class="kpi"><b>${d.gen}</b><span>imagens geradas</span></div>
</div>
<div class="card" style="margin-bottom:16px"><h2>Funil (pessoas únicas)</h2>${funnel}</div>
<div class="card" style="margin-bottom:16px"><h2>Visitantes por dia</h2><div class="daily">${daily}</div></div>
<div class="grid">
<div class="card"><h2>Telas</h2>${table(["Tela", "Visitas", "Pessoas"], d.byPath.map(r => [r.path ?? "(n/d)", Number(r.views), Number(r.visitors)]))}</div>
<div class="card"><h2>Cliques e ações</h2>${table(["Evento", "Total", "Pessoas"], d.byEvent.map(r => [r.name, Number(r.total), Number(r.people)]))}</div>
<div class="card"><h2>De onde vieram</h2>${table(["Origem", "Visitantes"], d.sources.map(r => [r.source, Number(r.visitors)]))}</div>
<div class="card"><h2>Partido escolhido</h2>${simple(d.picked, "Partido")}</div>
<div class="card"><h2>Imagens geradas por partido</h2>${simple(d.generated, "Partido")}</div>
<div class="card"><h2>Botão de compra clicado</h2>${simple(d.buyWhere, "Botão")}</div>
<div class="card"><h2>Cliques no blog (home)</h2>${simple(d.blog, "Post")}</div>
</div>
<p class="note">Horário de Brasília. Pessoa = id de sessão anônimo (cookie), sem dados pessoais. Período: últimos ${days === 1 ? "24 horas" : `${days} dias`}.</p>
</div></body></html>`;
}
