import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, useParams, useNavigate } from "react-router-dom";
import "./index.css";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowRight, Camera } from "lucide-react";
import votei13 from "@/assets/votei-13.png";
import votei22 from "@/assets/votei-22.png";
import votei14 from "@/assets/votei-14.png";
import votei55 from "@/assets/votei-55.png";

export const candidates = [
  {
    slug: "pt",
    name: "Lula",
    party: "PT — Partido dos Trabalhadores",
    number: "13",
    colors: "bg-red-600 text-white",
    badge: votei13,
    card: "/cards/card-pt.png",
    tagline: "Reconstrução e esperança para o Brasil.",
    prompt: "Foto de campanha no estilo do PT: fundo vermelho, camisa vermelha, bandeira do Brasil, ar de esperança e reconstrução, incluindo o selo oficial da campanha",
  },
  {
    slug: "pl",
    name: "Flávio Bolsonaro",
    party: "PL — Partido Liberal",
    number: "22",
    colors: "bg-green-700 text-yellow-300",
    badge: votei22,
    card: "/cards/card-pl.png",
    tagline: "Brasil verde e amarelo de volta.",
    prompt: "Foto de campanha no estilo do PL: verde e amarelo, bandeira do Brasil ao fundo, camisa da seleção, tom patriota, incluindo o selo oficial da campanha",
  },
  {
    slug: "missao",
    name: "Renan Santos",
    party: "Missão",
    number: "14",
    colors: "bg-zinc-800 text-white",
    badge: votei14,
    card: "/cards/card-missao.png",
    tagline: "Renovação e futuro para o país.",
    prompt: "Foto de campanha do Renan Santos: identidade do partido Missão, número 14 em destaque, tom jovem e renovador, incluindo o selo oficial da campanha",
  },
  {
    slug: "psd",
    name: "Ronaldo Caiado",
    party: "PSD",
    number: "55",
    colors: "bg-purple-700 text-white",
    badge: votei55,
    card: "/cards/card-psd.png",
    tagline: "Experiência que entrega resultado.",
    prompt: "Foto de campanha do Ronaldo Caiado: identidade do PSD, número 55 em destaque, tom de liderança e experiência, incluindo o selo oficial da campanha",
  },
];

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

  React.useEffect(() => {
    refresh();
    // Quem volta do pagamento precisa revalidar no servidor.
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid")) {
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
    showEmail, saveEmail, requestEmail,
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

/** Blob amarelo decorativo atrás da colagem de polaroids. */
function Blob() {
  return (
    <svg
      className="absolute -inset-4 -z-10 h-full w-full text-amber-300"
      viewBox="0 0 400 400"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M200 25c55 0 105 20 138 55s50 90 46 138-38 88-80 112-100 30-140 22-84-30-108-72-30-95-22-140 26-84 66-108S145 25 200 25z" />
    </svg>
  );
}

/** Colagem de polaroids com os candidatos, giradas como na referência. */
function PolaroidCollage({ onPick }: { onPick: (slug: string) => void }) {
  const tiles = [
    { slug: "pt", rotate: "-rotate-6", lift: "-translate-y-3", z: "z-10" },
    { slug: "pl", rotate: "rotate-3", lift: "translate-y-2", z: "z-20" },
    { slug: "missao", rotate: "-rotate-2", lift: "translate-y-6", z: "z-30" },
  ];
  return (
    <div className="relative flex items-center justify-center py-6 lg:py-0">
      <Blob />
      <div className="relative flex items-center gap-1">
        {tiles.map(t => {
          const c = candidates.find(x => x.slug === t.slug);
          if (!c) return null;
          return (
            <button
              key={t.slug}
              type="button"
              onClick={() => onPick(t.slug)}
              aria-label={`Escolher ${c.name}, ${c.party}`}
              className={`group relative ${t.rotate} ${t.lift} ${t.z} w-28 transition-transform duration-300 hover:rotate-0 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-32 lg:w-36`}
            >
              <span className="block rounded-lg bg-white p-1.5 pb-5 shadow-xl ring-1 ring-black/10 transition-shadow group-hover:shadow-2xl">
                <span className="block overflow-hidden rounded-[3px] bg-muted">
                  {c.card ? (
                    <img
                      src={c.card}
                      alt={c.name}
                      className="block w-full object-cover"
                      style={{ aspectRatio: "1 / 1", objectPosition: "60% 16%" }}
                      loading="lazy"
                    />
                  ) : (
                    <span className={`block w-full ${c.colors}`} style={{ aspectRatio: "1 / 1" }} />
                  )}
                </span>
                <span className="mt-1.5 block text-center text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
                  {c.party.split(" — ")[0]}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Arte do hero (polaroids + seta "Envie sua foto" + blob). Cai na colagem em DOM se faltar o arquivo. */
function HeroArtwork({ onPick }: { onPick: (slug: string) => void }) {
  const [ok, setOk] = React.useState(false);

  if (ok) {
    return (
      <picture>
        <source srcSet="/hero/hero.webp" type="image/webp" />
        <img
          src="/hero/hero.png"
          alt="Exemplos de fotos de campanha geradas pelo Já Votei"
          onLoad={() => setOk(true)}
          width={1100}
          height={698}
          className="mx-auto w-full max-w-md select-none lg:ml-auto lg:mr-0 lg:max-w-xl"
          draggable={false}
        />
      </picture>
    );
  }

  return (
    <div className="relative">
      <img
        src="/hero/hero.png"
        alt=""
        aria-hidden="true"
        onLoad={() => setOk(true)}
        className="hidden"
      />
      <PolaroidCollage onPick={onPick} />
    </div>
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

function Home() {
  const navigate = useNavigate();
  const { credits, loading, showEmail, saveEmail } = useCredits();

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="relative mx-auto max-w-6xl px-6 pb-16">
        <header className="grid items-center gap-8 pt-12 pb-12 lg:grid-cols-2 lg:gap-10 lg:pt-16">
          <div className="max-w-lg text-center lg:text-left">
            <h1 className="text-5xl font-extrabold tracking-tight sm:text-6xl">
              Já{" "}
              <span className="relative inline-block text-red-600">
                Votei
                <MarkerUnderline />
              </span>
            </h1>
            <p className="mt-5 text-lg text-muted-foreground">
              Envie sua foto e receba uma imagem de campanha com o selo oficial — pronta para compartilhar.
            </p>

            <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <a
                href="#partidos"
                className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-neutral-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-white"
              >
                Escolher meu partido
                <ArrowRight className="size-4" />
              </a>
              <CreditsPill credits={credits} loading={loading} />
            </div>

            <p className="mt-6 inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Camera className="size-3.5" />
              Sua foto não é publicada. Cada imagem consome 1 crédito.
            </p>

            {showEmail && (
              <div className="mt-6 text-left">
                <EmailPrompt onSubmit={saveEmail} credits={credits} />
              </div>
            )}
          </div>

          <HeroArtwork onPick={slug => navigate(`/${slug}`)} />
        </header>

        <div id="partidos" className="scroll-mt-6">

        <div className="mb-5 flex items-baseline justify-between gap-4 border-t pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Escolha um partido
          </h2>
          <span className="text-xs text-muted-foreground">{candidates.length} opções</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {candidates.map(c => (
            <CandidateCard key={c.slug} c={c} onSelect={() => navigate(`/${c.slug}`)} />
          ))}
        </div>
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Cada imagem consome 1 crédito. Você pode comprar mais a qualquer momento na página do candidato.
        </p>
      </div>
    </div>
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
    credits, pending, loading: creditsLoading, refresh,
    showEmail, saveEmail, requestEmail,
    checking, checkMsg, checkPayment,
  } = useCredits();
  const {
    file, preview, prompt, setPrompt, result, loading, error, onFile, submit,
  } = useEditImage(refresh, credits, requestEmail, c?.slug);
  const [initialized, setInitialized] = React.useState(false);

  const buy = async () => {
    const r = await fetch("/api/checkout", { method: "POST" });
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

      <Card className="w-full max-w-xl mx-auto">
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
          <Button onClick={submit} disabled={loading || creditsLoading || !file || !prompt || credits <= 0} className="w-full">
            {loading ? "Criando sua foto..." : creditsLoading ? "Carregando..." : "Criar foto com o selo"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {creditsLoading ? (
              "Carregando seu saldo..."
            ) : (
              <>Você tem <strong>{credits}</strong> crédito(s) • cada imagem consome 1</>
            )}
          </p>
          {pending && (
            <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-2">
              <p className="text-sm text-muted-foreground">
                Terminou de pagar? O Pix pode demorar alguns minutos para confirmar.
              </p>
              <Button onClick={checkPayment} disabled={checking} className="w-full">
                {checking ? "Conferindo pagamento..." : "Já paguei"}
              </Button>
              {checkMsg && <p className="text-sm text-muted-foreground">{checkMsg}</p>}
            </div>
          )}
          <Button variant="outline" onClick={buy} className="w-full">
            Comprar 10 créditos — R$ 10 (Pix ou Cartão)
          </Button>
          {showEmail && <EmailPrompt onSubmit={saveEmail} credits={credits} />}
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
