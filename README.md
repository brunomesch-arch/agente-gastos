# 💰 Agente de gastos da casa

Controle de gastos do Bruno e da Larissa pelo WhatsApp. Vocês mandam para o número do agente:

- 📷 **foto do cupom fiscal** (NFC-e), comprovante de Pix, boleto ou foto da maquininha;
- 🎙️ **áudio** ("gastei 87 e 50 na farmácia, no débito");
- 💬 **texto** ("40 padaria", "a Larissa pagou 230 de luz");

e ele registra o gasto, com categoria, estabelecimento, quem pagou e itens do cupom. Também responde perguntas ("quanto já gastamos de mercado?", "resumo do mês") e cadastra contas fixas, receitas e orçamentos pela conversa.

O **painel web** mostra o mês: total gasto contra o orçamento, gasto por categoria e por estabelecimento, quem gastou, contas fixas pagas e pendentes, receita média e saldo previsto.

```
Bruno / Larissa ──WhatsApp──► número do agente (Bird)
                                   │ webhook whatsapp.received (assinado)
                                   ▼
                 Supabase Edge Function  whatsapp-webhook
                   • confere a assinatura e ignora números desconhecidos
                   • foto/PDF → Claude lê o cupom
                   • áudio → transcrição (OpenAI ou Groq) → Claude
                   • Claude usa ferramentas: registrar_gasto, resumo_do_mes,
                     pagar_conta_fixa, definir_orcamento...
                   • responde no WhatsApp: "✅ R$ 187,40 · 🛒 Mercado · Angeloni"
                                   │
                                   ▼
                 Supabase Postgres (+ bucket privado com os comprovantes)
                                   ▲
                 Painel web (React) — login por link no e-mail, protegido por RLS
```

## Estrutura

| Caminho | O que é |
|---|---|
| `supabase/migrations/` | Tabelas, categorias iniciais, relatórios (`resumo_mes`, `historico_meses`) e RLS |
| `supabase/functions/whatsapp-webhook/` | Recebe os eventos do Bird e responde 204 na hora |
| `supabase/functions/_shared/agente.ts` | Prompt e ciclo do agente (Claude + ferramentas) |
| `supabase/functions/_shared/ferramentas.ts` | As ações que o agente pode executar no banco |
| `supabase/functions/_shared/processar.ts` | Mídia, transcrição, contexto, histórico e resposta |
| `supabase/functions/_shared/bird.ts` | API do Bird: assinatura, download de mídia, envio |
| `supabase/functions/tests/` | Testes de unidade (`deno test`) |
| `painel/` | Painel web (Vite + React + supabase-js) |

## Instalação

Você vai precisar de: conta no [Supabase](https://supabase.com) (o plano gratuito serve), chave da [API do Claude](https://platform.claude.com/settings/keys), chave da [OpenAI](https://platform.openai.com/api-keys) **ou** da [Groq](https://console.groq.com/keys) para transcrever áudios, e a conta do **Bird** com um número de WhatsApp só para o agente.

### 1. Banco de dados (Supabase)

1. Crie um projeto no Supabase (região **South America (São Paulo)**).
2. Conecte este repositório para o deploy automático: no projeto, **Project Settings → Integrations → GitHub**:
   - repositório `brunomesch-arch/agente-gastos`;
   - *Supabase directory*: `supabase`;
   - *Production branch*: `main`;
   - ligue **Deploy to production**;
   - deixe **Automatic branching** desligado: branches de preview têm custo de compute.

   A partir daí, todo push no `main` aplica as migrations novas e publica a função `whatsapp-webhook` (declarada no `supabase/config.toml`, sem verificação de JWT). O restante do `config.toml` (Auth, API) não é aplicado em produção.

   <details><summary>Alternativa sem a integração: Supabase CLI</summary>

   ```bash
   supabase login
   supabase link --project-ref SEU_PROJECT_REF
   supabase db push
   supabase functions deploy whatsapp-webhook --no-verify-jwt
   ```
   </details>
3. Cadastre vocês dois (SQL Editor do Supabase). Telefone no formato internacional, **com** o 9:
   ```sql
   insert into membros (nome, telefone, email) values
     ('Bruno',   '+55DDDNUMERO', 'brunomesch@gmail.com'),
     ('Larissa', '+55DDDNUMERO', 'email-da-larissa@...');
   ```
   Só esses números são atendidos; mensagens de outros números são ignoradas.
4. Em **Authentication → Sign In / Providers**, desative "Allow new users to sign up". Em **Authentication → Users**, use **Invite user** para os dois e-mails acima (é o login do painel).

### 2. Número de WhatsApp no Bird

O agente precisa de um número **só dele** (chip novo ou número virtual), que vocês salvam como contato. No painel do Bird, conecte o número em **WhatsApp → Numbers** (o cadastro passa pela Meta). Depois, em **Platform tools → API keys**, crie uma chave com permissão de WhatsApp.

### 3. Segredos da função

Em **Edge Functions → Secrets** no painel do Supabase, cadastre:

| Nome | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` |
| `BIRD_API_KEY` | `bk_us1_...` (ou `bk_eu1_...`) |
| `BIRD_NUMERO_AGENTE` | número do agente, ex. `+5547999998888` |
| `TRANSCRICAO_PROVEDOR` | `openai` ou `groq` |
| `OPENAI_API_KEY` ou `GROQ_API_KEY` | conforme o provedor |

Opcionais: `CLAUDE_MODELO` (padrão `claude-opus-5-5`) e `CLAUDE_ESFORCO` (padrão `medium`; `low` é mais barato e rápido). `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já vêm prontos nas Edge Functions.

### 4. Webhook do Bird

Em **Platform tools → Webhooks** no Bird, crie um endpoint:

- URL: `https://SEU_PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook`
- Evento: `whatsapp.received`

O Bird mostra o segredo (`whsec_...`) **uma vez só**. Cadastre-o em **Edge Functions → Secrets** como `BIRD_WEBHOOK_SECRET`.

Mande um "oi" para o número do agente. Ele deve responder.

### 5. Painel web

```bash
cd painel
cp .env.example .env     # preencha URL e chave pública (Project Settings → API)
npm install
npm run dev              # http://localhost:5173
```

Para publicar, use Vercel, Netlify ou Cloudflare Pages com a pasta `painel` como raiz, comando `npm run build`, saída `dist` e as duas variáveis `VITE_...`. Depois, em **Authentication → URL Configuration** no Supabase, coloque o endereço do painel em *Site URL* e em *Redirect URLs*.

## Como usar no WhatsApp

| Você manda | O agente faz |
|---|---|
| foto do cupom do mercado | registra total, loja, CNPJ, data, forma de pagamento e itens |
| 🎙️ "gastei 120 no posto, crédito" | registra em Combustível |
| "a Larissa pagou 89,90 na farmácia ontem" | registra para a Larissa, com a data de ontem |
| "tênis 630 em 3x no cartão" | lança 3 parcelas de R$ 210, uma por mês |
| "na verdade foi 45" / "muda pra lazer" / "apaga esse" | corrige o último lançamento |
| "aluguel 2.500 todo dia 10" | cadastra conta fixa |
| foto do boleto da luz | dá baixa na conta fixa do mês |
| "meu salário é uns 8 mil, cai dia 5" | cadastra a receita média |
| "orçamento de mercado 1.500" / "orçamento da casa 9 mil" | define orçamentos |
| "resumo do mês" / "onde gastamos mais?" / "compara com o mês passado" | responde com os números do banco |

## Custos

- **Claude**: cada mensagem é uma chamada (ou poucas) ao modelo. Uma foto de cupom custa na ordem de alguns centavos de dólar no Opus 5.5. Para baratear, use `CLAUDE_ESFORCO=low` ou `CLAUDE_MODELO=claude-sonnet-5-5`.
- **Transcrição**: frações de centavo por minuto de áudio.
- **Bird**: respostas dentro de 24h da mensagem de vocês são mensagens de serviço; veja a tabela de preços do Bird.
- **Supabase**: o plano gratuito comporta folgado o uso de uma casa.

## Desenvolvimento

```bash
deno test --allow-env supabase/functions/tests/   # testes de unidade
deno check supabase/functions/whatsapp-webhook/index.ts
cd painel && npm run build                        # checa tipos e gera o painel
```

## Próximos passos possíveis

- Ler o QR code da NFC-e e buscar os itens direto na SEFAZ (mais preciso que a foto).
- Resumo semanal automático e lembrete de contas a vencer. Mensagem que o agente inicia (fora da janela de 24h) exige um template aprovado no WhatsApp.
- Importar o extrato/fatura do cartão (OFX/CSV) para conciliar.
