import type Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { db, hojeISO } from "./config.ts";

type Ferramenta = Anthropic.Beta.Messages.BetaTool;

export interface Membro {
  id: string;
  nome: string;
  telefone: string;
}

export interface Categoria {
  id: number;
  nome: string;
  emoji: string | null;
  orcamento_mensal: number | null;
}

export type Origem = "foto" | "audio" | "texto" | "documento";

/** O que as ferramentas sabem sobre a mensagem que está sendo tratada. */
export interface Contexto {
  membro: Membro;
  membros: Membro[];
  categorias: Categoria[];
  origem: Origem;
  whatsappId: string;
  comprovantePath?: string;
}

/** Erro de uso que volta para o Claude corrigir (categoria errada, data inválida...). */
export class ErroFerramenta extends Error {}

// ───────────────────────── Definições (o que o Claude enxerga) ─────────────────────────

const categoriaProp = {
  type: "string",
  description: "Nome de uma categoria existente (veja a lista no contexto).",
};
const quemProp = {
  type: "string",
  description: "Nome de quem gastou ou recebeu. Omita para usar quem está mandando a mensagem.",
};
const dataProp = {
  type: "string",
  description: "Data no formato AAAA-MM-DD. Omita para hoje.",
};
const mesProp = {
  type: "string",
  description: "Mês no formato AAAA-MM. Omita para o mês atual.",
};
const formaPagamentoProp = {
  type: "string",
  enum: ["pix", "credito", "debito", "dinheiro", "boleto", "outro"],
};

export const FERRAMENTAS: Ferramenta[] = [
  {
    name: "registrar_gasto",
    description:
      "Registra um gasto (compra, cupom fiscal, conta avulsa). Para compra parcelada informe o valor TOTAL e o número de parcelas: " +
      "o sistema lança uma parcela por mês. Se a resposta trouxer possivel_duplicado, pergunte à pessoa antes de registrar de novo.",
    input_schema: {
      type: "object",
      properties: {
        valor: { type: "number", description: "Valor total pago em reais (ex: 187.4)." },
        descricao: { type: "string", description: "Descrição curta do gasto (ex: 'Compras do mês', 'Almoço')." },
        categoria: categoriaProp,
        estabelecimento: { type: "string", description: "Nome da loja/estabelecimento, se souber." },
        cnpj: { type: "string", description: "CNPJ do estabelecimento, se aparecer no cupom." },
        data: dataProp,
        forma_pagamento: formaPagamentoProp,
        parcelas: { type: "integer", minimum: 1, maximum: 48, description: "Número de parcelas, se parcelado no cartão." },
        itens: {
          type: "array",
          description: "Itens do cupom fiscal, quando houver.",
          items: {
            type: "object",
            properties: {
              descricao: { type: "string" },
              quantidade: { type: "number" },
              valor_total: { type: "number" },
            },
            required: ["descricao", "valor_total"],
          },
        },
        quem: quemProp,
        ignorar_duplicado: {
          type: "boolean",
          description: "Use true só depois que a pessoa confirmar que não é duplicado.",
        },
      },
      required: ["valor", "descricao", "categoria"],
    },
  },
  {
    name: "buscar_lancamentos",
    description: "Lista gastos registrados, com filtros. Use para responder perguntas e para achar o lançamento a corrigir.",
    input_schema: {
      type: "object",
      properties: {
        mes: mesProp,
        categoria: categoriaProp,
        texto: { type: "string", description: "Trecho da descrição ou do estabelecimento." },
        quem: { type: "string", description: "Filtra por pessoa." },
        limite: { type: "integer", minimum: 1, maximum: 50, description: "Padrão 20." },
      },
    },
  },
  {
    name: "editar_lancamento",
    description: "Corrige um gasto já registrado. Envie só os campos que mudam.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        valor: { type: "number" },
        descricao: { type: "string" },
        categoria: categoriaProp,
        estabelecimento: { type: "string" },
        data: dataProp,
        forma_pagamento: formaPagamentoProp,
        quem: quemProp,
      },
      required: ["id"],
    },
  },
  {
    name: "excluir_lancamento",
    description: "Apaga um gasto registrado (ex: lançado por engano ou em duplicidade).",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
    },
  },
  {
    name: "resumo_do_mes",
    description:
      "Resumo financeiro de um mês: total gasto, gasto por categoria (com orçamento), maiores estabelecimentos, " +
      "gasto por pessoa e forma de pagamento, contas fixas pagas e pendentes, receita prevista e saldo previsto.",
    input_schema: { type: "object", properties: { mes: mesProp } },
  },
  {
    name: "comparar_meses",
    description: "Total gasto em cada um dos últimos meses, para comparar a evolução.",
    input_schema: {
      type: "object",
      properties: { meses: { type: "integer", minimum: 2, maximum: 24, description: "Padrão 6." } },
    },
  },
  {
    name: "listar_contas_fixas",
    description: "Lista as contas fixas ativas e se cada uma já foi paga no mês.",
    input_schema: { type: "object", properties: { mes: mesProp } },
  },
  {
    name: "salvar_conta_fixa",
    description:
      "Cadastra uma conta fixa mensal (aluguel, luz, internet, escola...) ou altera uma existente (informe o id). " +
      "Para desativar uma conta, envie id e ativa=false.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Só para alterar uma conta existente." },
        nome: { type: "string" },
        valor_previsto: { type: "number", description: "Valor médio esperado por mês." },
        dia_vencimento: { type: "integer", minimum: 1, maximum: 31 },
        categoria: categoriaProp,
        ativa: { type: "boolean" },
      },
    },
  },
  {
    name: "pagar_conta_fixa",
    description:
      "Registra o pagamento do mês de uma conta fixa. Use quando chegar um boleto/comprovante de uma conta já cadastrada.",
    input_schema: {
      type: "object",
      properties: {
        conta_fixa_id: { type: "integer" },
        valor: { type: "number", description: "Valor efetivamente pago. Omita para usar o valor previsto." },
        data: dataProp,
        forma_pagamento: formaPagamentoProp,
        quem: quemProp,
        forcar: { type: "boolean", description: "true para registrar mesmo se a conta já consta paga no mês." },
      },
      required: ["conta_fixa_id"],
    },
  },
  {
    name: "listar_receitas",
    description: "Lista as entradas recorrentes (valor médio) e as entradas extras do mês.",
    input_schema: { type: "object", properties: { mes: mesProp } },
  },
  {
    name: "salvar_receita",
    description:
      "Cadastra uma entrada recorrente (salário, pró-labore, aluguel recebido...) pelo valor médio mensal, " +
      "ou altera uma existente (informe o id). Para desativar, envie id e ativa=false.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Só para alterar uma receita existente." },
        nome: { type: "string" },
        valor_medio: { type: "number" },
        dia_recebimento: { type: "integer", minimum: 1, maximum: 31 },
        quem: quemProp,
        ativa: { type: "boolean" },
      },
    },
  },
  {
    name: "registrar_receita_extra",
    description: "Registra uma entrada que acontece uma vez (13º, bônus, reembolso, venda de algo).",
    input_schema: {
      type: "object",
      properties: {
        valor: { type: "number" },
        descricao: { type: "string" },
        data: dataProp,
        quem: quemProp,
      },
      required: ["valor", "descricao"],
    },
  },
  {
    name: "definir_orcamento",
    description:
      "Define o orçamento mensal de uma categoria, ou o orçamento total da casa (omita a categoria). " +
      "Envie valor null para remover o orçamento.",
    input_schema: {
      type: "object",
      properties: {
        categoria: categoriaProp,
        valor: { type: ["number", "null"] },
      },
      required: ["valor"],
    },
  },
  {
    name: "criar_categoria",
    description: "Cria uma categoria nova. Só use se nenhuma categoria existente servir e a pessoa concordar.",
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string" },
        emoji: { type: "string" },
      },
      required: ["nome"],
    },
  },
];

// ───────────────────────── Utilitários ─────────────────────────

export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function resolverCategoria(ctx: Contexto, nome: unknown): Categoria {
  if (typeof nome !== "string" || !nome.trim()) throw new ErroFerramenta("Informe a categoria.");
  const alvo = normalizar(nome);
  const achada =
    ctx.categorias.find((c) => normalizar(c.nome) === alvo) ??
    ctx.categorias.find((c) => normalizar(c.nome).startsWith(alvo) || alvo.startsWith(normalizar(c.nome)));
  if (!achada) {
    throw new ErroFerramenta(
      `Categoria "${nome}" não existe. Use uma destas: ${ctx.categorias.map((c) => c.nome).join(", ")}.`,
    );
  }
  return achada;
}

function resolverMembro(ctx: Contexto, nome: unknown): Membro {
  if (typeof nome !== "string" || !nome.trim()) return ctx.membro;
  const alvo = normalizar(nome);
  const achado = ctx.membros.find((m) => {
    const n = normalizar(m.nome);
    return n === alvo || n.split(" ")[0] === alvo.split(" ")[0];
  });
  if (!achado) {
    throw new ErroFerramenta(`Pessoa "${nome}" não encontrada. Pessoas da casa: ${ctx.membros.map((m) => m.nome).join(", ")}.`);
  }
  return achado;
}

function valorPositivo(valor: unknown, campo = "valor"): number {
  const n = typeof valor === "string" ? Number(valor.replace(",", ".")) : Number(valor);
  if (!Number.isFinite(n) || n <= 0) throw new ErroFerramenta(`${campo} precisa ser um número maior que zero.`);
  return Math.round(n * 100) / 100;
}

function dataOuHoje(data: unknown): string {
  if (data === undefined || data === null || data === "") return hojeISO();
  if (typeof data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data) || isNaN(Date.parse(data))) {
    throw new ErroFerramenta(`Data inválida: ${data}. Use AAAA-MM-DD.`);
  }
  return data;
}

/** "2026-10" → "2026-10-01"; vazio → primeiro dia do mês atual. */
function inicioDoMes(mes: unknown): string {
  if (mes === undefined || mes === null || mes === "") return hojeISO().slice(0, 7) + "-01";
  if (typeof mes !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    throw new ErroFerramenta(`Mês inválido: ${mes}. Use AAAA-MM.`);
  }
  return `${mes}-01`;
}

function proximoMes(inicio: string): string {
  const [a, m] = inicio.split("-").map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Soma meses mantendo o dia (31/01 + 1 mês → 28/02 ou 29/02). */
export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const totalMeses = a * 12 + (m - 1) + meses;
  const ano = Math.floor(totalMeses / 12);
  const mes = (totalMeses % 12) + 1;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(d, ultimoDia)).padStart(2, "0")}`;
}

/** Divide um valor em parcelas de centavos exatos; a diferença vai na primeira. */
export function dividirParcelas(valor: number, parcelas: number): number[] {
  const centavos = Math.round(valor * 100);
  const base = Math.floor(centavos / parcelas);
  return Array.from({ length: parcelas }, (_, i) => (i === 0 ? centavos - base * (parcelas - 1) : base) / 100);
}

function textoSeguroParaFiltro(texto: string): string {
  // Vírgulas, parênteses e curingas quebram a sintaxe do filtro .or() do PostgREST.
  return texto.replace(/[,()%*\\]/g, " ").trim();
}

function falhou(erro: { message: string } | null): void {
  if (erro) throw new Error(erro.message);
}

const CAMPOS_LANCAMENTO =
  "id, data, valor, descricao, estabelecimento, forma_pagamento, parcela, conta_fixa_id, categorias(nome), membros(nome)";

// deno-lint-ignore no-explicit-any
function formatarLancamento(l: any) {
  return {
    id: l.id,
    data: l.data,
    valor: Number(l.valor),
    descricao: l.descricao,
    estabelecimento: l.estabelecimento,
    categoria: l.categorias?.nome,
    quem: l.membros?.nome,
    forma_pagamento: l.forma_pagamento,
    parcela: l.parcela,
    conta_fixa: l.conta_fixa_id !== null,
  };
}

async function totalCategoriaNoMes(categoria: Categoria, data: string) {
  const inicio = data.slice(0, 7) + "-01";
  const { data: linhas, error } = await db
    .from("lancamentos")
    .select("valor")
    .eq("categoria_id", categoria.id)
    .gte("data", inicio)
    .lt("data", proximoMes(inicio));
  falhou(error);
  const total = (linhas ?? []).reduce((s, l) => s + Number(l.valor), 0);
  return {
    categoria: categoria.nome,
    total_no_mes: Math.round(total * 100) / 100,
    orcamento_categoria: categoria.orcamento_mensal === null ? null : Number(categoria.orcamento_mensal),
  };
}

// ───────────────────────── Implementações ─────────────────────────

// deno-lint-ignore no-explicit-any
type Entrada = Record<string, any>;
type Implementacao = (e: Entrada, ctx: Contexto) => Promise<unknown>;

const IMPLEMENTACOES: Record<string, Implementacao> = {
  async registrar_gasto(e, ctx) {
    const valor = valorPositivo(e.valor);
    const data = dataOuHoje(e.data);
    const categoria = resolverCategoria(ctx, e.categoria);
    const membro = resolverMembro(ctx, e.quem);
    const parcelas = Math.max(1, Math.min(48, Math.floor(Number(e.parcelas ?? 1)) || 1));
    const valores = dividirParcelas(valor, parcelas);

    if (!e.ignorar_duplicado) {
      const { data: parecidos, error } = await db
        .from("lancamentos")
        .select(CAMPOS_LANCAMENTO)
        .in("valor", [...new Set([valor, valores[0]])])
        .gte("data", somarDias(data, -2))
        .lte("data", somarDias(data, 2))
        .limit(3);
      falhou(error);
      if (parecidos && parecidos.length > 0) {
        return {
          registrado: false,
          possivel_duplicado: parecidos.map(formatarLancamento),
          instrucao: "Pergunte se é o mesmo gasto. Se não for, chame de novo com ignorar_duplicado=true.",
        };
      }
    }

    const linhas = valores.map((v, i) => ({
      data: somarMeses(data, i),
      valor: v,
      descricao: e.descricao,
      estabelecimento: e.estabelecimento || null,
      cnpj: e.cnpj || null,
      categoria_id: categoria.id,
      membro_id: membro.id,
      forma_pagamento: e.forma_pagamento || null,
      parcela: parcelas > 1 ? `${i + 1}/${parcelas}` : null,
      origem: ctx.origem,
      itens: i === 0 && Array.isArray(e.itens) && e.itens.length ? e.itens : null,
      comprovante_path: i === 0 ? ctx.comprovantePath ?? null : null,
      whatsapp_id: ctx.whatsappId,
    }));
    const { data: inseridos, error } = await db.from("lancamentos").insert(linhas).select(CAMPOS_LANCAMENTO);
    falhou(error);

    return {
      registrado: true,
      lancamentos: (inseridos ?? []).map(formatarLancamento),
      orcamento: await totalCategoriaNoMes(categoria, data),
    };
  },

  async buscar_lancamentos(e, ctx) {
    const inicio = inicioDoMes(e.mes);
    let consulta = db
      .from("lancamentos")
      .select(CAMPOS_LANCAMENTO)
      .gte("data", inicio)
      .lt("data", proximoMes(inicio))
      .order("data", { ascending: false })
      .order("id", { ascending: false })
      .limit(Math.min(Number(e.limite) || 20, 50));
    if (e.categoria) consulta = consulta.eq("categoria_id", resolverCategoria(ctx, e.categoria).id);
    if (e.quem) consulta = consulta.eq("membro_id", resolverMembro(ctx, e.quem).id);
    if (typeof e.texto === "string" && textoSeguroParaFiltro(e.texto)) {
      const t = textoSeguroParaFiltro(e.texto);
      consulta = consulta.or(`descricao.ilike.%${t}%,estabelecimento.ilike.%${t}%`);
    }
    const { data, error } = await consulta;
    falhou(error);
    const lancamentos = (data ?? []).map(formatarLancamento);
    return {
      mes: inicio.slice(0, 7),
      quantidade: lancamentos.length,
      soma: Math.round(lancamentos.reduce((s, l) => s + l.valor, 0) * 100) / 100,
      lancamentos,
    };
  },

  async editar_lancamento(e, ctx) {
    const mudancas: Entrada = {};
    if (e.valor !== undefined) mudancas.valor = valorPositivo(e.valor);
    if (e.descricao !== undefined) mudancas.descricao = e.descricao;
    if (e.estabelecimento !== undefined) mudancas.estabelecimento = e.estabelecimento || null;
    if (e.data !== undefined) mudancas.data = dataOuHoje(e.data);
    if (e.forma_pagamento !== undefined) mudancas.forma_pagamento = e.forma_pagamento || null;
    if (e.categoria !== undefined) mudancas.categoria_id = resolverCategoria(ctx, e.categoria).id;
    if (e.quem !== undefined) mudancas.membro_id = resolverMembro(ctx, e.quem).id;
    if (Object.keys(mudancas).length === 0) throw new ErroFerramenta("Nenhum campo para alterar.");

    const { data, error } = await db.from("lancamentos").update(mudancas).eq("id", e.id).select(CAMPOS_LANCAMENTO);
    falhou(error);
    if (!data?.length) throw new ErroFerramenta(`Lançamento ${e.id} não encontrado.`);
    return { atualizado: formatarLancamento(data[0]) };
  },

  async excluir_lancamento(e) {
    const { data, error } = await db.from("lancamentos").delete().eq("id", e.id).select(CAMPOS_LANCAMENTO);
    falhou(error);
    if (!data?.length) throw new ErroFerramenta(`Lançamento ${e.id} não encontrado.`);
    return { excluido: formatarLancamento(data[0]) };
  },

  async resumo_do_mes(e) {
    const { data, error } = await db.rpc("resumo_mes", { p_mes: inicioDoMes(e.mes) });
    falhou(error);
    return data;
  },

  async comparar_meses(e) {
    const { data, error } = await db.rpc("historico_meses", { p_meses: Number(e.meses) || 6 });
    falhou(error);
    return data;
  },

  async listar_contas_fixas(e) {
    const { data, error } = await db.rpc("resumo_mes", { p_mes: inicioDoMes(e.mes) });
    falhou(error);
    return {
      mes: data.mes,
      contas_fixas: data.contas_fixas,
      total_previsto: data.contas_fixas_previsto,
      total_pendente: data.contas_fixas_pendente,
    };
  },

  async salvar_conta_fixa(e, ctx) {
    const campos: Entrada = {};
    if (e.nome !== undefined) campos.nome = e.nome;
    if (e.valor_previsto !== undefined) campos.valor_previsto = Math.round(Number(e.valor_previsto) * 100) / 100;
    if (e.dia_vencimento !== undefined) campos.dia_vencimento = e.dia_vencimento;
    if (e.categoria !== undefined) campos.categoria_id = resolverCategoria(ctx, e.categoria).id;
    if (e.ativa !== undefined) campos.ativa = e.ativa;

    if (e.id) {
      const { data, error } = await db.from("contas_fixas").update(campos).eq("id", e.id).select();
      falhou(error);
      if (!data?.length) throw new ErroFerramenta(`Conta fixa ${e.id} não encontrada.`);
      return { atualizada: data[0] };
    }
    if (!campos.nome || campos.valor_previsto === undefined) {
      throw new ErroFerramenta("Para cadastrar, informe nome e valor_previsto.");
    }
    campos.categoria_id ??= resolverCategoria(ctx, "Contas da casa").id;
    const { data, error } = await db.from("contas_fixas").insert(campos).select().single();
    falhou(error);
    return { cadastrada: data };
  },

  async pagar_conta_fixa(e, ctx) {
    const { data: conta, error } = await db.from("contas_fixas").select().eq("id", e.conta_fixa_id).maybeSingle();
    falhou(error);
    if (!conta) throw new ErroFerramenta(`Conta fixa ${e.conta_fixa_id} não encontrada.`);

    const data = dataOuHoje(e.data);
    const inicio = data.slice(0, 7) + "-01";
    if (!e.forcar) {
      const { data: pagamentos, error: erroBusca } = await db
        .from("lancamentos")
        .select(CAMPOS_LANCAMENTO)
        .eq("conta_fixa_id", conta.id)
        .gte("data", inicio)
        .lt("data", proximoMes(inicio));
      falhou(erroBusca);
      if (pagamentos?.length) {
        return {
          registrado: false,
          ja_paga_no_mes: pagamentos.map(formatarLancamento),
          instrucao: "Avise que já consta paga. Se for outro pagamento, chame de novo com forcar=true.",
        };
      }
    }

    const { data: inserido, error: erroInsert } = await db
      .from("lancamentos")
      .insert({
        data,
        valor: e.valor !== undefined ? valorPositivo(e.valor) : Number(conta.valor_previsto),
        descricao: conta.nome,
        categoria_id: conta.categoria_id,
        membro_id: resolverMembro(ctx, e.quem).id,
        forma_pagamento: e.forma_pagamento || null,
        conta_fixa_id: conta.id,
        origem: ctx.origem,
        comprovante_path: ctx.comprovantePath ?? null,
        whatsapp_id: ctx.whatsappId,
      })
      .select(CAMPOS_LANCAMENTO)
      .single();
    falhou(erroInsert);
    return { registrado: true, pagamento: formatarLancamento(inserido), valor_previsto: Number(conta.valor_previsto) };
  },

  async listar_receitas(e) {
    const inicio = inicioDoMes(e.mes);
    const [recorrentes, extras] = await Promise.all([
      db.from("receitas").select("id, nome, valor_medio, dia_recebimento, ativa, membros(nome)").eq("ativa", true),
      db.from("receitas_extras").select("id, data, valor, descricao, membros(nome)")
        .gte("data", inicio).lt("data", proximoMes(inicio)),
    ]);
    falhou(recorrentes.error);
    falhou(extras.error);
    return { mes: inicio.slice(0, 7), recorrentes: recorrentes.data, extras_do_mes: extras.data };
  },

  async salvar_receita(e, ctx) {
    const campos: Entrada = {};
    if (e.nome !== undefined) campos.nome = e.nome;
    if (e.valor_medio !== undefined) campos.valor_medio = Math.round(Number(e.valor_medio) * 100) / 100;
    if (e.dia_recebimento !== undefined) campos.dia_recebimento = e.dia_recebimento;
    if (e.quem !== undefined) campos.membro_id = resolverMembro(ctx, e.quem).id;
    if (e.ativa !== undefined) campos.ativa = e.ativa;

    if (e.id) {
      const { data, error } = await db.from("receitas").update(campos).eq("id", e.id).select();
      falhou(error);
      if (!data?.length) throw new ErroFerramenta(`Receita ${e.id} não encontrada.`);
      return { atualizada: data[0] };
    }
    if (!campos.nome || campos.valor_medio === undefined) {
      throw new ErroFerramenta("Para cadastrar, informe nome e valor_medio.");
    }
    campos.membro_id ??= ctx.membro.id;
    const { data, error } = await db.from("receitas").insert(campos).select().single();
    falhou(error);
    return { cadastrada: data };
  },

  async registrar_receita_extra(e, ctx) {
    const { data, error } = await db
      .from("receitas_extras")
      .insert({
        valor: valorPositivo(e.valor),
        descricao: e.descricao,
        data: dataOuHoje(e.data),
        membro_id: resolverMembro(ctx, e.quem).id,
      })
      .select()
      .single();
    falhou(error);
    return { registrada: data };
  },

  async definir_orcamento(e, ctx) {
    const valor = e.valor === null || e.valor === undefined ? null : Math.round(Number(e.valor) * 100) / 100;
    if (valor !== null && !(valor >= 0)) throw new ErroFerramenta("Orçamento inválido.");
    if (e.categoria) {
      const categoria = resolverCategoria(ctx, e.categoria);
      const { error } = await db.from("categorias").update({ orcamento_mensal: valor }).eq("id", categoria.id);
      falhou(error);
      categoria.orcamento_mensal = valor;
      return { categoria: categoria.nome, orcamento_mensal: valor };
    }
    const { error } = await db.from("configuracoes").upsert({ chave: "orcamento_total_mensal", valor });
    falhou(error);
    return { orcamento_total_mensal: valor };
  },

  async criar_categoria(e, ctx) {
    const { data, error } = await db
      .from("categorias")
      .insert({ nome: String(e.nome).trim(), emoji: e.emoji || null })
      .select("id, nome, emoji, orcamento_mensal")
      .single();
    if (error?.code === "23505") throw new ErroFerramenta(`A categoria "${e.nome}" já existe.`);
    falhou(error);
    ctx.categorias.push(data as Categoria);
    return { criada: data };
  },
};

function somarDias(data: string, dias: number): string {
  const d = new Date(data + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Executa uma chamada de ferramenta e devolve o tool_result para o Claude. */
export async function executarFerramenta(
  chamada: Anthropic.Beta.Messages.BetaToolUseBlock,
  ctx: Contexto,
): Promise<Anthropic.Beta.Messages.BetaToolResultBlockParam> {
  const implementacao = IMPLEMENTACOES[chamada.name];
  try {
    if (!implementacao) throw new ErroFerramenta(`Ferramenta desconhecida: ${chamada.name}`);
    const resultado = await implementacao((chamada.input ?? {}) as Entrada, ctx);
    return { type: "tool_result", tool_use_id: chamada.id, content: JSON.stringify(resultado) };
  } catch (erro) {
    const mensagem = erro instanceof ErroFerramenta ? erro.message : `Erro interno: ${(erro as Error).message}`;
    if (!(erro instanceof ErroFerramenta)) console.error(`Ferramenta ${chamada.name} falhou`, erro);
    return { type: "tool_result", tool_use_id: chamada.id, content: mensagem, is_error: true };
  }
}
