/**
 * POST /api/v1/webhooks/dutorwork/pedidos — entrada do robô do Sankhya.
 *
 * Quem chama é o workflow `dutorwork-robo` (GitHub Actions), com
 * `Authorization: Bearer <DUTORWORK_ROBO_TOKEN>`. A organização vem de
 * `DUTORWORK_ORGANIZATION_ID` (ambiente do servidor — nunca do corpo).
 * Sem os dois configurados, a rota responde 404.
 *
 * Grava em `dutorwork_pedidos` com upsert em (organization_id, nunota) e
 * responde só contagens: quantos pedidos eram novos e quantos já existiam.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { timingSafeStringEqual } from "@/lib/auth/cron-auth";
import { linhaDoPedido, loteDePedidosSchema, separarPorDetalhe } from "@/lib/dutorwork/pedidos";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const token = env.DUTORWORK_ROBO_TOKEN;
  const organizationId = env.DUTORWORK_ORGANIZATION_ID;
  if (!token || token.length < 32 || !UUID.test(organizationId)) {
    return fail("not_found", "not_found", 404, { requestId });
  }

  const auth = req.headers.get("authorization") ?? "";
  const enviado = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!timingSafeStringEqual(enviado, token)) {
    return fail("unauthenticated", "invalid_token", 401, { requestId });
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("invalid_request", "invalid_json", 400, { requestId });
  }
  const lote = loteDePedidosSchema.safeParse(corpo);
  if (!lote.success) {
    return fail("validation_failed", "invalid_payload", 422, {
      requestId,
      details: lote.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }

  const admin = createAdminClient();
  const nunotas = lote.data.pedidos.map((p) => p.nunota);
  const { data: existentes, error: erroLeitura } = nunotas.length
    ? await admin
        .from("dutorwork_pedidos")
        .select("nunota")
        .eq("organization_id", organizationId)
        .in("nunota", nunotas)
    : { data: [], error: null };
  if (erroLeitura) {
    logger.error("[dutorwork.pedidos] leitura dos existentes falhou", { requestId, code: erroLeitura.code });
    return fail("internal_error", "read_failed", 500, { requestId });
  }
  const jaExistiam = new Set((existentes ?? []).map((e) => Number(e.nunota)));

  const { completos, resumidos } = separarPorDetalhe(lote.data.pedidos);
  const lidoEm = lote.data.lido_em;

  if (completos.length) {
    const { error } = await admin
      .from("dutorwork_pedidos")
      .upsert(completos.map((p) => linhaDoPedido(organizationId, p, lidoEm)), {
        onConflict: "organization_id,nunota",
      });
    if (error) {
      logger.error("[dutorwork.pedidos] gravação falhou", { requestId, code: error.code });
      return fail("internal_error", "write_failed", 500, { requestId });
    }
  }
  // Sem detalhe: só entra se ainda não existe, para não apagar itens já lidos.
  const resumidosNovos = resumidos.filter((p) => !jaExistiam.has(p.nunota));
  if (resumidosNovos.length) {
    const { error } = await admin
      .from("dutorwork_pedidos")
      .upsert(resumidosNovos.map((p) => linhaDoPedido(organizationId, p, lidoEm)), {
        onConflict: "organization_id,nunota",
        ignoreDuplicates: true,
      });
    if (error) {
      logger.error("[dutorwork.pedidos] gravação dos resumidos falhou", { requestId, code: error.code });
      return fail("internal_error", "write_failed", 500, { requestId });
    }
  }

  const novos = nunotas.filter((n) => !jaExistiam.has(n)).length;
  const recebidos = nunotas.length;
  if (recebidos > 0) {
    await audit({
      action: "dutorwork.pedidos_recebidos",
      organizationId,
      resourceType: "dutorwork_pedidos",
      requestId,
      metadata: { periodo: lote.data.periodo, recebidos, novos, sem_detalhe: resumidos.length },
    });
  }
  return ok({ recebidos, novos, ja_existiam: recebidos - novos }, { requestId });
}
