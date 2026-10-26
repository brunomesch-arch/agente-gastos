// Recebe os eventos whatsapp.received do Bird.
// Responde 204 na hora (o Bird espera no máximo 15 s) e processa em segundo plano.

import { assinaturaValida, type EventoWebhook } from "../_shared/bird.ts";
import { db, env } from "../_shared/config.ts";
import { processarMensagem } from "../_shared/processar.ts";

// Global do Supabase Edge Runtime: mantém a função viva depois de responder.
declare const EdgeRuntime: { waitUntil(promessa: Promise<unknown>): void };

const SEGREDO = env("BIRD_WEBHOOK_SECRET");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Agente de gastos no ar ✅");

  const corpo = await req.text();
  if (!(await assinaturaValida(corpo, req.headers, SEGREDO))) {
    // 400 faz o Bird tentar de novo: útil se o segredo ainda não foi configurado.
    return new Response("assinatura inválida", { status: 400 });
  }

  const evento = JSON.parse(corpo) as EventoWebhook;
  if (evento.type !== "whatsapp.received" || evento.data?.direction === "outbound") {
    return new Response(null, { status: 204 });
  }

  // O Bird entrega "pelo menos uma vez": a mesma entrega pode chegar repetida.
  const { error } = await db.from("webhooks_recebidos").insert({ webhook_id: req.headers.get("webhook-id") });
  if (error?.code === "23505") return new Response(null, { status: 204 });
  if (error) {
    console.error("Falha ao registrar webhook", error);
    return new Response("erro", { status: 500 });
  }

  EdgeRuntime.waitUntil(
    processarMensagem(evento.data).catch((e) => console.error("Erro não tratado", e)),
  );
  return new Response(null, { status: 204 });
});
