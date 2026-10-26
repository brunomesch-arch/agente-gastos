import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configurado = Boolean(url && chave);

export const supabase = createClient(url ?? "http://localhost", chave ?? "sem-chave");

// ───────────────────────── Tipos ─────────────────────────

export interface Membro {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
}

export interface Categoria {
  id: number;
  nome: string;
  emoji: string | null;
  orcamento_mensal: number | null;
  ativa: boolean;
}

export interface Lancamento {
  id: number;
  data: string;
  valor: number;
  descricao: string;
  estabelecimento: string | null;
  forma_pagamento: string | null;
  parcela: string | null;
  origem: string;
  categoria_id: number;
  membro_id: string | null;
  conta_fixa_id: number | null;
  comprovante_path: string | null;
  itens: { descricao: string; quantidade?: number; valor_total: number }[] | null;
}

export interface ContaFixaResumo {
  id: number;
  nome: string;
  valor_previsto: number;
  dia_vencimento: number | null;
  categoria: string;
  valor_pago: number;
  pago: boolean;
}

export interface Resumo {
  mes: string;
  gasto_total: number;
  gasto_variavel: number;
  contas_fixas_pagas: number;
  contas_fixas_previsto: number;
  contas_fixas_pendente: number;
  receitas_recorrentes: number;
  receitas_extras: number;
  receita_prevista: number;
  orcamento_total: number | null;
  gasto_projetado: number;
  saldo_previsto: number;
  dias_restantes: number;
  por_categoria: { categoria: string; emoji: string | null; total: number; orcamento: number | null }[];
  por_estabelecimento: { estabelecimento: string; total: number; compras: number }[];
  por_membro: { membro: string; total: number }[];
  por_forma_pagamento: { forma: string; total: number }[];
  por_dia: { dia: string; total: number }[];
  contas_fixas: ContaFixaResumo[];
}

// ───────────────────────── Utilitários ─────────────────────────

/** Lança o erro do Supabase, para os componentes mostrarem a mensagem. */
export function ok<T>(resp: { data: T; error: { message: string } | null }): T {
  if (resp.error) throw new Error(resp.error.message);
  return resp.data;
}

export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const reaisCurto = (v: number) =>
  Math.abs(v) >= 1000
    ? "R$ " + (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil"
    : reais(v);

export const dataCurta = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

export function hojeISO(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

/** "2026-10" → "outubro de 2026" */
export function nomeMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

/** "outubro de 2026" → "Outubro de 2026" */
export function nomeMesTitulo(mes: string): string {
  const nome = nomeMes(mes);
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

export function somarMes(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function limitesMes(mes: string): [string, string] {
  return [`${mes}-01`, `${somarMes(mes, 1)}-01`];
}

export const FORMAS_PAGAMENTO: Record<string, string> = {
  pix: "Pix",
  credito: "Crédito",
  debito: "Débito",
  dinheiro: "Dinheiro",
  boleto: "Boleto",
  outro: "Outro",
};
