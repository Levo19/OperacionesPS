-- hotel_nota: editar la nota de una reserva (llega tarde, alergias, ofrecer tours…)
create or replace function hotel_nota(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  perform _req_staff();
  update hotel_reservas set notas = left(coalesce(p->>'notas',''), 500)
    where id = (p->>'reserva_id')::bigint;
  if not found then raise exception 'RESERVA_NO_EXISTE'; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function hotel_nota(jsonb) to authenticated;
revoke execute on function hotel_nota(jsonb) from anon;
