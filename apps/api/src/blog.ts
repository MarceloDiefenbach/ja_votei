import { join } from "path";
import { readdirSync, readFileSync } from "fs";
import { marked } from "marked";

/**
 * Blog em arquivos: cada post é um .md em apps/api/content/blog/.
 * O HTML é renderizado no servidor (sem JS) para o Google indexar o conteúdo direto.
 */

const POSTS_DIR = process.env.BLOG_DIR || join(import.meta.dir, "../content/blog");
export const SITE_URL = (process.env.SITE_URL || "https://javotei.com.br").replace(/\/$/, "");
const SITE_NAME = "Já Votei";
const IS_PROD = process.env.NODE_ENV === "production";
const DEFAULT_IMAGE = "/og-default.png"; // 1200x630, neutro (os 4 selos), em apps/web/public

export type Post = {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO
  updated?: string;
  image?: string;
  tags: string[];
  draft: boolean;
  html: string;
  minutes: number;
};

/* ------------------------------------------------------------- leitura -- */

/** Frontmatter mínimo (chave: valor, listas em [a, b]). Evita dependência só para isso. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (/^(".*"|'.*')$/.test(val)) val = val.slice(1, -1);
    meta[key] = val;
  }
  return { meta, body: m[2] };
}

function loadPost(file: string): Post | null {
  const slug = file.replace(/\.md$/, "");
  const { meta, body } = parseFrontmatter(readFileSync(join(POSTS_DIR, file), "utf8"));
  if (!meta.title || !meta.description || !meta.date) {
    console.error(`[blog] ${file} ignorado: title, description e date são obrigatórios`);
    return null;
  }
  const date = new Date(meta.date);
  if (Number.isNaN(date.getTime())) {
    console.error(`[blog] ${file} ignorado: date inválida (${meta.date})`);
    return null;
  }
  const html = (marked.parse(body, { async: false }) as string).replace(
    /<img /g,
    '<img loading="lazy" decoding="async" ',
  );
  const words = body.split(/\s+/).filter(Boolean).length;
  return {
    slug,
    title: meta.title,
    description: meta.description,
    date: date.toISOString(),
    updated: meta.updated ? new Date(meta.updated).toISOString() : undefined,
    image: meta.image || undefined,
    tags: meta.tags ? meta.tags.replace(/^\[|\]$/g, "").split(",").map(t => t.trim()).filter(Boolean) : [],
    draft: meta.draft === "true",
    html,
    minutes: Math.max(1, Math.round(words / 200)),
  };
}

// Em produção os arquivos não mudam durante a vida do processo: lê uma vez.
let cache: Post[] | null = null;

export function getPosts(): Post[] {
  if (IS_PROD && cache) return cache;
  let files: string[] = [];
  try {
    files = readdirSync(POSTS_DIR).filter(f => f.endsWith(".md") && !f.startsWith("_"));
  } catch {
    // pasta ausente = blog vazio
  }
  const posts = files
    .map(loadPost)
    .filter((p): p is Post => p !== null)
    .filter(p => !p.draft || !IS_PROD) // rascunho só aparece em desenvolvimento
    .sort((a, b) => b.date.localeCompare(a.date));
  if (IS_PROD) cache = posts;
  return posts;
}

/* ------------------------------------------------------------- helpers -- */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const abs = (path: string) => (/^https?:\/\//.test(path) ? path : `${SITE_URL}${path}`);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/* ------------------------------------------------------------ template -- */

const CSS = `
:root{color-scheme:light;--fg:#171717;--muted:#6b7280;--line:#e5e7eb;--bg:#fafafa;--red:#dc2626;--yellow:#facc15}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--red)}
.wrap{max-width:720px;margin:0 auto;padding:0 20px}
header.top{display:flex;justify-content:space-between;align-items:center;padding:22px 0}
.logo{font-weight:800;font-size:26px;letter-spacing:-.02em;color:var(--fg);text-decoration:none}
.logo b{color:var(--red);box-shadow:inset 0 -.28em 0 var(--yellow)}
nav a{margin-left:18px;font-size:15px;color:var(--muted);text-decoration:none}
nav a:hover{color:var(--fg)}
h1{font-size:2.2rem;line-height:1.2;letter-spacing:-.02em;margin:.4em 0}
h2{font-size:1.5rem;margin:2em 0 .4em;line-height:1.3}
h3{font-size:1.2rem;margin:1.6em 0 .3em}
.meta{color:var(--muted);font-size:14px}
article img{max-width:100%;height:auto;border-radius:12px}
article blockquote{margin:1.4em 0;padding:.2em 1.1em;border-left:4px solid var(--yellow);color:#374151}
article table{border-collapse:collapse;width:100%;font-size:15px;display:block;overflow-x:auto}article th,article td{border:1px solid var(--line);padding:6px 10px;text-align:left}article th{background:#f3f4f6}
article pre{overflow:auto;background:#111827;color:#f9fafb;padding:14px;border-radius:10px;font-size:15px}
article code{background:#f3f4f6;padding:.1em .35em;border-radius:5px;font-size:.9em}
article pre code{background:none;padding:0}
.card{display:block;padding:18px 0;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}
.card h2{margin:0 0 4px;font-size:1.35rem}
.card p{margin:4px 0;color:#374151;font-size:16px}
.cta{margin:48px 0;padding:24px;border-radius:16px;background:var(--fg);color:#fff;text-align:center}
.cta a{display:inline-block;margin-top:10px;padding:12px 22px;border-radius:999px;background:var(--yellow);color:#171717;font-weight:700;text-decoration:none}
.more{margin-top:40px}.more h2{font-size:1.2rem}.card h3{margin:0 0 4px;font-size:1.1rem}
.tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.tags span{font-size:12px;padding:2px 10px;border-radius:999px;background:#f3f4f6;color:var(--muted)}
footer{padding:40px 0;color:var(--muted);font-size:14px;text-align:center}
`;

type PageOpts = {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: "website" | "article";
  noindex?: boolean;
  jsonLd?: object[];
  published?: string;
  modified?: string;
  tags?: string[];
  body: string;
};

function page(o: PageOpts): string {
  const url = abs(o.path);
  const image = abs(o.image || DEFAULT_IMAGE);
  const fullTitle = o.path === "/blog" ? o.title : `${o.title} | ${SITE_NAME}`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="${o.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large"}">
<link rel="alternate" type="application/rss+xml" title="${SITE_NAME}" href="${SITE_URL}/blog/rss.xml">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="pt_BR">
<meta property="og:type" content="${o.type || "website"}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
${o.image ? "" : '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'}${(o.tags || []).map(t => `<meta property="article:tag" content="${esc(t)}">`).join("\n")}
${o.published ? `<meta property="article:published_time" content="${o.published}">\n` : ""}${o.modified ? `<meta property="article:modified_time" content="${o.modified}">\n` : ""}<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.description)}">
<meta name="twitter:image" content="${esc(image)}">
${(o.jsonLd || []).map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
<script defer src="https://cdn.himetrica.com/tracker.js" data-api-key="hm_6af14f5b42deb7ba62c3ad83f77d4b12ce8f543400c66ead"></script>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header class="top">
<a class="logo" href="/">Já <b>Votei</b></a>
<nav><a href="/">Criar minha foto</a><a href="/blog">Blog</a></nav>
</header>
${o.body}
<footer>© ${new Date().getFullYear()} ${SITE_NAME}</footer>
</div>
<script>(function(){function s(n,p){try{fetch("/api/events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n,path:location.pathname,props:p}),keepalive:true})}catch(e){}}var r="";try{r=document.referrer?new URL(document.referrer).hostname:""}catch(e){}s("page_view",r?{ref:r}:{});document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[data-track]");if(a)s(a.getAttribute("data-track"))})})()</script>
</body>
</html>`;
}

/* -------------------------------------------------------------- páginas -- */

export function renderIndex(): string {
  const posts = getPosts();
  const list = posts.length
    ? posts
        .map(
          p => `<a class="card" href="/blog/${p.slug}">
<h2>${esc(p.title)}</h2>
<p>${esc(p.description)}</p>
<span class="meta">${fmtDate(p.date)} · ${p.minutes} min de leitura${p.draft ? " · RASCUNHO" : ""}</span>
</a>`,
        )
        .join("\n")
    : "<p>Em breve, os primeiros artigos.</p>";
  const description = "Dicas, novidades e bastidores do Já Votei: como criar sua foto de campanha com o selo oficial.";
  return page({
    title: "Blog do Já Votei",
    description,
    path: "/blog",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Blog",
        name: "Blog do Já Votei",
        url: abs("/blog"),
        description,
        blogPost: posts.map(p => ({ "@type": "BlogPosting", headline: p.title, url: abs(`/blog/${p.slug}`) })),
      },
    ],
    body: `<main><h1>Blog</h1>${list}</main>`,
  });
}

/** Links internos: até 3 posts com mais tags em comum (empate: o mais novo). Ajuda o Google e o leitor. */
function related(p: Post): Post[] {
  return getPosts()
    .filter(x => x.slug !== p.slug)
    .map(x => ({ x, score: x.tags.filter(t => p.tags.includes(t)).length }))
    .sort((a, b) => b.score - a.score || b.x.date.localeCompare(a.x.date))
    .slice(0, 3)
    .map(r => r.x);
}

export function renderPost(p: Post): string {
  const url = abs(`/blog/${p.slug}`);
  const more = related(p);
  return page({
    title: p.title,
    description: p.description,
    path: `/blog/${p.slug}`,
    image: p.image,
    type: "article",
    published: p.date,
    modified: p.updated || p.date,
    tags: p.tags,
    noindex: p.draft,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: p.title,
        description: p.description,
        image: [abs(p.image || DEFAULT_IMAGE)],
        datePublished: p.date,
        dateModified: p.updated || p.date,
        mainEntityOfPage: url,
        inLanguage: "pt-BR",
        keywords: p.tags.join(", ") || undefined,
        author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
        publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Início", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Blog", item: abs("/blog") },
          { "@type": "ListItem", position: 3, name: p.title, item: url },
        ],
      },
    ],
    body: `<main><article>
<p class="meta"><a href="/blog">← Blog</a></p>
<h1>${esc(p.title)}</h1>
<p class="meta"><time datetime="${p.date}">${fmtDate(p.date)}</time> · ${p.minutes} min de leitura${p.draft ? " · RASCUNHO (não indexado)" : ""}</p>
${p.tags.length ? `<div class="tags">${p.tags.map(t => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
${p.html}
</article>
${more.length ? `<nav class="more" aria-label="Leia também"><h2>Leia também</h2>${more.map(m => `<a class="card" href="/blog/${m.slug}"><h3>${esc(m.title)}</h3><p>${esc(m.description)}</p></a>`).join("")}</nav>` : ""}
<aside class="cta"><strong>Crie sua foto de campanha com o selo oficial</strong><br><a href="/" data-track="blog_cta_click">Começar agora</a></aside></main>`,
  });
}

export function renderNotFound(): string {
  return page({
    title: "Post não encontrado",
    description: "Este artigo não existe ou foi removido.",
    path: "/blog",
    noindex: true,
    body: `<main><h1>Post não encontrado</h1><p><a href="/blog">Ver todos os artigos</a></p></main>`,
  });
}

/* ----------------------------------------------------- sitemap, rss, robots -- */

// Páginas do app (SPA) que também devem ser indexadas.
const APP_PATHS = ["/", "/pt", "/pl", "/missao", "/psd"];

export function renderSitemap(): string {
  const posts = getPosts();
  const urls = [
    ...APP_PATHS.map(p => `<url><loc>${abs(p)}</loc></url>`),
    `<url><loc>${abs("/blog")}</loc>${posts[0] ? `<lastmod>${(posts[0].updated || posts[0].date).slice(0, 10)}</lastmod>` : ""}</url>`,
    ...posts.map(p => `<url><loc>${abs(`/blog/${p.slug}`)}</loc><lastmod>${(p.updated || p.date).slice(0, 10)}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
}

export function renderRss(): string {
  const items = getPosts()
    .map(
      p => `<item><title>${esc(p.title)}</title><link>${abs(`/blog/${p.slug}`)}</link><guid>${abs(`/blog/${p.slug}`)}</guid><pubDate>${new Date(p.date).toUTCString()}</pubDate><description>${esc(p.description)}</description></item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Blog do Já Votei</title><link>${abs("/blog")}</link><description>Dicas e novidades do Já Votei</description><language>pt-BR</language>\n${items}\n</channel></rss>`;
}

export function renderRobots(): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /interno/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}


/* ------------------------------------------------- SEO das telas do app (SPA) -- */

const PARTY_SEO: Record<string, { title: string; description: string }> = {
  pt: { title: "Foto com o selo Eu já votei 13 | Já Votei", description: "Crie sua foto de campanha com o selo oficial \"Eu já votei 13\" a partir da sua foto, pronta para compartilhar nas redes sociais." },
  pl: { title: "Foto com o selo Eu já votei 22 | Já Votei", description: "Crie sua foto de campanha com o selo oficial \"Eu já votei 22\" a partir da sua foto, pronta para compartilhar nas redes sociais." },
  missao: { title: "Foto com o selo Eu já votei 14 | Já Votei", description: "Crie sua foto de campanha com o selo oficial \"Eu já votei 14\" a partir da sua foto, pronta para compartilhar nas redes sociais." },
  psd: { title: "Foto com o selo Eu já votei 55 | Já Votei", description: "Crie sua foto de campanha com o selo oficial \"Eu já votei 55\" a partir da sua foto, pronta para compartilhar nas redes sociais." },
};

export function appPageSeo(pathname: string) {
  const slug = pathname.replace(/^\/|\/$/g, "");
  const s = PARTY_SEO[slug];
  return s ? { ...s, url: abs(`/${slug}`) } : null;
}

/** Troca as tags da home (index.html) pelas da tela pedida. */
export function applySeo(html: string, seo: { title: string; description: string; url: string }) {
  const t = esc(seo.title);
  const d = esc(seo.description);
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${esc(seo.url)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${esc(seo.url)}$2`);
}


/** /llms.txt: resumo do site em Markdown para assistentes de IA (formato llmstxt.org). Gerado dos posts. */
export function renderLlms(): string {
  const posts = [...getPosts()].sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  const oneLine = (t: string) => t.replace(/\s+/g, " ").trim();
  return `# ${SITE_NAME}

> ${SITE_NAME} é um site em português do Brasil em que a pessoa envia uma foto e recebe uma imagem de campanha com o selo "Eu já votei", pronta para compartilhar nas redes sociais. O site também tem um blog com guias de educação cívica e de eleições. O conteúdo é apartidário e explica conceitos: para regras, prazos e datas oficiais, a fonte é o TSE (tse.jus.br).

Como funciona: a pessoa escolhe o selo, envia uma foto e a imagem é gerada por inteligência artificial. Cada imagem usa 1 crédito (pacote de 10 créditos por R$ 10, com Pix ou cartão). As imagens geradas ficam salvas por 48 horas.

## Páginas principais

- [Início](${SITE_URL}/): escolha o selo e crie a sua foto.
- [Selo Eu já votei 13](${SITE_URL}/pt)
- [Selo Eu já votei 22](${SITE_URL}/pl)
- [Selo Eu já votei 14](${SITE_URL}/missao)
- [Selo Eu já votei 55](${SITE_URL}/psd)
- [Blog](${SITE_URL}/blog): todos os artigos.

## Blog: guias sobre eleições e cidadania

${posts.map(p => `- [${oneLine(p.title)}](${SITE_URL}/blog/${p.slug}): ${oneLine(p.description)}`).join("\n")}

## Outros formatos

- [Sitemap](${SITE_URL}/sitemap.xml)
- [Feed RSS do blog](${SITE_URL}/blog/rss.xml)
`;
}
