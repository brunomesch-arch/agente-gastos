import { env } from "./config.ts";

// O Bird entrega o áudio sem transcrição, e o Claude não recebe áudio.
// Usamos um serviço de transcrição (OpenAI ou Groq; a API é a mesma).
const PROVEDORES = {
  openai: {
    url: "https://api.openai.com/v1/audio/transcriptions",
    chave: "OPENAI_API_KEY",
    modelo: "gpt-4o-mini-transcribe",
  },
  groq: {
    url: "https://api.groq.com/openai/v1/audio/transcriptions",
    chave: "GROQ_API_KEY",
    modelo: "whisper-large-v3-turbo",
  },
} as const;

export async function transcreverAudio(bytes: Uint8Array<ArrayBuffer>, tipo: string): Promise<string> {
  const nome = env("TRANSCRICAO_PROVEDOR", "openai") as keyof typeof PROVEDORES;
  const provedor = PROVEDORES[nome];
  if (!provedor) throw new Error(`TRANSCRICAO_PROVEDOR inválido: ${nome}`);

  const extensao = tipo.includes("mpeg") ? "mp3" : tipo.includes("mp4") || tipo.includes("aac") ? "m4a" : "ogg";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: tipo.split(";")[0] }), `audio.${extensao}`);
  form.append("model", provedor.modelo);
  form.append("language", "pt");
  form.append("prompt", "Gastos pessoais em reais: valores, lojas, mercado, farmácia, Pix, cartão de crédito, débito.");

  const resp = await fetch(provedor.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env(provedor.chave)}` },
    body: form,
  });
  if (!resp.ok) throw new Error(`Transcrição falhou (${nome}): ${resp.status} ${await resp.text()}`);
  const { text } = await resp.json() as { text: string };
  return text.trim();
}
