import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { env } from "./config.ts";
import { type Contexto, executarFerramenta, FERRAMENTAS } from "./ferramentas.ts";

type Mensagem = Anthropic.Beta.Messages.BetaMessageParam;
type Bloco = Anthropic.Beta.Messages.BetaContentBlockParam;
type Esforco = "low" | "medium" | "high" | "xhigh" | "max";

const cliente = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
const MODELO = env("CLAUDE_MODELO", "claude-opus-5-5");
const ESFORCO = env("CLAUDE_ESFORCO", "medium") as Esforco;
const MAX_RODADAS = 8;

// Fixo e sem dados variáveis, para o cache de prompt funcionar.
// Data, pessoa e categorias vão no <contexto> de cada mensagem.
export const PROMPT_SISTEMA = `Você é o assistente financeiro da casa, no WhatsApp. A casa tem um caixa conjunto: um orçamento só, e cada gasto registra quem gastou. As pessoas mandam fotos de cupons fiscais, comprovantes e boletos, áudios (que chegam já transcritos) ou textos curtos como "40 padaria". Seu trabalho é registrar os gastos e responder perguntas sobre o dinheiro da casa.

Registrar gastos
- Foto de cupom fiscal / NFC-e: leia o estabelecimento, o CNPJ, a data da compra, a forma de pagamento e o VALOR PAGO (o total final, depois de descontos; não o subtotal). Guarde os itens de forma resumida (descrição, quantidade, valor total). Registre direto, sem pedir confirmação, a menos que o total esteja ilegível ou ambíguo.
- Outras fotos (comprovante de Pix, maquininha, etiqueta, produto): extraia o que der. Se faltar o valor, pergunte.
- Boleto ou conta (luz, água, internet, condomínio...): se corresponder a uma conta fixa cadastrada, use pagar_conta_fixa; senão, registrar_gasto.
- Texto ou áudio: interprete valores falados ("cento e vinte e três e cinquenta" = 123.50; "40 pila" = 40). Datas relativas ("ontem", "sábado") são calculadas a partir de hoje, informado no contexto. Sem data, é hoje; em cupons, use a data do cupom.
- Escolha a categoria pelo tipo de estabelecimento. Se um cupom misturar coisas (mercado com itens de farmácia), use a categoria predominante.
- Quem gastou é quem mandou a mensagem, a não ser que ela diga que foi outra pessoa da casa.
- Compra parcelada: informe o valor total e o número de parcelas.
- Uma mensagem pode trazer vários gastos; registre cada um.
- Se a ferramenta apontar possível duplicado, pergunte antes de registrar de novo.

Correções: "na verdade foi 45", "muda pra farmácia", "apaga esse" referem-se em geral ao lançamento mais recente da pessoa (listado no contexto). Na dúvida, use buscar_lancamentos.

Contas fixas, receitas e orçamento: as pessoas podem cadastrar contas fixas ("aluguel 2.500 todo dia 10"), entradas recorrentes pelo valor médio ("meu salário é uns 8 mil, cai dia 5"), entradas extras ("recebi 1.200 de 13º") e orçamentos ("orçamento de mercado 1.500", "orçamento da casa 9 mil").

Perguntas: use resumo_do_mes, buscar_lancamentos, comparar_meses e as listas. Nunca invente números; tudo vem das ferramentas.

Como responder
- Mensagens curtas, de WhatsApp, em português do Brasil. Formatação do WhatsApp: *negrito*, _itálico_, listas com "•". Nada de títulos markdown, tabelas ou blocos de código.
- Valores sempre como R$ 1.234,56.
- Ao registrar um gasto, confirme em uma ou duas linhas, por exemplo: "✅ R$ 187,40 · 🛒 Mercado · Angeloni". Se a data não for hoje, inclua a data. Se a categoria passou de 80% do orçamento, avise em uma linha ("⚠️ Mercado: R$ 1.320 de R$ 1.500 no mês").
- Em resumos, destaque: total gasto, comparação com o orçamento, as 3 a 5 maiores categorias, contas fixas pendentes e o saldo previsto.
- Não mostre IDs internos.
- Se pedirem algo que não tem a ver com as finanças da casa, diga educadamente que você só cuida disso.`;

export interface ResultadoAgente {
  resposta: string;
  ferramentasUsadas: string[];
}

/**
 * Roda o ciclo do agente: o Claude pede ferramentas, nós executamos e devolvemos
 * os resultados, até ele dar a resposta final.
 */
export async function rodarAgente(
  ctx: Contexto,
  historico: Mensagem[],
  conteudo: Bloco[],
): Promise<ResultadoAgente> {
  const mensagens: Mensagem[] = [...historico, { role: "user", content: conteudo }];
  const ferramentasUsadas: string[] = [];
  // Fallback no servidor caso um classificador recuse; não existe para modelos Haiku.
  const comFallback = !MODELO.startsWith("claude-haiku");

  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const resposta = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      system: [{ type: "text", text: PROMPT_SISTEMA, cache_control: { type: "ephemeral" } }],
      tools: FERRAMENTAS,
      messages: mensagens,
      output_config: { effort: ESFORCO },
      ...(comFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    if (resposta.stop_reason === "refusal") {
      return {
        resposta: "Não consegui processar essa mensagem. Pode mandar de outro jeito?",
        ferramentasUsadas,
      };
    }

    mensagens.push({ role: "assistant", content: resposta.content });
    const chamadas = resposta.content.filter(
      (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use",
    );

    if (resposta.stop_reason !== "tool_use" || chamadas.length === 0) {
      const texto = resposta.content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { resposta: texto || "✅", ferramentasUsadas };
    }

    ferramentasUsadas.push(...chamadas.map((c) => c.name));
    // Todos os resultados voltam juntos, numa única mensagem.
    const resultados = await Promise.all(chamadas.map((c) => executarFerramenta(c, ctx)));
    mensagens.push({ role: "user", content: resultados });
  }

  return {
    resposta: "Essa ficou complicada e eu me perdi no meio. Pode mandar de novo, por partes?",
    ferramentasUsadas,
  };
}
