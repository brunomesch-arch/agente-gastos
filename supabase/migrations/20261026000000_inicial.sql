-- Agente de gastos da casa: esquema inicial.
-- Caixa conjunto: um orçamento só, e cada lançamento guarda quem gastou.

set timezone to 'America/Sao_Paulo';

-- Data "de hoje" no fuso de Brasília, independente do fuso do servidor.
create or replace function hoje() returns date
language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- ───────────────────────── Tabelas ─────────────────────────

create table membros (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  telefone   text not null unique check (telefone ~ '^\+[0-9]{10,15}$'), -- E.164, ex: +5547999998888
  email      text unique,                                                -- login no painel
  criado_em  timestamptz not null default now()
);

create table categorias (
  id                int generated always as identity primary key,
  nome              text not null unique,
  emoji             text,
  orcamento_mensal  numeric(12,2) check (orcamento_mensal >= 0),
  ativa             boolean not null default true
);

create table contas_fixas (
  id              int generated always as identity primary key,
  nome            text not null,
  valor_previsto  numeric(12,2) not null check (valor_previsto >= 0),
  dia_vencimento  int check (dia_vencimento between 1 and 31),
  categoria_id    int not null references categorias(id),
  ativa           boolean not null default true,
  criado_em       timestamptz not null default now()
);

create table lancamentos (
  id                bigint generated always as identity primary key,
  data              date not null default hoje(),
  valor             numeric(12,2) not null check (valor > 0),
  descricao         text not null,
  estabelecimento   text,
  cnpj              text,
  categoria_id      int not null references categorias(id),
  membro_id         uuid references membros(id) on delete set null,
  forma_pagamento   text check (forma_pagamento in ('pix','credito','debito','dinheiro','boleto','outro')),
  parcela           text,                -- "3/10" quando a compra foi parcelada
  origem            text not null check (origem in ('foto','audio','texto','documento','painel')),
  itens             jsonb,               -- itens do cupom: [{descricao, quantidade, valor_total}]
  conta_fixa_id     int references contas_fixas(id) on delete set null,
  comprovante_path  text,                -- caminho no bucket "comprovantes"
  whatsapp_id       text,
  criado_em         timestamptz not null default now()
);
create index lancamentos_data_idx on lancamentos (data);
create index lancamentos_conta_fixa_idx on lancamentos (conta_fixa_id, data);

-- Entradas recorrentes (salário, pró-labore...) pelo valor médio do mês.
create table receitas (
  id               int generated always as identity primary key,
  nome             text not null,
  valor_medio      numeric(12,2) not null check (valor_medio >= 0),
  dia_recebimento  int check (dia_recebimento between 1 and 31),
  membro_id        uuid references membros(id) on delete set null,
  ativa            boolean not null default true,
  criado_em        timestamptz not null default now()
);

-- Entradas que acontecem uma vez (13º, venda de algo, reembolso...).
create table receitas_extras (
  id         bigint generated always as identity primary key,
  data       date not null default hoje(),
  valor      numeric(12,2) not null check (valor > 0),
  descricao  text not null,
  membro_id  uuid references membros(id) on delete set null,
  criado_em  timestamptz not null default now()
);

create table configuracoes (
  chave  text primary key,
  valor  jsonb
);
insert into configuracoes (chave, valor) values ('orcamento_total_mensal', null);

-- Uso interno do agente (só a service role acessa).
create table webhooks_recebidos (
  webhook_id   text primary key,
  recebido_em  timestamptz not null default now()
);

create table historico_conversa (
  id         bigint generated always as identity primary key,
  membro_id  uuid not null references membros(id) on delete cascade,
  papel      text not null check (papel in ('user','assistant')),
  texto      text not null,
  criado_em  timestamptz not null default now()
);
create index historico_conversa_membro_idx on historico_conversa (membro_id, criado_em desc);

-- ───────────────────────── Categorias iniciais ─────────────────────────

insert into categorias (nome, emoji) values
  ('Mercado', '🛒'),
  ('Restaurantes e delivery', '🍽️'),
  ('Padaria e café', '🥐'),
  ('Combustível', '⛽'),
  ('Transporte', '🚗'),
  ('Casa', '🏠'),
  ('Contas da casa', '💡'),
  ('Saúde e farmácia', '💊'),
  ('Beleza e cuidados', '💇'),
  ('Vestuário', '👕'),
  ('Lazer', '🎉'),
  ('Viagens', '✈️'),
  ('Educação', '📚'),
  ('Assinaturas', '📺'),
  ('Pets', '🐾'),
  ('Presentes', '🎁'),
  ('Impostos e taxas', '🧾'),
  ('Outros', '📦');

-- ───────────────────────── Relatórios ─────────────────────────

-- Tudo o que o painel e o agente mostram sobre um mês, num JSON só.
create or replace function resumo_mes(p_mes date default hoje())
returns jsonb
language sql stable
set search_path = public
as $$
with
periodo as (
  select date_trunc('month', p_mes)::date as inicio,
         (date_trunc('month', p_mes) + interval '1 month')::date as fim
),
lanc as (
  select l.* from lancamentos l, periodo p
  where l.data >= p.inicio and l.data < p.fim
),
fixas as (
  select cf.id, cf.nome, cf.valor_previsto, cf.dia_vencimento, c.nome as categoria,
         coalesce(sum(l.valor), 0) as valor_pago,
         count(l.id) > 0 as pago
  from contas_fixas cf
  join categorias c on c.id = cf.categoria_id
  left join lanc l on l.conta_fixa_id = cf.id
  where cf.ativa
  group by cf.id, c.nome
),
totais as (
  select
    coalesce((select sum(valor) from lanc), 0) as gasto_total,
    coalesce((select sum(valor) from lanc where conta_fixa_id is null), 0) as gasto_variavel,
    coalesce((select sum(valor) from lanc where conta_fixa_id is not null), 0) as fixas_pagas,
    coalesce((select sum(valor_previsto) from fixas), 0) as fixas_previsto,
    coalesce((select sum(valor_previsto) from fixas where not pago), 0) as fixas_pendente,
    coalesce((select sum(valor_medio) from receitas where ativa), 0) as receitas_recorrentes,
    coalesce((select sum(e.valor) from receitas_extras e, periodo p
              where e.data >= p.inicio and e.data < p.fim), 0) as receitas_extras,
    (select (valor #>> '{}')::numeric from configuracoes where chave = 'orcamento_total_mensal') as orcamento_total
)
select jsonb_build_object(
  'mes', to_char((select inicio from periodo), 'YYYY-MM'),
  'gasto_total', t.gasto_total,
  'gasto_variavel', t.gasto_variavel,
  'contas_fixas_pagas', t.fixas_pagas,
  'contas_fixas_previsto', t.fixas_previsto,
  'contas_fixas_pendente', t.fixas_pendente,
  'receitas_recorrentes', t.receitas_recorrentes,
  'receitas_extras', t.receitas_extras,
  'receita_prevista', t.receitas_recorrentes + t.receitas_extras,
  'orcamento_total', t.orcamento_total,
  'gasto_projetado', t.gasto_total + t.fixas_pendente,
  'saldo_previsto', t.receitas_recorrentes + t.receitas_extras - t.gasto_total - t.fixas_pendente,
  'dias_restantes', greatest(0, (select fim from periodo) - hoje()),
  'por_categoria', coalesce((
    select jsonb_agg(x order by x.total desc, x.categoria) from (
      select c.nome as categoria, c.emoji, coalesce(sum(l.valor), 0) as total, c.orcamento_mensal as orcamento
      from categorias c left join lanc l on l.categoria_id = c.id
      group by c.id
      having coalesce(sum(l.valor), 0) > 0 or c.orcamento_mensal is not null
    ) x), '[]'::jsonb),
  'por_estabelecimento', coalesce((
    select jsonb_agg(x order by x.total desc) from (
      select coalesce(nullif(estabelecimento, ''), descricao) as estabelecimento,
             sum(valor) as total, count(*) as compras
      from lanc where conta_fixa_id is null
      group by 1 order by 2 desc limit 10
    ) x), '[]'::jsonb),
  'por_membro', coalesce((
    select jsonb_agg(x order by x.total desc) from (
      select coalesce(m.nome, 'Sem pessoa') as membro, sum(l.valor) as total
      from lanc l left join membros m on m.id = l.membro_id
      group by 1
    ) x), '[]'::jsonb),
  'por_forma_pagamento', coalesce((
    select jsonb_agg(x order by x.total desc) from (
      select coalesce(forma_pagamento, 'não informado') as forma, sum(valor) as total
      from lanc group by 1
    ) x), '[]'::jsonb),
  'por_dia', coalesce((
    select jsonb_agg(x order by x.dia) from (
      select data as dia, sum(valor) as total from lanc group by data
    ) x), '[]'::jsonb),
  'contas_fixas', coalesce((
    select jsonb_agg(f order by f.dia_vencimento nulls last, f.nome) from fixas f), '[]'::jsonb)
)
from totais t;
$$;

-- Totais dos últimos N meses, para comparar a evolução.
create or replace function historico_meses(p_meses int default 6)
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x.mes), '[]'::jsonb) from (
    select to_char(m, 'YYYY-MM') as mes,
           coalesce((select sum(valor) from lancamentos
                     where data >= m and data < m + interval '1 month'), 0) as gasto_total,
           coalesce((select sum(valor) from lancamentos
                     where data >= m and data < m + interval '1 month' and conta_fixa_id is null), 0) as gasto_variavel
    from generate_series(
      date_trunc('month', hoje()) - make_interval(months => greatest(p_meses, 1) - 1),
      date_trunc('month', hoje()),
      interval '1 month') as m
  ) x;
$$;

-- ───────────────────────── Segurança (RLS) ─────────────────────────
-- O painel entra com login por e-mail; só e-mails cadastrados em "membros" veem os dados.
-- O agente do WhatsApp usa a service role, que ignora o RLS.

create or replace function eh_membro() returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from membros
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

alter table membros            enable row level security;
alter table categorias         enable row level security;
alter table contas_fixas       enable row level security;
alter table lancamentos        enable row level security;
alter table receitas           enable row level security;
alter table receitas_extras    enable row level security;
alter table configuracoes      enable row level security;
alter table webhooks_recebidos enable row level security;
alter table historico_conversa enable row level security;

create policy membros_casa         on membros         for all to authenticated using (eh_membro()) with check (eh_membro());
create policy categorias_casa      on categorias      for all to authenticated using (eh_membro()) with check (eh_membro());
create policy contas_fixas_casa    on contas_fixas    for all to authenticated using (eh_membro()) with check (eh_membro());
create policy lancamentos_casa     on lancamentos     for all to authenticated using (eh_membro()) with check (eh_membro());
create policy receitas_casa        on receitas        for all to authenticated using (eh_membro()) with check (eh_membro());
create policy receitas_extras_casa on receitas_extras for all to authenticated using (eh_membro()) with check (eh_membro());
create policy configuracoes_casa   on configuracoes   for all to authenticated using (eh_membro()) with check (eh_membro());
-- webhooks_recebidos e historico_conversa ficam sem policy: só a service role lê e escreve.

revoke execute on function resumo_mes(date), historico_meses(int), eh_membro() from public, anon;
grant execute on function resumo_mes(date), historico_meses(int), eh_membro() to authenticated;

-- Fotos de cupons e comprovantes (bucket privado).
insert into storage.buckets (id, name, public) values ('comprovantes', 'comprovantes', false)
on conflict (id) do nothing;

create policy comprovantes_leitura on storage.objects for select to authenticated
  using (bucket_id = 'comprovantes' and eh_membro());
