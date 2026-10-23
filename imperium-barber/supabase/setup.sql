create table if not exists public.barber_services (
  id text primary key,
  nome text not null,
  duracao integer not null check (duracao > 0),
  valor numeric(10, 2) not null check (valor >= 0),
  ativo boolean not null default true
);

alter table public.barber_services enable row level security;

revoke all on table public.barber_services from anon, authenticated;
grant select on table public.barber_services to anon, authenticated;

drop policy if exists "Public can read barber services" on public.barber_services;
create policy "Public can read barber services"
  on public.barber_services
  for select
  to anon, authenticated
  using (true);

create or replace function public.replace_barber_services(p_services jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') <> 'giangomes18@icloud.com' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  delete from public.barber_services as existing
  where not exists (
    select 1
    from jsonb_to_recordset(coalesce(p_services, '[]'::jsonb)) as service(id text)
    where service.id = existing.id
  );

  insert into public.barber_services (id, nome, duracao, valor)
  select service.id, service.nome, service.duracao, service.valor
  from jsonb_to_recordset(coalesce(p_services, '[]'::jsonb)) as service(
    id text,
    nome text,
    duracao integer,
    valor numeric
  )
  where coalesce(trim(service.nome), '') <> ''
  on conflict (id) do update
  set nome = excluded.nome,
      duracao = excluded.duracao,
      valor = excluded.valor,
      ativo = true;
end;
$$;

revoke all on function public.replace_barber_services(jsonb) from public;
grant execute on function public.replace_barber_services(jsonb) to authenticated;

create table if not exists public.customer_appointments (
  id text primary key,
  client_user_id uuid references auth.users(id) on delete set null,
  cliente text not null,
  telefone varchar(11) not null check (char_length(telefone) = 11 and telefone ~ '^[0-9]{11}$'),
  servico_id text,
  servico_nome text not null,
  valor numeric(10, 2) not null check (valor >= 0),
  duracao integer not null check (duracao > 0),
  barbeiro_id text not null,
  data date not null,
  horario time not null,
  status text not null default 'agendado'
    check (status in ('agendado', 'concluido', 'cancelado')),
  created_at timestamptz not null default now()
);

create index if not exists customer_appointments_date_barber_idx
  on public.customer_appointments (data, barbeiro_id, horario);
create index if not exists customer_appointments_client_idx
  on public.customer_appointments (client_user_id, data, horario);

create or replace function public.link_legacy_appointment_to_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_matches bigint;
begin
  if new.client_user_id is not null then
    return new;
  end if;

  select (array_agg(customer.id order by customer.created_at))[1], count(*)
  into v_user_id, v_matches
  from auth.users as customer
  where regexp_replace(
    coalesce(customer.raw_user_meta_data ->> 'telefone', ''),
    '[^0-9]',
    '',
    'g'
  ) = new.telefone;

  if v_matches = 1 then
    new.client_user_id := v_user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists link_legacy_appointment_customer on public.customer_appointments;
create trigger link_legacy_appointment_customer
  before insert on public.customer_appointments
  for each row
  execute function public.link_legacy_appointment_to_customer();
revoke all on function public.link_legacy_appointment_to_customer() from public;

alter table public.customer_appointments enable row level security;
revoke all on table public.customer_appointments from anon, authenticated;
grant select, insert on table public.customer_appointments to authenticated;

drop policy if exists "Clients and barber can read appointments" on public.customer_appointments;
create policy "Clients and barber can read appointments"
  on public.customer_appointments
  for select
  to authenticated
  using (
    coalesce(auth.jwt() ->> 'email', '') = 'giangomes18@icloud.com'
    or client_user_id = (select auth.uid())
  );

drop policy if exists "Clients can create their own appointments" on public.customer_appointments;
create policy "Clients can create their own appointments"
  on public.customer_appointments
  for insert
  to authenticated
  with check (
    coalesce(auth.jwt() ->> 'email', '') = 'giangomes18@icloud.com'
    or (
      client_user_id = (select auth.uid())
      and telefone = coalesce(auth.jwt() -> 'user_metadata' ->> 'telefone', '')
      and status = 'agendado'
    )
  );

create or replace function public.update_customer_appointment_status(p_id text, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean :=
    coalesce(auth.jwt() ->> 'email', '') = 'giangomes18@icloud.com';
begin
  if p_status not in ('agendado', 'concluido', 'cancelado') then
    raise exception 'Invalid appointment status' using errcode = '22023';
  end if;

  if not v_is_admin and p_status <> 'cancelado' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.customer_appointments as appointment
  set status = p_status
  where appointment.id = p_id
    and appointment.status = 'agendado'
    and (
      v_is_admin
      or appointment.client_user_id = auth.uid()
    );

  if not found then
    raise exception 'Appointment not found or already updated' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.update_customer_appointment_status(text, text) from public;
grant execute on function public.update_customer_appointment_status(text, text) to authenticated;