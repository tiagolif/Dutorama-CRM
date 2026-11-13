/**
 * Conectar (ou reconectar) o canal oficial da organização — o miolo comum das
 * DUAS portas: o token colado à mão (`POST /api/v1/channels/official`) e a
 * janela da Meta em coexistência (`POST /api/v1/channels/official/coexistencia`).
 *
 * Era o corpo do POST manual. Saiu de lá quando nasceu a segunda porta, porque
 * as duas gravam a MESMA linha de `channel_sessions` e uma cópia divergiria na
 * primeira correção (validar antes de gravar, ressuscitar o canal arquivado,
 * registrar o webhook DEPOIS da linha existir). O racional de cada passo segue
 * nos comentários abaixo, onde ele mora desde a rota original.
 *
 * A ORIGEM é parâmetro do chamador, e cada rota passa a SUA constante — nunca o
 * que vier no corpo do request (#4074: procedência que o cliente escolhe não é
 * procedência).
 *
 * Não monta resposta HTTP: devolve o desfecho, e quem fala com o browser decide
 * o status. Assim a rota da coexistência pode acrescentar o pedido de
 * sincronização do app sem reescrever a conexão.
 */
import type { NextRequest } from "next/server";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import {
  ROTULOS_DA_ORIGEM,
  registrarOrigemDaConexao,
  type OrigemDaConexaoOficial,
} from "@/lib/channels/meta/origem-da-conexao";
import { validateMetaCredentials } from "@/lib/channels/meta/validate-credentials";
import { registrarWebhookDaSessao } from "@/lib/channels/meta/webhook-da-sessao";
import { reactivateChannelSession } from "@/lib/channels/reactivate";
import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import { traduzirLimiteDoPlano } from "@/lib/cobranca/limites";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import type { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { basePublicaDoWebhookMeta } from "@/lib/webhooks/url-publica";

type Admin = ReturnType<typeof createAdminClient>;

export interface PedidoDeConexaoOficial {
  admin: Admin;
  req: NextRequest;
  orgId: string;
  userId: string;
  idioma: Idioma;
  requestId: string;
  phoneNumberId: string;
  wabaId: string;
  token: string;
  origem: OrigemDaConexaoOficial;
}

export type DesfechoDaConexaoOficial =
  | {
      ok: true;
      channelSessionId: string | null;
      displayName: string;
      phoneNumber: string | null;
      origemGravada: boolean;
      origem: { valor: OrigemDaConexaoOficial; rotulo: string };
      webhookRegistro: { registrado: boolean; url: string | null; erro: string | null; em: string | null } | null;
    }
  | {
      ok: false;
      code: string;
      message: string;
      status: number;
      details?: unknown;
    };

export async function conectarCanalOficial(p: PedidoDeConexaoOficial): Promise<DesfechoDaConexaoOficial> {
  const t = (texto: string) => traduzir(texto, p.idioma);
  const { admin, orgId, userId, requestId } = p;

  // VALIDA ANTES DE GRAVAR — a rota não sabe com quem fala; ela pergunta se a
  // credencial presta e o canal responde.
  //
  // `wabaId` junto desde a fatia F1: a checagem do número sozinha aceita o par
  // trocado (número de uma conta, id de outra), e o registro do webhook logo abaixo
  // apontaria o override de um número que esta instalação não controla.
  const validacao = await validateMetaCredentials({
    phoneNumberId: p.phoneNumberId,
    token: p.token,
    wabaId: p.wabaId,
  });
  if (!validacao.ok) {
    return { ok: false, code: "invalid_request", message: validacao.motivo, status: 422 };
  }

  const cifrado = await encryptWebhookSecret(admin, p.token);
  if (!cifrado) {
    // Sem a GUC de cifra configurada, gravar o token em claro seria pior que
    // recusar. O operador precisa saber que falta uma configuração de servidor.
    return {
      ok: false,
      code: "invalid_request",
      message: t(
        "cifra indisponível nesta instalação (GUC app.nuvemshop_oauth_key ausente) — o token não foi gravado",
      ),
      status: 422,
    };
  }

  // A busca NÃO filtra `archived_at`: um canal oficial excluído é exatamente o
  // que este POST precisa achar para trazer de volta. Ignorá-lo criaria uma
  // SEGUNDA linha oficial na org — e a linha velha continuaria segurando o par
  // (org, número) na trava da 0106.
  const buscarExistente = (colunas: string) =>
    admin
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", orgId)
      .eq("provider", CHANNEL_PROVIDER_META)
      .maybeSingle();
  const { data: existenteRaw } = await queryTolerantToMissingArchived(
    () => buscarExistente(`id, ${ARCHIVED_AT}, webhook_path_token, display_name`),
    () => buscarExistente("id, webhook_path_token, display_name"),
  );
  const existente = existenteRaw as {
    id: string;
    archived_at?: string | null;
    webhook_path_token?: string | null;
    display_name?: string | null;
  } | null;

  const linha = {
    organization_id: orgId,
    provider: CHANNEL_PROVIDER_META,
    meta_phone_number_id: p.phoneNumberId,
    meta_waba_id: p.wabaId,
    meta_token_encrypted: cifrado,
    phone_number: validacao.displayPhoneNumber ? `+${validacao.displayPhoneNumber.replace(/\D/g, "")}` : null,
    // O nome do provedor só batiza a conexão; depois dela o nome é do operador
    // (Renomear), e salvar a credencial de novo não o apaga. Mesma regra do
    // `coalesce(display_name, ...)` do pareamento por QR.
    display_name: existente?.display_name || (validacao.verifiedName ?? "Canal oficial"),
    status: "WORKING",
  };

  // `update` quando já existe em vez de upsert: a trava única de (org,
  // phone_number) é um índice único PARCIAL (`where archived_at is null`, 0107),
  // que só seria inferível em `ON CONFLICT` se a cláusula repetisse o predicado —
  // e o cliente do PostgREST não expõe isso.
  //
  // O update passa por `reactivateChannelSession` porque reconectar é
  // ressuscitar: o mesmo patch que devolve status, credencial e número tem que
  // devolver a linha à vida, ou o canal fica "conectado" na tela e excluído para
  // todo o resto do sistema. Para o canal que já estava ativo é um no-op — e a
  // auditoria de volta sai de lá, junto da ressurreição, não daqui.
  let idDaSessao: string | null = existente?.id ?? null;
  let webhookPathToken: string | null = existente?.webhook_path_token ?? null;
  let error: { message?: string | null } | null = null;

  if (existente) {
    ({ error } = await reactivateChannelSession(
      admin,
      {
        organizationId: orgId,
        channelSessionId: existente.id,
        archivedAt: existente.archived_at ?? null,
      },
      linha,
      {
        userId,
        requestId,
        metadata: { provider: CHANNEL_PROVIDER_META, phone_number: linha.phone_number },
      },
    ));
  } else {
    // `select("id, webhook_path_token")` porque o registro do webhook logo abaixo
    // precisa dos DOIS: o id para gravar o desfecho na mesma linha, e o token porque
    // é ele que compõe a URL que a Meta vai chamar.
    const inserida = await admin
      .from("channel_sessions")
      .insert({
        ...linha,
        webhook_secret_encrypted: cifrado,
        metadata: metadataInicialDoCanal(),
      })
      .select("id, webhook_path_token")
      .maybeSingle();
    error = inserida.error;
    idDaSessao = inserida.data?.id ?? null;
    webhookPathToken = inserida.data?.webhook_path_token ?? null;
  }

  if (error) {
    // Ressuscitar ou criar o canal acima do plano: o gatilho de canais recusa (spec cobrança §5).
    const limite = traduzirLimiteDoPlano(error, p.idioma);
    if (limite) {
      return { ok: false, code: limite.code, message: limite.message, status: 409, details: limite.details };
    }
    return {
      ok: false,
      code: "internal_error",
      message: error.message ?? "channel_session_write_failed",
      status: 500,
    };
  }

  // ─── DE ONDE nasceu esta conexão (#4074) ──────────────────────────────────
  // DEPOIS da gravação e best-effort: a coluna chega na migration 9328, e num
  // banco anterior a ela o canal continua conectado (o desfecho vira
  // `origemGravada: false`, não erro).
  const origem =
    idDaSessao !== null
      ? await registrarOrigemDaConexao(admin, {
          organizationId: orgId,
          channelSessionId: idDaSessao,
          origem: p.origem,
        })
      : null;

  // ─── O webhook DESTE número, registrado pela própria instalação (fatia F1) ──
  // DEPOIS de gravar, nunca antes: o GET de verificação da Meta chega no instante
  // em que o override é registrado e procura a sessão pelo `webhook_path_token` —
  // registrar antes de a linha existir devolveria 404 e a Meta marcaria o webhook
  // como inválido, que é pior que não registrar.
  const webhook =
    idDaSessao && webhookPathToken
      ? await registrarWebhookDaSessao({
          admin,
          channelSessionId: idDaSessao,
          phoneNumberId: p.phoneNumberId,
          wabaId: p.wabaId,
          tokenCifrado: cifrado,
          webhookPathToken,
          base: basePublicaDoWebhookMeta(p.req),
          requestId,
        })
      : null;

  return {
    ok: true,
    channelSessionId: idDaSessao,
    displayName: linha.display_name,
    phoneNumber: linha.phone_number,
    origemGravada: Boolean(origem?.gravada),
    origem: { valor: p.origem, rotulo: ROTULOS_DA_ORIGEM[p.origem] },
    webhookRegistro: webhook
      ? { registrado: webhook.registrado, url: webhook.url, erro: webhook.erro, em: webhook.em }
      : null,
  };
}
