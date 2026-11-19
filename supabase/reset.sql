-- reset.sql — Vide TOUTES les tables (données de test) avant la copie depuis Firebase.
-- À exécuter dans Supabase > SQL Editor. N'efface que Supabase, jamais l'ancienne base Firebase.
-- NE PLUS UTILISER après la bascule : les vrais pointages seraient effacés.
truncate public.settings, public.sites, public.managers, public.tablets, public.employees, public.punches, public.days,
  public.plannings, public.break_declarations, public.pause_ledger, public.planning_history, public.ledger_history, public.leaves;
