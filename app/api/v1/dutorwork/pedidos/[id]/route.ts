/**
 * PATCH /api/v1/dutorwork/pedidos/[id] — muda a situação do checklist de um
 * pedido do Sankhya (`novo | confirmado | ignorado`).
 *
 * `enviado` NÃO entra por aqui: quem marca enviado é o envio pelo WhatsApp,
 * quando existir. A tabela só aceita escrita do servidor; a organização vem da
 * sessão (requireRole), nunca do corpo.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ situacao: z.enum(["novo", "confirmado", "ignorado"]) }).strict();

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "dutorwork_pedidos" });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !corpo.success) {
    return fail("validation_failed", "Situação inválida.", 422, { requestId });
  }

  const { data, error } = await createAdminClient()
    .from("dutorwork_pedidos")
    .update({ situacao: corpo.data.situacao })
    .eq("id", id)
    .eq("organization_id", auth.org.orgId)
    .neq("situacao", "enviado")
    .select("id, nunota, situacao")
    .maybeSingle();
  if (error) {
    logger.error("[dutorwork.pedidos] troca de situação falhou", { requestId, code: error.code });
    return fail("internal_error", "Não foi possível salvar.", 500, { requestId });
  }
  if (!data) return fail("not_found", "Pedido não encontrado ou já enviado.", 404, { requestId });

  await audit({
    action: "dutorwork.pedido_situacao_alterada",
    organizationId: auth.org.orgId,
    actorUserId: auth.user.id,
    resourceType: "dutorwork_pedidos",
    resourceId: id,
    requestId,
    metadata: { nunota: data.nunota, situacao: data.situacao },
  });
  return ok(data, { requestId });
}
