
create table public.scripts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '未命名剧本',
  type text,
  genre text,
  tone text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scripts_user_updated_idx on public.scripts (user_id, updated_at desc);

alter table public.scripts enable row level security;

create policy "scripts_select_own" on public.scripts
  for select using (auth.uid() = user_id);
create policy "scripts_insert_own" on public.scripts
  for insert with check (auth.uid() = user_id);
create policy "scripts_update_own" on public.scripts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "scripts_delete_own" on public.scripts
  for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger scripts_set_updated_at
  before update on public.scripts
  for each row execute function public.set_updated_at();
