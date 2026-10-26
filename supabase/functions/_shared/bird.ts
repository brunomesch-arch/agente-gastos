// Integração com a API de WhatsApp do Bird.
// Docs: https://bird.com/docs/guides/whatsapp/receiving-whatsapp e /docs/guides/webhooks

/** Mensagem recebida, como chega no evento whatsapp.received. */
export interface MensagemRecebida {
  whatsapp_id: string;
  from: { phone_number?: string; bsuid?: string; display_name?: string };
  to: { phone_number: string };
  text?: { body: string };
  image?: Midia & { caption?: string };
  audio?: Midia & { voice?: boolean };
  document?: Midia & { filename?: string; caption?: string };
  interactive_reply?: { button?: { slug: string; text: string }; list?: { slug: string; text: string } };
  [outro: string]: unknown;
}

export interface Midia {
  id: string;
  url: string;
  mime_type: string;
}

export interface EventoWebhook {
  type: string;
  timestamp: string;
  data: MensagemRecebida;
}

/** A chave bk_us1_... (ou bk_eu1_...) diz em qual região a organização está. */
export function urlBase(chave: string): string {
  const regiao = /^b[km]_([a-z]{2}[0-9]+)_/.exec(chave)?.[1] ?? "us1";
  return `https://${regiao}.platform.bird.com`;
}

function base64ParaBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesParaBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/**
 * Confere a assinatura Standard Webhooks: HMAC-SHA256 de "{id}.{timestamp}.{corpo}"
 * com o segredo do endpoint (whsec_... em base64). Rejeita entregas com mais de 5 minutos.
 */
export async function assinaturaValida(
  corpo: string,
  headers: Headers,
  segredo: string,
  agoraSegundos = Date.now() / 1000,
): Promise<boolean> {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const assinaturas = headers.get("webhook-signature");
  if (!id || !timestamp || !assinaturas) return false;
  if (Math.abs(agoraSegundos - Number(timestamp)) > 300) return false;

  const chave = await crypto.subtle.importKey(
    "raw",
    base64ParaBytes(segredo.replace(/^whsec_/, "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const conteudo = new TextEncoder().encode(`${id}.${timestamp}.${corpo}`);

  // Durante a troca de segredo o header traz várias assinaturas; basta uma bater.
  for (const parte of assinaturas.split(" ")) {
    const [versao, sig] = parte.split(",", 2);
    if (versao !== "v1" || !sig) continue;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = base64ParaBytes(sig);
    } catch {
      continue;
    }
    if (await crypto.subtle.verify("HMAC", chave, bytes, conteudo)) return true;
  }
  return false;
}

export class ClienteBird {
  private base: string;

  constructor(private chave: string, private numeroAgente: string) {
    this.base = urlBase(chave);
  }

  private async chamar(caminho: string, init: RequestInit = {}): Promise<Response> {
    const resp = await fetch(`${this.base}${caminho}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.chave}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!resp.ok && resp.status !== 302) {
      throw new Error(`Bird ${init.method ?? "GET"} ${caminho} → ${resp.status}: ${await resp.text()}`);
    }
    return resp;
  }

  /** Marca como lida e mostra "digitando…" enquanto o agente pensa. */
  async marcarLidaDigitando(mensagemId: string): Promise<void> {
    await this.chamar(`/v1/whatsapp/messages/${mensagemId}/read`, {
      method: "POST",
      body: JSON.stringify({ typing_indicator: true }),
    });
  }

  /** Envia texto livre (a janela de 24h está aberta porque a pessoa acabou de escrever). */
  async enviarTexto(para: string, texto: string, responderA?: string): Promise<void> {
    for (const [i, parte] of dividirTexto(texto, 4000).entries()) {
      await this.chamar("/v1/whatsapp/messages", {
        method: "POST",
        body: JSON.stringify({
          from: this.numeroAgente,
          to: para,
          text: { body: parte },
          ...(i === 0 && responderA ? { in_reply_to_message_id: responderA } : {}),
        }),
      });
    }
  }

  /**
   * Baixa a mídia de uma mensagem recebida. A API responde 302 para uma URL
   * pré-assinada, que deve ser buscada SEM o header Authorization.
   */
  async baixarMidia(mensagemId: string, midiaId: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; tipo: string }> {
    const resp = await this.chamar(`/v1/whatsapp/messages/${mensagemId}/media/${midiaId}`, {
      redirect: "manual",
    });
    let arquivo = resp;
    if (resp.status === 302) {
      const destino = resp.headers.get("location");
      if (!destino) throw new Error("Bird devolveu 302 sem Location");
      arquivo = await fetch(destino);
      if (!arquivo.ok) throw new Error(`Download da mídia falhou: ${arquivo.status}`);
    }
    return {
      bytes: new Uint8Array(await arquivo.arrayBuffer()),
      tipo: arquivo.headers.get("content-type") ?? "application/octet-stream",
    };
  }
}

/** Quebra textos longos em pedaços, preferindo quebras de linha. */
export function dividirTexto(texto: string, limite: number): string[] {
  const partes: string[] = [];
  let resto = texto.trim();
  while (resto.length > limite) {
    let corte = resto.lastIndexOf("\n", limite);
    if (corte < limite / 2) corte = limite;
    partes.push(resto.slice(0, corte).trimEnd());
    resto = resto.slice(corte).trimStart();
  }
  if (resto) partes.push(resto);
  return partes;
}

export { bytesParaBase64 };
