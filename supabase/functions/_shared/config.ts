import { createClient } from "npm:@supabase/supabase-js@2.118.0";

export function env(nome: string, padrao?: string): string {
  const valor = Deno.env.get(nome) ?? padrao;
  if (valor === undefined || valor === "") {
    throw new Error(`Variável de ambiente ${nome} não definida`);
  }
  return valor;
}

export const FUSO = "America/Sao_Paulo";

// O agente usa a service role: ele roda no servidor e ignora o RLS do painel.
export const db = createClient(
  env("SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

/** Data de hoje (YYYY-MM-DD) no fuso de Brasília. */
export function hojeISO(agora = new Date()): string {
  return agora.toLocaleDateString("sv-SE", { timeZone: FUSO });
}

export function formatarReais(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
