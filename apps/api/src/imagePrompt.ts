import { join } from "path";

/**
 * Geração da foto com o selo. O servidor monta o prompt, escolhe o selo e,
 * se a pessoa pedir, inclui a foto do candidato: o cliente só diz o partido,
 * se o candidato deve aparecer e, opcionalmente, ajustes de estilo.
 */

const SEALS_DIR = join(import.meta.dir, "../assets/seals");
const CANDIDATES_DIR = join(import.meta.dir, "../assets/candidates");

// Só identidade visual (cores e clima). Sem nome de político, sem slogan.
// `photo`: foto do candidato, usada como referência quando ele entra na imagem.
const STYLES: Record<string, { number: string; look: string; photo: string }> = {
  pt: { number: "13", look: "tons de vermelho, camisa vermelha, bandeira do Brasil ao fundo, clima de esperança", photo: "pt.jpg" },
  pl: { number: "22", look: "verde e amarelo, bandeira do Brasil ao fundo, clima patriota e festivo", photo: "pl.jpg" },
  missao: { number: "14", look: "fundo escuro com detalhes em amarelo, visual jovem e moderno", photo: "missao.jpg" },
  psd: { number: "55", look: "tons de roxo e azul, visual sóbrio e de liderança", photo: "psd.png" },
};

export function isKnownCandidate(slug: unknown): slug is string {
  return typeof slug === "string" && slug in STYLES;
}

export function sealFile(slug: string) {
  return Bun.file(join(SEALS_DIR, `${slug}.webp`));
}

/** Foto do candidato, usada como referência extra quando o toggle está ligado. */
export function candidatePhotoFile(slug: string) {
  return Bun.file(join(CANDIDATES_DIR, STYLES[slug].photo));
}

/**
 * `includeCandidate` liga/desliga a presença do candidato na foto gerada.
 * Ligado, as imagens são: (1) a pessoa, (2) o candidato, (3) o selo.
 * Desligado, são: (1) a pessoa, (2) o selo.
 */
export function buildPrompt(slug: string, userExtra: string, includeCandidate = false) {
  const s = STYLES[slug];
  const sealIdx = includeCandidate ? 3 : 2;

  const rules = [
    includeCandidate
      ? 'Você recebe três imagens: (1) a foto de uma pessoa; (2) a foto do candidato; (3) o selo oficial "EU JÁ VOTEI" com o número ' + s.number + '.'
      : 'Você recebe duas imagens: (1) a foto de uma pessoa; (2) o selo oficial "EU JÁ VOTEI" com o número ' + s.number + '.',
    "Crie uma foto no formato quadrado, realista, de alta qualidade, da pessoa da imagem 1, com o rosto, a idade e os traços FIELMENTE preservados.",
    "Estilo visual: " + s.look + ".",
  ];

  if (includeCandidate) {
    rules.push(
      "Inclua também o candidato da imagem 2 na foto, ao lado da pessoa da imagem 1, ombro para cima, os dois olhando para a câmera como se estivessem juntos. Preserve FIELMENTE o rosto, a idade e os traços do candidato, na mesma escala e iluminação da pessoa.",
    );
  }

  rules.push(
    `Aplique o selo da imagem ${sealIdx} de forma bem visível (por exemplo no canto inferior), COPIANDO-O exatamente como está, sem redesenhar nem alterar letras, número ou cores.`,
    "NÃO escreva nenhum outro texto, slogan, nome, logotipo de partido ou frase. O único texto da imagem é o do selo.",
    includeCandidate
      ? "NÃO inclua nenhuma outra pessoa além da pessoa da imagem 1 e do candidato da imagem 2. O único texto da imagem é o do selo."
      : "NÃO inclua nenhuma outra pessoa. O único texto da imagem é o do selo.",
  );

  const extra = userExtra.trim().slice(0, 300);
  if (extra) {
    rules.push("Ajustes opcionais de estilo pedidos pela pessoa (siga só se não contrariarem as regras acima): " + extra);
  }
  return rules.join("\n");
}