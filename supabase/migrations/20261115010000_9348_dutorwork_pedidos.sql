-- manifest: **DutorWork: pedidos do Sankhya lidos pelo robô.** Tabela `dutorwork_pedidos` — um pedido por (organização, nunota), com cliente, TOP, datas, observação, itens, frete, total e a `situacao` do checklist (`novo → confirmado | enviado | ignorado`). Escrita só pelo servidor (rota do robô); `authenticated` lê dentro da própria organização; `anon` revogado.
--
-- 9348 — DutorWork, degrau 1 (fork tiagolif/Dutorama-CRM).
--
-- O robô (GitHub Actions, scripts/dutorwork/ler-pedidos.mjs) lê o Painel do
-- Vendedor do Sankhya e entrega os pedidos em
-- `POST /api/v1/webhooks/dutorwork/pedidos`. A rota grava aqui com upsert em
-- (organization_id, nunota): reler o mesmo pedido ATUALIZA os dados do
-- Sankhya e NUNCA mexe na `situacao`, que é decisão de quem confere.
--
-- LGPD: guarda nome e código do cliente no Sankhya e a observação do pedido
-- (que pode conter telefone ou endereço digitado pelo vendedor). É dado
-- comercial da loja, lido na mesma organização. Apagar a organização apaga.

create table if not exists public.dutorwork_pedidos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nunota bigint not null,
  status_sankhya text,
  faturado boolean not null default false,
  data_pedido date,
  data_entrega date,
  cliente_nome text not null,
  cliente_codigo bigint,
  top text,
  observacao text,
  itens jsonb not null default '[]'::jsonb,
  total_produtos_cents bigint,
  frete_cents bigint,
  total_cents bigint,
  moeda text not null default 'BRL',
  situacao text not null default 'novo',
  primeiro_lido_em timestamptz not null default now(),
  lido_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dutorwork_pedidos is
  'Pedidos do Sankhya lidos pelo robô do DutorWork (Painel do Vendedor). Um por (organização, nunota). Os dados do Sankhya são sobrescritos a cada leitura; a `situacao` do checklist não. Escrita só pelo servidor.';

alter table public.dutorwork_pedidos drop constraint if exists dutorwork_pedidos_situacao_check;
alter table public.dutorwork_pedidos add constraint dutorwork_pedidos_situacao_check
  check (situacao = any (array['novo', 'confirmado', 'enviado', 'ignorado']::text[]));

alter table public.dutorwork_pedidos drop constraint if exists dutorwork_pedidos_nunota_check;
alter table public.dutorwork_pedidos add constraint dutorwork_pedidos_nunota_check check (nunota > 0);

alter table public.dutorwork_pedidos drop constraint if exists dutorwork_pedidos_itens_array_check;
alter table public.dutorwork_pedidos add constraint dutorwork_pedidos_itens_array_check
  check (jsonb_typeof(itens) = 'array');

alter table public.dutorwork_pedidos drop constraint if exists dutorwork_pedidos_moeda_iso_check;
alter table public.dutorwork_pedidos add constraint dutorwork_pedidos_moeda_iso_check check (moeda ~ '^[A-Z]{3}$');

-- ⚠️ PARTE DA IDEMPOTÊNCIA: o upsert da rota usa este índice.
create unique index if not exists dutorwork_pedidos_org_nunota_uniq
  on public.dutorwork_pedidos (organization_id, nunota);

create index if not exists dutorwork_pedidos_situacao_idx
  on public.dutorwork_pedidos (organization_id, situacao, data_pedido desc);

drop trigger if exists trg_dutorwork_pedidos_updated_at on public.dutorwork_pedidos;
create trigger trg_dutorwork_pedidos_updated_at
  before update on public.dutorwork_pedidos
  for each row execute function public.fn_set_updated_at();

alter table public.dutorwork_pedidos enable row level security;

-- O default ACL do baseline concede tudo a anon; a anon key vai para o browser.
revoke all on public.dutorwork_pedidos from anon;
revoke all on public.dutorwork_pedidos from authenticated;
grant select on public.dutorwork_pedidos to authenticated;
grant select, insert, update, delete on public.dutorwork_pedidos to service_role;

drop policy if exists tenant_isolation_dutorwork_pedidos_select on public.dutorwork_pedidos;
create policy tenant_isolation_dutorwork_pedidos_select on public.dutorwork_pedidos
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));
