import React from "react";
import ReactDOM from "react-dom/client";
import { createPortal } from "react-dom";
import { BrowserRouter, Routes, Route, Link, useParams, useNavigate } from "react-router-dom";
import "./index.css";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import votei13 from "@/assets/votei-13.webp";
import votei22 from "@/assets/votei-22.webp";
import votei14 from "@/assets/votei-14.webp";
import votei55 from "@/assets/votei-55.webp";

export const candidates = [
  {
    slug: "pt",
    name: "Lula",
    party: "PT — Partido dos Trabalhadores",
    number: "13",
    colors: "bg-red-600 text-white",
    accent: "#ef4444",
    accentFg: "#ffffff",
    badge: votei13,
    card: "/cards/card-pt.webp",
    tagline: "Reconstrução e esperança para o Brasil.",
    prompt: "Foto de campanha no estilo do PT: fundo vermelho, camisa vermelha, bandeira do Brasil, ar de esperança e reconstrução, incluindo o selo oficial da campanha",
  },
  {
    slug: "pl",
    name: "Flávio Bolsonaro",
    party: "PL — Partido Liberal",
    number: "22",
    colors: "bg-green-700 text-yellow-300",
    accent: "#facc15",
    accentFg: "#14532d",
    badge: votei22,
    card: "/cards/card-pl.webp",
    tagline: "Brasil verde e amarelo de volta.",
    prompt: "Foto de campanha no estilo do PL: verde e amarelo, bandeira do Brasil ao fundo, camisa da seleção, tom patriota, incluindo o selo oficial da campanha",
  },
  {
    slug: "missao",
    name: "Renan Santos",
    party: "Missão",
    number: "14",
    colors: "bg-zinc-800 text-white",
    accent: "#f97316",
    accentFg: "#ffffff",
    badge: votei14,
    card: "/cards/card-missao.webp",
    tagline: "Renovação e futuro para o país.",
    prompt: "Foto de campanha do Renan Santos: identidade do partido Missão, número 14 em destaque, tom jovem e renovador, incluindo o selo oficial da campanha",
  },
  {
    slug: "psd",
    name: "Ronaldo Caiado",
    party: "PSD",
    number: "55",
    colors: "bg-purple-700 text-white",
    accent: "#c084fc",
    accentFg: "#3b0764",
    badge: votei55,
    card: "/cards/card-psd.webp",
    tagline: "Experiência que entrega resultado.",
    prompt: "Foto de campanha do Ronaldo Caiado: identidade do PSD, número 55 em destaque, tom de liderança e experiência, incluindo o selo oficial da campanha",
  },
];

// Himetrica (script no index.html). Falha em silêncio: bloqueador de anúncios não pode quebrar o app.
declare global {
  interface Window {
    himetrica?: {
      track: (name: string, props?: Record<string, unknown>) => void;
      identify: (user: { name?: string; email?: string; metadata?: Record<string, unknown> }) => void;
    };
  }
}

function track(name: string, props?: Record<string, unknown>) {
  try {
    window.himetrica?.track(name, props);
  } catch {}
}

const PACK_PRICE = 10;

function useCredits() {
  const [credits, setCredits] = React.useState(0);
  const [email, setEmail] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [showEmail, setShowEmail] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [checkMsg, setCheckMsg] = React.useState("");

  const refresh = React.useCallback(async () => {
    const r = await fetch("/api/credits");
    const data = await r.json();
    setCredits(Number(data.credits || 0));
    setEmail(String(data.email || ""));
    setPending(Boolean(data.pending));
    setLoading(false);
  }, []);

  // Identifica quem já informou o email (nos retornos também, pois o tracker não guarda sessão do nosso app).
  React.useEffect(() => {
    if (!email) return;
    try {
      window.himetrica?.identify({ email, metadata: { type: "customer" } });
    } catch {}
  }, [email]);

  React.useEffect(() => {
    refresh();
    // Quem volta do pagamento precisa revalidar no servidor.
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid")) {
      track("purchase_completed", { product_id: "pack_10_creditos", price: PACK_PRICE, credits: 10 });
      setShowEmail(true);
      params.delete("paid");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, [refresh]);

  const saveEmail = async (email: string) => {
    const r = await fetch("/api/credits/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (r.ok) {
      const data = await r.json();
      setCredits(Number(data.credits || 0));
      setEmail(String(data.email || email));
      setShowEmail(false);
      track("email_saved");
      return true;
    }
    return false;
  };

  const requestEmail = React.useCallback(() => setShowEmail(true), []);

  // "Já paguei": pergunta à AbacatePay. Como não usamos webhook, o botão é
  // quem descobre que o Pix caiu — e por isso faz polling por um tempo.
  const checkPayment = React.useCallback(async () => {
    setChecking(true);
    setCheckMsg("");
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const r = await fetch("/api/credits/check", { method: "POST" });
        const data = await r.json();
        setCredits(Number(data.credits || 0));
        setPending(Boolean(data.pending));
        if (data.confirmed) {
          setCheckMsg("Pagamento confirmado! Seus créditos já estão disponíveis.");
          track("purchase_completed", { product_id: "pack_10_creditos", price: PACK_PRICE, credits: 10, via: "ja_paguei" });
          setShowEmail(true);
          return true;
        }
        if (attempt < 9) await new Promise(res => setTimeout(res, 3000));
      }
      setCheckMsg("Ainda não recebemos a confirmação. Se você pagou, tente de novo em alguns minutos.");
      return false;
    } catch {
      setCheckMsg("Não foi possível consultar agora. Tente novamente.");
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  return {
    credits, email, pending, loading, refresh,
    // Quem já informou o email não precisa informar de novo em outra compra.
    showEmail: showEmail && !loading && !email,
    saveEmail, requestEmail,
    checking, checkMsg, checkPayment,
  };
}

function useEditImage(
  refresh: () => void,
  credits: number,
  requestEmail: () => void,
  candidateSlug?: string,
) {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [result, setResult] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const onFile = (f: File | null) => {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : "");
  };

  const submit = async () => {
    if (!file || !prompt) return;
    if (credits <= 0) {
      setError("Você não tem créditos. Compre mais para gerar imagens.");
      return;
    }
    setLoading(true);
    setError("");
    setResult("");
    const fd = new FormData();
    fd.append("image", file);
    fd.append("prompt", prompt);
    if (candidateSlug) fd.append("candidate", candidateSlug);
    try {
      const r = await fetch("/api/edit-image", { method: "POST", body: fd });
      const data = await r.json();
      if (r.status === 403 && data.code === "email_required") {
        // O servidor barrou por falta de email. Abre o campo e deixa a pessoa tentar de novo.
        requestEmail();
        setError("");
      } else if (!r.ok) setError(data.error || "Não foi possível gerar a imagem.");
      else {
        setResult(data.image);
        track("image_generated", { candidate: candidateSlug });
        // O saldo é re-lido do servidor — o front nunca decrementa sozinho.
        refresh();
      }
    } catch {
      setError("Falha na requisição. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return { file, preview, prompt, setPrompt, result, loading, error, onFile, submit };
}

function CreditsPill({ credits, loading }: { credits: number; loading: boolean }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground shadow-xs">
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
        Carregando saldo...
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium shadow-xs ${
        credits > 0 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "border-border bg-background text-muted-foreground"
      }`}
    >
      <span className={`size-1.5 rounded-full ${credits > 0 ? "bg-emerald-500" : "bg-muted-foreground"}`} />
      {credits > 0 ? `${credits} crédito${credits > 1 ? "s" : ""} disponíve${credits > 1 ? "is" : "l"}` : "Sem créditos"}
    </span>
  );
}

/** Traço de marca-texto desenhado à mão, sob "Votei". */
function MarkerUnderline() {
  return (
    <svg
      className="absolute -bottom-2 left-0 w-full text-yellow-400"
      height="18"
      viewBox="0 0 220 18"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M4 12.5C42 5.5 92 3.5 138 5.5c28 1.2 52 3.5 78 6"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
}

function CandidateCard({ c, onSelect }: { c: (typeof candidates)[number]; onSelect: () => void }) {
  const [artOk, setArtOk] = React.useState(Boolean(c.card));

  // A arte já vem com nome, número e botão desenhados — então ela é o card inteiro.
  // Se o arquivo não carregar, cai no card em DOM com o mesmo conteúdo.
  if (c.card && artOk) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Criar minha foto para ${c.name}, ${c.party}, número ${c.number}`}
        className="group relative block w-full overflow-hidden rounded-2xl shadow-sm ring-1 ring-black/5 transition duration-200 hover:-translate-y-1 hover:shadow-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <img
          src={c.card}
          alt={`Cartão do ${c.party}: ${c.name}, número ${c.number}`}
          onError={() => setArtOk(false)}
          width={539}
          height={703}
          className="block w-full transition-transform duration-300 group-hover:scale-[1.03]"
          loading="lazy"
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex h-full flex-col justify-between gap-6 overflow-hidden rounded-2xl p-6 text-left shadow-sm ring-1 transition duration-200 hover:-translate-y-1 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${c.colors}`}
    >
      {/* brilho diagonal no hover */}
      <span className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-white/15 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />

      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="inline-flex items-center rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest">
            {c.party}
          </span>
          <h2 className="mt-3 text-2xl font-extrabold leading-tight">{c.name}</h2>
          <p className="mt-1 text-sm opacity-85">{c.tagline}</p>
        </div>
        <img
          src={c.badge}
          alt={`Selo ${c.party}`}
          className="size-24 shrink-0 object-contain drop-shadow-lg transition-transform duration-300 group-hover:scale-105 sm:size-28"
        />
      </div>

      <div className="relative flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-widest opacity-80">Nº {c.number}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-sm font-semibold transition-colors group-hover:bg-white/30">
          Criar minha foto
          <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

type BlogPostLink = { slug: string; title: string; description: string };

function useBlogPosts() {
  const [posts, setPosts] = React.useState<BlogPostLink[]>([]);
  React.useEffect(() => {
    fetch("/api/blog")
      .then(r => (r.ok ? r.json() : []))
      .then(setPosts)
      .catch(() => {});
  }, []);
  return posts;
}

function Home() {
  const navigate = useNavigate();
  const { credits, loading, showEmail, saveEmail } = useCredits();
  const posts = useBlogPosts();

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-4xl px-6 pb-16">
        <header className="flex items-center justify-between gap-4 py-6">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Já{" "}
            <span className="relative inline-block text-red-600">
              Votei
              <MarkerUnderline />
            </span>
          </h1>
          <CreditsPill credits={credits} loading={loading} />
        </header>

        {showEmail && <EmailModal onSubmit={saveEmail} credits={credits} />}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {candidates.map(c => (
            <CandidateCard key={c.slug} c={c} onSelect={() => { track("candidate_selected", { candidate: c.slug }); navigate(`/${c.slug}`); }} />
          ))}
        </div>

        {posts.length > 0 && (
          <section className="mt-14" aria-labelledby="blog-title">
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 id="blog-title" className="text-xl font-bold tracking-tight">Antes de votar, leia</h2>
              <a href="/blog" className="text-sm font-medium text-red-600 hover:underline">Ver todos →</a>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {posts.map(p => (
                <li key={p.slug}>
                  <a
                    href={`/blog/${p.slug}`}
                    className="block h-full rounded-xl bg-white p-4 ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <span className="block font-semibold leading-snug">{p.title}</span>
                    <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">{p.description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Sua foto não é publicada. Cada imagem consome 1 crédito.
        </p>
      </div>
    </div>
  );
}

// Portal no body: o Card tem backdrop-blur, que prenderia o position:fixed dentro dele.
function EmailModal(props: { onSubmit: (e: string) => Promise<boolean>; credits: number }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-2 text-neutral-900 shadow-2xl">
        <EmailPrompt {...props} />
      </div>
    </div>,
    document.body,
  );
}

function EmailPrompt({ onSubmit, credits }: { onSubmit: (e: string) => Promise<boolean>; credits: number }) {
  const [email, setEmail] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState("");

  const save = async () => {
    setSaving(true);
    setErr("");
    const ok = await onSubmit(email);
    if (!ok) setErr("Confira o email e tente novamente.");
    setSaving(false);
  };

  return (
    <div className="rounded-lg border border-green-600/40 bg-green-500/10 p-4 space-y-3">
      <p className="font-semibold">
        {credits > 0 ? `Pagamento confirmado — ${credits} créditos disponíveis!` : "Pagamento recebido"}
      </p>
      <p className="text-sm text-muted-foreground">
        Deixe seu email para guardar a prova da compra e não perder seus créditos.
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="seu@email.com"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <Button onClick={save} disabled={saving || !email}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

function CandidatePage() {
  const { slug } = useParams();
  const c = candidates.find(c => c.slug === slug);
  const {
    credits, email, pending, loading: creditsLoading, refresh,
    showEmail, saveEmail, requestEmail,
    checking, checkMsg, checkPayment,
  } = useCredits();
  const {
    file, preview, prompt, setPrompt, result, loading, error, onFile, submit,
  } = useEditImage(refresh, credits, requestEmail, c?.slug);
  const [initialized, setInitialized] = React.useState(false);

  const buy = async () => {
    track("checkout_started", { candidate: c?.slug, price: PACK_PRICE });
    const r = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate: c?.slug }),
    });
    const data = await r.json();
    if (data.url) window.location.href = data.url;
    else alert(data.error || "Erro ao criar checkout");
  };

  React.useEffect(() => {
    if (c && !initialized) {
      setPrompt(c.prompt);
      setInitialized(true);
    }
  }, [c, initialized]);

  if (!c) return <div className="p-10 text-center">Candidato não encontrado. <Link to="/" className="underline">Voltar</Link></div>;

  return (
    <div className={`min-h-screen ${c.colors} p-6 space-y-8 relative overflow-hidden`}>
      <div
        className="absolute inset-0 opacity-50 pointer-events-none"
        style={{
          backgroundImage: `url(${c.badge})`,
          backgroundSize: "auto 100%",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
      <div className="relative z-10 space-y-8">
      <header className="text-center space-y-2 pt-6">
        <p className="uppercase tracking-widest text-sm opacity-80">{c.party} • {c.number}</p>
        <h1 className="text-4xl font-extrabold">{c.name}</h1>
        <p className="opacity-90">{c.tagline}</p>
        <img src={c.badge} className="w-32 h-32 mx-auto object-contain" />
      </header>

      <Card className="w-full max-w-xl mx-auto bg-white/80 text-neutral-900 shadow-2xl ring-1 ring-white/60 backdrop-blur-md">
        <CardHeader>
          <CardTitle>Sua foto de campanha</CardTitle>
          <CardDescription>Envie uma foto sua e a IA cria a imagem no estilo da campanha do {c.name}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label
            htmlFor="image"
            className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/50 p-8 text-center cursor-pointer hover:bg-muted transition-colors"
          >
            <span className="text-lg font-semibold">Envie sua imagem</span>
            <span className="text-sm text-muted-foreground">
              Vamos gerar uma personalizada para você divulgar nas redes sociais
            </span>
            {file && <span className="text-xs text-primary font-medium">{file.name}</span>}
            <input
              id="image"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => onFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {preview && <img src={preview} className="rounded-md w-full" />}
          <div className="space-y-2">
            <Label htmlFor="prompt">Como você quer a imagem?</Label>
            <Textarea id="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} />
          </div>
          {!creditsLoading && credits <= 0 ? (
            <button
              onClick={buy}
              style={{ background: c.accent, color: c.accentFg }}
              className="w-full rounded-lg px-4 py-3 text-base font-bold shadow-lg transition hover:brightness-110 active:scale-[0.99]"
            >
              Comprar créditos — R$ 10 →
            </button>
          ) : (
            <Button onClick={submit} disabled={loading || creditsLoading || !file || !prompt} className="w-full">
              {loading ? "Criando sua foto..." : creditsLoading ? "Carregando..." : "Criar foto com o selo"}
            </Button>
          )}
          <div style={{ "--accent": c.accent, "--accent-fg": c.accentFg } as React.CSSProperties} className="rounded-2xl border border-neutral-900/10 bg-white/70 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">Seu saldo</p>
                <p className="text-3xl font-extrabold leading-none mt-1">
                  {creditsLoading ? "…" : credits}
                  <span className="ml-1 text-sm font-medium text-neutral-500">crédito{credits === 1 ? "" : "s"}</span>
                </p>
              </div>
              <p className="text-right text-xs text-neutral-500">1 crédito =<br />1 foto nova</p>
            </div>

            {pending && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                <p className="text-sm text-amber-900">
                  Terminou de pagar? O Pix pode demorar alguns minutos para confirmar.
                </p>
                <Button onClick={checkPayment} disabled={checking} className="w-full">
                  {checking ? "Conferindo pagamento..." : "Já paguei"}
                </Button>
                {checkMsg && <p className="text-sm text-amber-900">{checkMsg}</p>}
              </div>
            )}

            <div className="relative overflow-hidden rounded-xl bg-neutral-900 p-4 text-white">
              <span className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-[var(--accent)]/30 blur-2xl" />
              <span className="relative inline-flex rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[var(--accent-fg)]">
                Melhor oferta
              </span>
              <div className="relative mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-lg font-bold">Pacote com 10 fotos</p>
                  <p className="text-sm text-white/70">Só R$ 1 por foto • sem assinatura</p>
                </div>
                <p className="text-3xl font-extrabold">R$ 10</p>
              </div>
              <ul className="relative mt-3 space-y-1 text-sm text-white/85">
                <li>✓ Pix aprovado na hora ou cartão</li>
                <li>✓ Créditos não expiram</li>
                <li>✓ Foto pronta para postar nas redes</li>
              </ul>
              <button
                onClick={buy}
                className="relative mt-4 w-full rounded-lg bg-[var(--accent)] px-4 py-3 text-base font-bold text-[var(--accent-fg)] shadow-lg transition hover:brightness-110 active:scale-[0.99]"
              >
                Quero meus 10 créditos →
              </button>
            </div>
          </div>
          {(showEmail || (!creditsLoading && credits > 0 && !email)) && <EmailModal onSubmit={saveEmail} credits={credits} />}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {result && (
            <div className="space-y-2">
              <Label>Resultado</Label>
              <img src={result} className="rounded-md w-full" />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-center">
        <Link to="/" className="opacity-80 underline">← Escolher outro candidato</Link>
      </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/:slug" element={<CandidatePage />} />
    </Routes>
  </BrowserRouter>
);
