import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/channels/official/coexistencia — a tela pode abrir a janela da Meta?
 * POST /api/v1/channels/official/coexistencia — conclui a conexão em coexistência.
 *
 * A outra porta do canal oficial (#4074): em vez de colar `phone_number_id`,
 * `waba_id` e token, o admin abre a janela da Meta ("Login do Facebook para
 * Empresas", `featureType: whatsapp_business_app_onboarding`), escaneia o QR com
 * o celular onde o app WhatsApp Business JÁ está e autoriza. O número continua
 * no celular — é o que "coexistência" quer dizer.
 *
 * O POST recebe o CÓDIGO de uso único da janela (nunca um token) e:
 *
 *   1. troca o código pelo token, no servidor, com o App Secret da instalação;
 *   2. conecta pelo MESMO miolo da porta manual (`conectarCanalOficial`), com a
 *      origem `embedded_signup` — constante de código, não do corpo;
 *   3. pede à Meta os contatos e o histórico do app (`smb_app_data`), que só
 *      podem ser pedidos nas 24 h seguintes e uma vez só.
 *
 * NUNCA chama `/register`: registrar pela API tira o número do celular.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { appDaMeta } from "@/lib/channels/meta/app";
import {
  estadoDaCoexistencia,
  numeroDaWaba,
  pedirSincronizacaoDoApp,
  trocarCodigoPorToken,
} from "@/lib/channels/meta/coexistencia";
import { conectarCanalOficial } from "@/lib/channels/meta/conectar-oficial";
import { ORIGEM_DO_EMBEDDED_SIGNUP } from "@/lib/channels/meta/origem-da-conexao";
import { env } from "@/lib/env";
import { graphVersion } from "@/lib/graph-version";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const concluirSchema = z.object({
  code: z.string().min(10).max(2048),
  waba_id: z.string().regex(/^\d{5,30}$/),
  phone_number_id: z
    .string()
    .regex(/^\d{5,30}$/)
    .nullish(),
});

function configuracaoDaJanela() {
  const appId = (env.META_APP_ID ?? "").trim();
  const configId = (env.META_EMBEDDED_SIGNUP_CONFIG_ID ?? "").trim();
  return { appId, configId, disponivel: Boolean(appId && configId) };
}

export async function GET(): Promise<NextResponse> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_official" });
  if (!authz.ok) return authz.response;
  const { appId, configId, disponivel } = configuracaoDaJanela();
  const { appSecret } = await appDaMeta();
  return ok({
    // Sem App Secret a troca do código falharia DEPOIS de o celular autorizar —
    // a pior hora para descobrir. A tela só oferece o botão com tudo em mãos.
    disponivel: disponivel && Boolean(appSecret),
    falta: !disponivel ? "app_id_ou_config_id" : !appSecret ? "app_secret" : null,
    app_id: disponivel ? appId : null,
    config_id: disponivel ? configId : null,
    graph_version: graphVersion(),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_official" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const parsed = concluirSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_request", "code e waba_id são obrigatórios", 422, { requestId });
  }

  const { appId, disponivel } = configuracaoDaJanela();
  const { appSecret } = await appDaMeta();
  if (!disponivel || !appSecret) {
    return fail("invalid_request", "a coexistência não está configurada nesta instalação", 422, { requestId });
  }

  const troca = await trocarCodigoPorToken({ code: parsed.data.code, appId, appSecret });
  if (!troca.ok) return fail("invalid_request", troca.motivo, 422, { requestId });

  let phoneNumberId = parsed.data.phone_number_id ?? null;
  if (!phoneNumberId) {
    const achado = await numeroDaWaba({ wabaId: parsed.data.waba_id, token: troca.token });
    if (!achado.ok) return fail("invalid_request", achado.motivo, 422, { requestId });
    phoneNumberId = achado.phoneNumberId;
  }

  const desfecho = await conectarCanalOficial({
    admin: createAdminClient(),
    req,
    orgId,
    userId: authz.user.id,
    idioma: authz.user.idioma,
    requestId,
    phoneNumberId,
    wabaId: parsed.data.waba_id,
    token: troca.token,
    origem: ORIGEM_DO_EMBEDDED_SIGNUP,
  });
  if (!desfecho.ok) {
    return fail(desfecho.code, desfecho.message, desfecho.status, {
      requestId,
      ...(desfecho.details !== undefined ? { details: desfecho.details } : {}),
    });
  }

  // Contatos primeiro, depois o histórico — a ordem da documentação da Meta. Cada
  // pedido é independente: a recusa de um não impede o outro, e os dois desfechos
  // vão para a tela e para a auditoria.
  const contatos = await pedirSincronizacaoDoApp({
    phoneNumberId,
    token: troca.token,
    tipo: "smb_app_state_sync",
  });
  const historico = await pedirSincronizacaoDoApp({ phoneNumberId, token: troca.token, tipo: "history" });
  const estado = await estadoDaCoexistencia({ phoneNumberId, token: troca.token });

  const resumo = (r: typeof contatos) =>
    r.ok ? { pedido: true, request_id: r.requestId, erro: null } : { pedido: false, request_id: null, erro: r.motivo };

  await audit({
    action: "channel.coexistencia_conectada",
    organizationId: orgId,
    actorUserId: authz.user.id,
    resourceType: "channel_session",
    resourceId: desfecho.channelSessionId,
    requestId,
    metadata: {
      phone_number_id: phoneNumberId,
      waba_id: parsed.data.waba_id,
      no_app: estado.noApp,
      plataforma: estado.plataforma,
      sincronizacao_contatos: resumo(contatos),
      sincronizacao_historico: resumo(historico),
    },
  });

  return ok({
    connected: true,
    displayName: desfecho.displayName,
    phoneNumber: desfecho.phoneNumber,
    origemGravada: desfecho.origemGravada,
    origem: desfecho.origem,
    webhookRegistro: desfecho.webhookRegistro,
    coexistencia: { no_app: estado.noApp, plataforma: estado.plataforma },
    sincronizacao: { contatos: resumo(contatos), historico: resumo(historico) },
  });
}
