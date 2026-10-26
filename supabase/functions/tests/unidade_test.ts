// Rode com:  deno test --allow-env supabase/functions/tests/
import { assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "teste");

const { assinaturaValida, dividirTexto, urlBase } = await import("../_shared/bird.ts");
const { variantesTelefone } = await import("../_shared/telefone.ts");
const { dividirParcelas, somarMeses, normalizar } = await import("../_shared/ferramentas.ts");

async function assinar(segredo: string, id: string, ts: string, corpo: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(segredo.replace(/^whsec_/, "")), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(`${id}.${ts}.${corpo}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

Deno.test("assinatura do webhook: aceita válida, recusa adulterada e antiga", async () => {
  const segredo = "whsec_" + btoa("segredo-de-teste-123");
  const agora = 1_790_000_000;
  const corpo = '{"type":"whatsapp.received"}';
  const sig = await assinar(segredo, "msg_1", String(agora), corpo);
  const headers = (ts: number, s = sig) =>
    new Headers({ "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": `v1,${s}` });

  assertEquals(await assinaturaValida(corpo, headers(agora), segredo, agora), true);
  assertEquals(await assinaturaValida(corpo + " ", headers(agora), segredo, agora), false);
  assertEquals(await assinaturaValida(corpo, headers(agora), segredo, agora + 301), false);
  // Durante a rotação chegam duas assinaturas; basta uma valer.
  const duas = new Headers({
    "webhook-id": "msg_1",
    "webhook-timestamp": String(agora),
    "webhook-signature": `v1,AAAA v1,${sig}`,
  });
  assertEquals(await assinaturaValida(corpo, duas, segredo, agora), true);
  assertEquals(await assinaturaValida(corpo, new Headers(), segredo, agora), false);
});

Deno.test("região do Bird vem do prefixo da chave", () => {
  assertEquals(urlBase("bk_eu1_abc"), "https://eu1.platform.bird.com");
  assertEquals(urlBase("bk_us1_abc"), "https://us1.platform.bird.com");
});

Deno.test("telefone: casa com e sem o nono dígito", () => {
  assertEquals(variantesTelefone("+5547999998888").sort(), ["+554799998888", "+5547999998888"]);
  assertEquals(variantesTelefone("554799998888").sort(), ["+554799998888", "+5547999998888"]);
  assertEquals(variantesTelefone("+14155550100"), ["+14155550100"]);
});

Deno.test("parcelas somam o total exato", () => {
  assertEquals(dividirParcelas(100, 3), [33.34, 33.33, 33.33]);
  assertEquals(dividirParcelas(1999.9, 10).reduce((a, b) => a + b, 0).toFixed(2), "1999.90");
  assertEquals(dividirParcelas(50, 1), [50]);
});

Deno.test("somar meses mantém o dia possível", () => {
  assertEquals(somarMeses("2026-01-31", 1), "2026-02-28");
  assertEquals(somarMeses("2026-11-15", 2), "2027-01-15");
  assertEquals(somarMeses("2028-01-31", 1), "2028-02-29");
});

Deno.test("textos longos viram várias mensagens", () => {
  const partes = dividirTexto("linha\n".repeat(2000), 4000);
  assertEquals(partes.every((p) => p.length <= 4000), true);
  assertEquals(partes.join("\n").split("linha").length - 1, 2000);
});

Deno.test("normalizar ignora acentos e maiúsculas", () => {
  assertEquals(normalizar("Saúde e Farmácia"), "saude e farmacia");
});
