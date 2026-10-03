import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, useParams, useNavigate } from "react-router-dom";
import "./index.css";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
    tagline: "Experiência que entrega resultado.",
    prompt: "Foto de campanha do Ronaldo Caiado: identidade do PSD, número 55 em destaque, tom de liderança e experiência, incluindo o selo oficial da campanha",
  },
];

function useCredits() {
  const [credits, setCredits] = React.useState(0);
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gained = Number(params.get("credits") || 0);
    const stored = Number(localStorage.getItem("credits") || 0);
    const total = stored + gained;
    localStorage.setItem("credits", String(total));
    setCredits(total);
    if (gained) {
      params.delete("credits");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, []);
  const spend = () => {
    const next = credits - 1;
    localStorage.setItem("credits", String(next));
    setCredits(next);
  };
  return { credits, spend };
}

function useEditImage(spend: () => void, credits: number) {
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
    try {
      const r = await fetch("/api/edit-image", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) setError(data.error || "Não foi possível gerar a imagem.");
      else {
        setResult(data.image);
        spend();
      }
    } catch {
      setError("Falha na requisição. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return { file, preview, prompt, setPrompt, result, loading, error, onFile, submit };
}

function Home() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-muted/40 p-6 space-y-10">
      <header className="text-center space-y-2 pt-6">
        <h1 className="text-4xl font-extrabold tracking-tight">Já Votei</h1>
        <p className="text-muted-foreground text-lg">
          Transforme sua foto em uma imagem de campanha — no estilo da sua escolha.
        </p>
        <p className="text-muted-foreground">Escolha o candidato e crie sua foto com o selo oficial.</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-4xl mx-auto">
        {candidates.map(c => (
          <div key={c.slug} className={`rounded-xl p-6 flex gap-4 min-h-48 shadow overflow-hidden ${c.colors}`}>
            <div className="flex flex-col justify-between gap-6 flex-1">
              <div>
                <p className="text-sm uppercase tracking-widest opacity-80">{c.party}</p>
                <h2 className="text-2xl font-bold">{c.name}</h2>
                <p className="text-sm opacity-90 mt-1">{c.tagline}</p>
              </div>
              <Button variant="secondary" className="self-start" onClick={() => navigate(`/${c.slug}`)}>
                Criar foto para esse candidato
              </Button>
            </div>
            <img src={c.badge} className="w-44 h-44 self-center object-contain" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CandidatePage() {
  const { slug } = useParams();
  const c = candidates.find(c => c.slug === slug);
  const { credits, spend } = useCredits();
  const { file, preview, prompt, setPrompt, result, loading, error, onFile, submit } = useEditImage(spend, credits);
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
          <Button onClick={submit} disabled={loading || !file || !prompt || credits <= 0} className="w-full">
            {loading ? "Criando sua foto..." : "Criar foto com o selo"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Você tem <strong>{credits}</strong> crédito(s) • cada imagem consome 1
          </p>
          <Button variant="outline" onClick={buy} className="w-full">
            Comprar 10 créditos — R$ 10 (Pix ou Cartão)
          </Button>
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
