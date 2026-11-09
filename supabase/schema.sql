-- Flip 7 — salas do jogo online.
-- Toda a partida vive em uma única linha JSONB: simples de ler, simples de sincronizar.

create table if not exists public.rooms (
  code text primary key check (code ~ '^[a-z0-9-]{2,32}$'),
  name text not null,
  state jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

drop policy if exists "rooms read" on public.rooms;
drop policy if exists "rooms insert" on public.rooms;
drop policy if exists "rooms update" on public.rooms;

create policy "rooms read" on public.rooms for select to anon, authenticated using (true);
create policy "rooms insert" on public.rooms for insert to anon, authenticated with check (true);
create policy "rooms update" on public.rooms for update to anon, authenticated using (true) with check (true);

-- Grava só se ninguém gravou antes: evita que duas pessoas sobrescrevam a mesma jogada.
create or replace function public.room_save(p_code text, p_version bigint, p_state jsonb)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v bigint;
begin
  update public.rooms
     set state = p_state,
         version = rooms.version + 1,
         updated_at = now()
   where code = p_code
     and version = p_version
  returning version into v;
  return v;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
end $$;
