/**
 * POST /api/v1/dutorwork/checar — o botão "Checar" do DutorWork.
 *
 * Dispara o workflow `dutorwork-robo.yml` no GitHub (workflow_dispatch), que
 * entra no Sankhya, lê os pedidos e os entrega em
 * `/api/v1/webhooks/dutorwork/pedidos`. Esta rota só PEDE a leitura; o
 * resultado chega depois (1 a 4 minutos) e a tela recarrega sozinha.
 *
 * Uma checagem a cada 3 minutos por organização: cada uma é um login no
 * Sankhya. Sem `DUTORWORK_GITHUB_TOKEN`, responde 503 com o motivo.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { env } from "@/lib/env";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const INTERVALO_MINIMO_MS = 3 * 60 * 1000;
const corpoSchema = z.object({ periodo: z.enum(["hoje", "7dias", "mes"]).default("hoje") }).strict();

export async function POST(req: Request) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "dutorwork_pedidos" });
  if (!auth.ok) return auth.response;

  const corpo = corpoSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!corpo.success) return fail("validation_failed", "Período inválido.", 422, { requestId });

  const token = env.DUTORWORK_GITHUB_TOKEN;
  const repo = env.DUTORWORK_GITHUB_REPO;
  const ref = env.DUTORWORK_GITHUB_REF;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !ref) {
    return fail("unavailable", "O botão Checar ainda não foi configurado (falta o acesso ao GitHub).", 503, {
      requestId,
    });
  }

  // Trava contra clique repetido: a última checagem pedida está no registro.
  const admin = createAdminClient();
  const { data: ultima } = await admin
    .from("api_audit_log")
    .select("created_at")
    .eq("organization_id", auth.org.orgId)
    .eq("action", "dutorwork.checagem_pedida")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const desde = ultima ? Date.now() - new Date(ultima.created_at as string).getTime() : Infinity;
  if (desde < INTERVALO_MINIMO_MS) {
    const espera = Math.ceil((INTERVALO_MINIMO_MS - desde) / 1000);
    return fail("rate_limited", `Uma checagem já está em andamento. Tente de novo em ${espera} s.`, 429, {
      requestId,
      headers: { "Retry-After": String(espera) },
    });
  }

  const resp = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/dutorwork-robo.yml/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref, inputs: { periodo: corpo.data.periodo } }),
  }).catch((e: unknown) => {
    logger.error("[dutorwork.checar] GitHub inalcançável", { requestId, erro: String(e) });
    return null;
  });
  if (!resp || resp.status !== 204) {
    logger.error("[dutorwork.checar] GitHub recusou o disparo", { requestId, status: resp?.status ?? 0 });
    return fail("upstream_unavailable", "O GitHub não aceitou o pedido de checagem.", 502, { requestId });
  }

  await audit({
    action: "dutorwork.checagem_pedida",
    organizationId: auth.org.orgId,
    actorUserId: auth.user.id,
    resourceType: "dutorwork_pedidos",
    requestId,
    metadata: { periodo: corpo.data.periodo },
  });
  return ok({ pedida: true, periodo: corpo.data.periodo }, { requestId });
}
