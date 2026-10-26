# 💰 Gastos da Casa

Controle financeiro do Bruno e da Larissa: um painel web onde vocês lançam os gastos do mês e acompanham para onde o dinheiro está indo.

- **Resumo do mês:** total gasto contra o orçamento, gasto por categoria (com limite por categoria), onde mais gastaram, quem gastou, forma de pagamento, evolução dos últimos 6 meses, receita prevista e saldo previsto.
- **Gastos:** lançamento rápido em sequência (Enter salva e volta ao campo de valor), compras parceladas (uma parcela por mês), edição, filtros e busca.
- **Contas fixas:** cadastro com valor previsto e vencimento; no mês, marque as que foram pagas, ajuste o valor real e registre todas de uma vez.
- **Receitas:** entradas recorrentes pelo valor médio (salário, pró-labore) e entradas extras do mês (13º, bônus, reembolso).
- **Orçamento e ajustes:** orçamento total da casa, orçamento por categoria, categorias e pessoas.

Os dados ficam num banco Postgres no Supabase. Só os e-mails cadastrados como pessoas da casa conseguem entrar (login por link enviado ao e-mail) e ver os dados; isso é garantido no próprio banco (RLS).

## Estrutura

| Caminho | O que é |
|---|---|
| `painel/` | Painel web (Vite + React + supabase-js) |
| `supabase/migrations/` | Tabelas, categorias iniciais, relatórios (`resumo_mes`, `historico_meses`) e RLS |
| `supabase/functions/` | Agente de WhatsApp, **desativado** (veja o fim deste arquivo) |

## Instalação

### 1. Banco de dados (Supabase)

O projeto Supabase está ligado a este repositório pela integração GitHub (**Project Settings → Integrations → GitHub**, diretório `supabase`, branch `main`, *Deploy to production* ligado). Todo push no `main` aplica as migrations novas automaticamente.

Depois do primeiro deploy, no Supabase:

1. **SQL Editor** — cadastre vocês dois (o e-mail é o login do painel):
   ```sql
   insert into membros (nome, email) values
     ('Bruno',   'brunomesch@gmail.com'),
     ('Larissa', 'EMAIL-DA-LARISSA');
   ```
2. **Authentication → Sign In / Providers** — desative *Allow new users to sign up*.
3. **Authentication → Users → Invite user** — convide os dois e-mails acima.

<details><summary>Sem a integração GitHub: Supabase CLI</summary>

```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```
</details>

### 2. Publicar o painel (Vercel)

1. Em [vercel.com/new](https://vercel.com/new), importe o repositório `brunomesch-arch/agente-gastos`.
2. **Root Directory:** `painel` (o framework Vite é detectado sozinho).
3. **Environment Variables** — no Supabase, em **Project Settings → API** (ou **API Keys**):
   - `VITE_SUPABASE_URL` = `https://SEU_PROJECT_REF.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = a chave pública (*anon* ou *publishable*). Ela pode ir para o navegador: quem protege os dados é o login + RLS. **Nunca** use a *service_role*/*secret* aqui.
4. **Deploy.** Copie o endereço gerado (ex.: `https://agente-gastos.vercel.app`).
5. No Supabase, **Authentication → URL Configuration**: coloque esse endereço em *Site URL* e em *Redirect URLs*.

A cada push no `main`, a Vercel publica a versão nova do painel. Netlify e Cloudflare Pages funcionam do mesmo jeito (raiz `painel`, comando `npm run build`, saída `dist`).

### Rodar o painel no computador

```bash
cd painel
cp .env.example .env     # preencha as duas variáveis
npm install
npm run dev              # http://localhost:5173
```

## Rotina sugerida

**Uma vez:** em *Contas fixas*, cadastre aluguel, condomínio, luz, internet, escola, assinaturas… com o valor médio e o dia de vencimento. Em *Receitas*, cadastre as entradas de todo mês. Em *Orçamento e ajustes*, defina o orçamento da casa e os limites por categoria que importam (mercado, restaurantes…).

**Todo mês** (ou toda semana):
1. Escolha o mês no topo.
2. *Contas fixas*: marque as pagas, corrija o valor real (luz e água variam) e clique em **Registrar**.
3. *Gastos*: lance as compras olhando a fatura do cartão e o extrato. Categoria, pessoa, data e forma de pagamento continuam preenchidos entre um lançamento e outro.
4. *Receitas*: lance entradas extras, se houver.
5. *Resumo*: veja o mês contra o orçamento e as maiores categorias.

## Desenvolvimento

```bash
cd painel && npm run build    # checa tipos e gera o painel em painel/dist
```

## Agente de WhatsApp (opcional, desativado)

O repositório também tem um agente que recebe fotos de cupons, áudios e textos pelo WhatsApp (via Bird) e lança os gastos com o Claude. Ele está **desativado**: a função não é publicada. Para religar no futuro, é preciso um número de WhatsApp só para o agente conectado no Bird.

<details><summary>Como religar</summary>

1. Em `supabase/config.toml`, descomente o bloco `[functions.whatsapp-webhook]` e faça push (a integração GitHub publica a função).
2. Em **Edge Functions → Secrets**, cadastre: `ANTHROPIC_API_KEY`, `BIRD_API_KEY`, `BIRD_NUMERO_AGENTE` (ex. `+5547999998888`), `TRANSCRICAO_PROVEDOR` (`openai` ou `groq`) e `OPENAI_API_KEY` ou `GROQ_API_KEY`. Opcionais: `CLAUDE_MODELO` (padrão `claude-opus-5-5`) e `CLAUDE_ESFORCO` (padrão `medium`).
3. Cadastre o WhatsApp de cada pessoa em `membros.telefone` (formato `+55DDDNÚMERO`). Só esses números são atendidos.
4. No Bird, conecte o número em **WhatsApp → Numbers** (*I have my own number*), ligue **Enable conversations** e crie um webhook em **Platform tools → Webhooks** para `https://SEU_PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook` com o evento `whatsapp.received`. Cadastre o segredo `whsec_...` como `BIRD_WEBHOOK_SECRET`.

Testes do agente: `deno test --allow-env supabase/functions/tests/`.
</details>
