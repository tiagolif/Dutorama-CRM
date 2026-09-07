/**
 * Supabase admin client (service role). BYPASSA RLS.
 *
 * REGRA CRÍTICA: handlers que usam este client DEVEM filtrar `organization_id`
 * manualmente, resolvido de fonte confiável (cookie, JWT validado, webhook
 * secret, path token) — NUNCA do request body.
 *
 * Uso permitido:
 *  - Webhook handlers (WAHA, Nuvemshop)
 *  - Cron / workers
 *  - Onboarding / admin operations explícitas
 *  - Health check (read-only)
 *
 * Uso PROIBIDO:
 *  - Qualquer rota acionada por usuário final em fluxo normal
 *  - Substituir auth por conveniência
 */

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let _admin: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (_admin) return _admin;

  // Codespaces expõe uma URL pública para o browser, mas chamadas administrativas
  // server-side não devem atravessar o proxy de portas. A variável é opcional e
  // só é gerada no ambiente DEV; produção continua usando a URL pública normal.
  const supabaseServerUrl =
    process.env.SUPABASE_INTERNAL_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL;

  _admin = createSupabaseClient(supabaseServerUrl, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "X-Client-Info": "deskcomm-crm/admin",
      },
    },
  });

  return _admin;
}
