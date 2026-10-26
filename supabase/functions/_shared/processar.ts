import type Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { rodarAgente } from "./agente.ts";
import { bytesParaBase64, ClienteBird, type MensagemRecebida } from "./bird.ts";
import { db, env, formatarReais, FUSO, hojeISO } from "./config.ts";
import type { Categoria, Contexto, Membro, Origem } from "./ferramentas.ts";
import { variantesTelefone } from "./telefone.ts";
import { transcreverAudio } from "./transcricao.ts";

type Bloco = Anthropic.Beta.Messages.BetaContentBlockParam;
type Mensagem = Anthropic.Beta.Messages.BetaMessageParam;

const IMAGENS_ACEITAS = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const HISTORICO_MAX_MENSAGENS = 10;
const HISTORICO_JANELA_HORAS = 6;

const bird = new ClienteBird(env("BIRD_API_KEY"), env("BIRD_NUMERO_AGENTE"));

/** Entrada já preparada para o Claude, mais o que vai para o histórico. */
interface Entrada {
  blocos: Bloco[];
  textoHistorico: string;
  origem: Origem;
  comprovantePath?: string;
}

export async function processarMensagem(msg: MensagemRecebida): Promise<void> {
  const telefone = msg.from.phone_number;
  if (!telefone) return; // contato sem número (só username): não é ninguém da casa

  const { data: membros, error } = await db.from("membros").select("id, nome, telefone");
  if (error) throw new Error(error.message);
  const variantes = variantesTelefone(telefone);
  const membro = (membros as Membro[]).find((m) => variantes.includes(m.telefone));
  if (!membro) {
    // Número desconhecido: ignora em silêncio (não gasta nada e não expõe o agente).
    console.log(`Mensagem ignorada de número não cadastrado: ${telefone}`);
    return;
  }

  const responderPara = telefone;
  try {
    await bird.marcarLidaDigitando(msg.whatsapp_id).catch((e) => console.warn("read/typing falhou", e));

    const entrada = await prepararEntrada(msg);
    if (!entrada) {
      await bird.enviarTexto(
        responderPara,
        "Por enquanto eu entendo texto, áudio, foto e PDF. Manda o gasto de um desses jeitos? 🙂",
        msg.whatsapp_id,
      );
      return;
    }

    const { data: categorias, error: erroCat } = await db
      .from("categorias")
      .select("id, nome, emoji, orcamento_mensal")
      .eq("ativa", true)
      .order("nome");
    if (erroCat) throw new Error(erroCat.message);

    const ctx: Contexto = {
      membro,
      membros: membros as Membro[],
      categorias: categorias as Categoria[],
      origem: entrada.origem,
      whatsappId: msg.whatsapp_id,
      comprovantePath: entrada.comprovantePath,
    };

    const [historico, contexto] = await Promise.all([carregarHistorico(membro), montarContexto(ctx)]);
    const { resposta, ferramentasUsadas } = await rodarAgente(ctx, historico, [
      { type: "text", text: contexto },
      ...entrada.blocos,
    ]);
    console.log(`${membro.nome} (${entrada.origem}) → ${ferramentasUsadas.join(", ") || "sem ferramentas"}`);

    await bird.enviarTexto(responderPara, resposta, msg.whatsapp_id);
    await salvarHistorico(membro, entrada.textoHistorico, resposta);
  } catch (erro) {
    console.error("Falha ao processar mensagem", msg.whatsapp_id, erro);
    await bird
      .enviarTexto(responderPara, "⚠️ Tive um problema para processar essa mensagem. Tenta mandar de novo daqui a pouco?")
      .catch((e) => console.error("Também falhou ao avisar", e));
  }
}

async function prepararEntrada(msg: MensagemRecebida): Promise<Entrada | null> {
  if (msg.text) {
    return { blocos: [{ type: "text", text: msg.text.body }], textoHistorico: msg.text.body, origem: "texto" };
  }

  if (msg.interactive_reply) {
    const texto = msg.interactive_reply.button?.text ?? msg.interactive_reply.list?.text ?? "";
    return { blocos: [{ type: "text", text: texto }], textoHistorico: texto, origem: "texto" };
  }

  if (msg.audio) {
    const { bytes, tipo } = await bird.baixarMidia(msg.whatsapp_id, msg.audio.id);
    const transcricao = await transcreverAudio(bytes, msg.audio.mime_type || tipo);
    return {
      blocos: [{ type: "text", text: `[Áudio transcrito] ${transcricao}` }],
      textoHistorico: `[áudio] ${transcricao}`,
      origem: "audio",
    };
  }

  if (msg.image) {
    const { bytes, tipo } = await bird.baixarMidia(msg.whatsapp_id, msg.image.id);
    const mime = (msg.image.mime_type || tipo).split(";")[0];
    if (!IMAGENS_ACEITAS.includes(mime)) return null;
    const legenda = msg.image.caption?.trim();
    return {
      blocos: [
        { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: bytesParaBase64(bytes) } },
        { type: "text", text: legenda ? `[Foto enviada] Legenda: ${legenda}` : "[Foto enviada, sem legenda]" },
      ],
      textoHistorico: `[foto]${legenda ? " " + legenda : ""}`,
      origem: "foto",
      comprovantePath: await guardarComprovante(msg.whatsapp_id, bytes, mime),
    };
  }

  if (msg.document) {
    const { bytes, tipo } = await bird.baixarMidia(msg.whatsapp_id, msg.document.id);
    const mime = (msg.document.mime_type || tipo).split(";")[0];
    const legenda = msg.document.caption?.trim();
    const nota = `[Documento: ${msg.document.filename ?? "sem nome"}]${legenda ? " Legenda: " + legenda : ""}`;
    let arquivo: Bloco;
    if (mime === "application/pdf") {
      arquivo = { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytesParaBase64(bytes) } };
    } else if (IMAGENS_ACEITAS.includes(mime)) {
      arquivo = { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: bytesParaBase64(bytes) } };
    } else {
      return null;
    }
    return {
      blocos: [arquivo, { type: "text", text: nota }],
      textoHistorico: nota,
      origem: "documento",
      comprovantePath: await guardarComprovante(msg.whatsapp_id, bytes, mime),
    };
  }

  return null;
}

/** Guarda a foto/PDF no bucket privado, organizada por mês. Falha aqui não impede o registro. */
async function guardarComprovante(whatsappId: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<string | undefined> {
  const extensao = { "application/pdf": "pdf", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[mime] ?? "jpg";
  const caminho = `${hojeISO().slice(0, 7)}/${whatsappId}.${extensao}`;
  const { error } = await db.storage.from("comprovantes").upload(caminho, bytes, { contentType: mime, upsert: true });
  if (error) {
    console.warn("Não consegui guardar o comprovante", error.message);
    return undefined;
  }
  return caminho;
}

/** Contexto que muda a cada mensagem: vai junto com ela, não no prompt de sistema. */
async function montarContexto(ctx: Contexto): Promise<string> {
  const { data: recentes } = await db
    .from("lancamentos")
    .select("id, data, valor, descricao, estabelecimento, categorias(nome)")
    .eq("membro_id", ctx.membro.id)
    .order("criado_em", { ascending: false })
    .limit(5);

  const diaSemana = new Date().toLocaleDateString("pt-BR", { weekday: "long", timeZone: FUSO });
  const linhasRecentes = (recentes ?? []).map(
    // deno-lint-ignore no-explicit-any
    (l: any) =>
      `• id ${l.id} · ${l.data} · ${formatarReais(Number(l.valor))} · ${l.categorias?.nome} · ${l.descricao}` +
      (l.estabelecimento ? ` (${l.estabelecimento})` : ""),
  );

  return [
    "<contexto>",
    `Hoje: ${hojeISO()} (${diaSemana})`,
    `Quem está mandando: ${ctx.membro.nome}`,
    `Pessoas da casa: ${ctx.membros.map((m) => m.nome).join(", ")}`,
    `Categorias: ${ctx.categorias.map((c) => `${c.emoji ?? ""} ${c.nome}`.trim()).join(", ")}`,
    `Últimos lançamentos de ${ctx.membro.nome} (mais recente primeiro):`,
    ...(linhasRecentes.length ? linhasRecentes : ["(nenhum ainda)"]),
    "</contexto>",
  ].join("\n");
}

/** Últimas trocas de texto com a pessoa, para entender "na verdade foi 45". */
async function carregarHistorico(membro: Membro): Promise<Mensagem[]> {
  const desde = new Date(Date.now() - HISTORICO_JANELA_HORAS * 3600_000).toISOString();
  const { data } = await db
    .from("historico_conversa")
    .select("papel, texto")
    .eq("membro_id", membro.id)
    .gte("criado_em", desde)
    .order("id", { ascending: false })
    .limit(HISTORICO_MAX_MENSAGENS);

  const mensagens = (data ?? []).reverse().map((h) => ({ role: h.papel as "user" | "assistant", content: h.texto }));
  // A conversa precisa começar com o usuário, alternar papéis e terminar no assistente
  // (a mensagem nova do usuário vem logo depois).
  while (mensagens.length && mensagens[0].role !== "user") mensagens.shift();
  const alternadas = mensagens.filter((m, i) => i === 0 || m.role !== mensagens[i - 1].role);
  while (alternadas.length && alternadas[alternadas.length - 1].role !== "assistant") alternadas.pop();
  return alternadas;
}

async function salvarHistorico(membro: Membro, pergunta: string, resposta: string): Promise<void> {
  const { error } = await db.from("historico_conversa").insert([
    { membro_id: membro.id, papel: "user", texto: pergunta },
    { membro_id: membro.id, papel: "assistant", texto: resposta },
  ]);
  if (error) console.warn("Não consegui salvar o histórico", error.message);
}
