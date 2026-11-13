/**
 * Ingestão do HISTÓRICO do app WhatsApp Business (coexistência) — as conversas
 * de antes da conexão, que a Meta entrega uma vez só no campo `history`.
 *
 * ─── Passado não é mensagem nova ────────────────────────────────────────────
 *
 * Seis meses de conversa entrando pelo caminho da recebida acordariam o agente
 * em cada uma, abririam demanda no funil, contariam como não lidas e poriam
 * tudo na fila do roteamento. Por isso esta ingestão é a irmã da importação do
 * canal por QR (#999, `lib/channels/historico/rodada.ts`) e usa as MESMAS duas
 * travas que o banco já respeita:
 *
 *   - `metadata.historico_importado = 'true'` em toda linha — a chave que os
 *     gatilhos de `messages` leem para não emitir efeito (0760);
 *   - `fn_upsert_wa_conversation_importada` — conversa existente volta intocada;
 *     a nova nasce `closed`, sem dono, fora do roteamento.
 *
 * E NÃO chama: `aplicarEfeitosPosEntrada`, `marcarConversaComMensagem`,
 * `pausarIaPorAtendimentoManual`, nem `emit_event`.
 *
 * ─── Quem pediu para ser esquecido não volta pelo histórico ────────────────
 *
 * O celular guarda conversa de quem pediu apagamento (LGPD). A pergunta é feita
 * por LOTE (`perguntarTitularesApagadosNoLote`), e falha na pergunta é falha
 * FECHADA: o lote inteiro fica de fora e a Meta não reentrega — preferimos
 * perder histórico a recriar quem pediu para sair. Contato anonimizado idem.
 *
 * Idempotente pelo `unique (organization_id, external_id)`: a Meta reentrega o
 * que não recebe 2xx, e a mesma mensagem não entra duas vezes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { nomeDeArquivoLimpo } from "@/lib/messaging/media/nome-de-arquivo";

import { encontrarContatoPorTelefoneComAnonimizacao } from "../contato-por-telefone";
import { canonicalPhoneBR, phoneLookupVariants } from "../phone-variants";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";
import { perguntarTitularesApagadosNoLote } from "./titular-apagado";
import type { HistoryMessageEvent, InboundMessageEvent } from "./webhook";

type Admin = SupabaseClient;

/** A marca que os gatilhos de `messages` leem (0760). Valor TEXTO, não booleano. */
export const MARCA_DE_HISTORICO = "true" as const;
/** De onde veio a linha — distingue do importador do canal por QR. */
export const ORIGEM_DO_HISTORICO_META = "meta_coexistencia" as const;

export interface ContagemDoHistorico {
  gravadas: number;
  existentes: number;
  midiasCompletadas: number;
  ignoradas: number;
  falhas: number;
}

function vazia(): ContagemDoHistorico {
  return { gravadas: 0, existentes: 0, midiasCompletadas: 0, ignoradas: 0, falhas: 0 };
}

/**
 * O mesmo número, com ou sem o nono dígito: a Meta já mandou `wa_id` sem ele
 * para quem o tem (ver o cabeçalho de `ingest.ts`), e o número da EMPRESA no
 * `metadata.display_phone_number` pode vir numa grafia e o `from` na outra.
 */
export function mesmoNumero(a: string, b: string): boolean {
  const va = new Set(phoneLookupVariants(a));
  return phoneLookupVariants(b).some((v) => va.has(v));
}

/**
 * A mídia antiga chega em `messages` com `history_context`: vira evento de
 * histórico. `null` quando foi a EMPRESA que mandou — esse payload não diz para
 * quem (a Meta só põe `to` no eco), e sem conversa não há onde gravar.
 */
export function historicoDaRecebida(e: InboundMessageEvent): HistoryMessageEvent | null {
  const from = e.from.replace(/\D/g, "");
  if (e.businessNumber && mesmoNumero(from, e.businessNumber)) return null;
  return {
    kind: "history_message",
    wabaId: e.wabaId,
    phoneNumberId: e.phoneNumberId,
    businessNumber: e.businessNumber ?? null,
    threadId: from,
    externalId: e.externalId,
    from,
    sentAt: e.sentAt,
    type: e.type,
    text: e.text,
    ...(e.sharedContact ? { sharedContact: e.sharedContact } : {}),
    media: e.media,
    placeholder: false,
    status: null,
  };
}

/** Saiu da empresa? Pelo número dela; sem ele, por não ser o cliente da conversa. */
export function saiuDaEmpresa(e: HistoryMessageEvent): boolean {
  if (e.businessNumber) return mesmoNumero(e.from, e.businessNumber);
  return !mesmoNumero(e.from, e.threadId);
}

/** `history_context.status` → o vocabulário do CHECK de `messages.status`. */
export function statusDoHistorico(e: HistoryMessageEvent): string {
  const s = (e.status ?? "").toUpperCase();
  if (!saiuDaEmpresa(e)) return s === "READ" || s === "PLAYED" ? "read" : "delivered";
  if (s === "READ" || s === "PLAYED") return "read";
  if (s === "DELIVERED") return "delivered";
  if (s === "ERROR") return "failed";
  return "sent";
}

function linhaDaMensagem(
  e: HistoryMessageEvent,
  alvo: { orgId: string; sessaoId: string; contactId: string; conversationId: string },
) {
  const daEmpresa = saiuDaEmpresa(e);
  const nomeDoArquivo = nomeDeArquivoLimpo(e.media?.filename);
  return {
    organization_id: alvo.orgId,
    conversation_id: alvo.conversationId,
    channel_session_id: alvo.sessaoId,
    contact_id: alvo.contactId,
    direction: daEmpresa ? "outbound" : "inbound",
    status: statusDoHistorico(e),
    ...(daEmpresa ? { sent_via: "external_device" } : {}),
    type: e.type,
    body: e.type === "contact" ? (e.sharedContact?.name ?? e.text) : e.text,
    external_id: e.externalId,
    media_url: e.media ? `meta-media:${e.media.id}` : null,
    media_mime: e.media?.mime ?? null,
    sent_at: e.sentAt.toISOString(),
    metadata: {
      historico_importado: MARCA_DE_HISTORICO,
      origem_historico: ORIGEM_DO_HISTORICO_META,
      ...(daEmpresa ? { from_business_app: true } : {}),
      ...(e.placeholder ? { media_placeholder: true } : {}),
      ...(e.media ? { meta_media_id: e.media.id, voice: e.media.voice } : {}),
      ...(nomeDoArquivo ? { media_filename: nomeDoArquivo } : {}),
      ...(e.sharedContact ? { shared_contact: e.sharedContact } : {}),
    },
  };
}

async function sessaoDoNumero(admin: Admin, orgId: string, phoneNumberId: string) {
  const base = () =>
    admin
      .from("channel_sessions")
      .select("id, organization_id")
      .eq("organization_id", orgId)
      .eq("meta_phone_number_id", phoneNumberId);
  const { data, error } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );
  if (error) throw new Error(`sessao_do_numero: ${error.message ?? "erro"}`);
  return data as { id: string; organization_id: string } | null;
}

/**
 * Mensagem que já existe só como "📎 Mídia" (placeholder do `history`) e agora
 * chegou com o arquivo: completa a MESMA linha em vez de perder a mídia no 23505.
 */
async function completarMidia(admin: Admin, orgId: string, e: HistoryMessageEvent): Promise<boolean> {
  if (!e.media) return false;
  const { data, error } = await admin
    .from("messages")
    .select("id, metadata")
    .eq("organization_id", orgId)
    .eq("external_id", e.externalId)
    .maybeSingle();
  if (error || !data) return false;
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  if (metadata.media_placeholder !== true) return false;
  const nomeDoArquivo = nomeDeArquivoLimpo(e.media.filename);
  const { error: erroUpdate } = await admin
    .from("messages")
    .update({
      type: e.type,
      body: e.text,
      media_url: `meta-media:${e.media.id}`,
      media_mime: e.media.mime,
      metadata: {
        ...metadata,
        media_placeholder: false,
        meta_media_id: e.media.id,
        voice: e.media.voice,
        ...(nomeDoArquivo ? { media_filename: nomeDoArquivo } : {}),
      },
    })
    .eq("organization_id", orgId)
    .eq("id", (data as { id: string }).id);
  return !erroUpdate;
}

/**
 * Grava um lote do histórico. A organização vem de `dono` (token do PATH do
 * webhook), nunca do corpo; o `phone_number_id` só escolhe QUAL sessão dela.
 */
export async function ingestMetaHistorico(
  admin: Admin,
  eventos: readonly HistoryMessageEvent[],
  dono: { organizationId: string },
): Promise<ContagemDoHistorico> {
  const conta = vazia();
  if (eventos.length === 0) return conta;
  const orgId = dono.organizationId;

  // Por número NOSSO e, dentro dele, por conversa (o cliente).
  const porSessao = new Map<string, Map<string, HistoryMessageEvent[]>>();
  for (const e of eventos) {
    const threads = porSessao.get(e.phoneNumberId) ?? new Map<string, HistoryMessageEvent[]>();
    const lista = threads.get(e.threadId) ?? [];
    lista.push(e);
    threads.set(e.threadId, lista);
    porSessao.set(e.phoneNumberId, threads);
  }

  for (const [phoneNumberId, threads] of porSessao) {
    let sessao: { id: string } | null;
    try {
      sessao = await sessaoDoNumero(admin, orgId, phoneNumberId);
    } catch (err) {
      logger.error("[meta.historico] sessão do número não consultada", {
        organization_id: orgId,
        erro: err instanceof Error ? err.message : "erro",
      });
      conta.falhas += [...threads.values()].reduce((n, l) => n + l.length, 0);
      continue;
    }
    if (!sessao) {
      conta.ignoradas += [...threads.values()].reduce((n, l) => n + l.length, 0);
      continue;
    }

    const lote = await perguntarTitularesApagadosNoLote(
      admin,
      orgId,
      [...threads.keys()].map((t) => `+${t}`),
    );
    if (lote.erro) {
      // Falha FECHADA: sem saber quem pediu apagamento, ninguém entra.
      logger.error("[meta.historico] pergunta do titular apagado falhou — lote fora", {
        organization_id: orgId,
        erro: lote.erro,
      });
      conta.falhas += [...threads.values()].reduce((n, l) => n + l.length, 0);
      continue;
    }

    for (const [threadId, mensagens] of threads) {
      const telefone = canonicalPhoneBR(`+${threadId}`);
      if (lote.apagados.has(telefone)) {
        conta.ignoradas += mensagens.length;
        continue;
      }
      try {
        await gravarConversa(admin, { orgId, sessaoId: sessao.id, threadId, telefone }, mensagens, conta);
      } catch (err) {
        conta.falhas += mensagens.length;
        logger.error("[meta.historico] conversa não gravada", {
          organization_id: orgId,
          erro: err instanceof Error ? err.message : "erro",
        });
      }
    }
  }
  return conta;
}

async function gravarConversa(
  admin: Admin,
  alvo: { orgId: string; sessaoId: string; threadId: string; telefone: string },
  mensagens: HistoryMessageEvent[],
  conta: ContagemDoHistorico,
): Promise<void> {
  const existente = await encontrarContatoPorTelefoneComAnonimizacao(admin, alvo.orgId, alvo.threadId);
  if (existente?.is_anonymized) {
    conta.ignoradas += mensagens.length;
    return;
  }
  const phone = existente?.phone_number ? canonicalPhoneBR(existente.phone_number) : alvo.telefone;

  const { data: contactId, error: erroContato } = await admin.rpc(
    "fn_upsert_wa_contact" as never,
    { p_org: alvo.orgId, p_kind: "phone", p_phone: phone, p_lid: null, p_chat_id: alvo.threadId, p_notify: null } as never,
  );
  if (erroContato || !contactId) throw new Error(`contato: ${erroContato?.message ?? "sem id"}`);

  const ultima = mensagens.reduce((max, m) => (m.sentAt > max ? m.sentAt : max), new Date(0));
  const { data: conversationId, error: erroConversa } = await admin.rpc(
    "fn_upsert_wa_conversation_importada" as never,
    {
      p_org: alvo.orgId,
      p_contact: contactId as string,
      p_session: alvo.sessaoId,
      p_last_message_at: ultima.getTime() > 0 ? ultima.toISOString() : null,
    } as never,
  );
  if (erroConversa || !conversationId) throw new Error(`conversa: ${erroConversa?.message ?? "sem id"}`);

  const ids = mensagens.map((m) => m.externalId);
  const { data: achadas, error: erroConsulta } = await admin
    .from("messages")
    .select("external_id")
    .eq("organization_id", alvo.orgId)
    .in("external_id", ids);
  if (erroConsulta) throw new Error(`consulta: ${erroConsulta.message}`);
  const ja = new Set(((achadas ?? []) as Array<{ external_id: string | null }>).map((r) => r.external_id));

  const destino = {
    orgId: alvo.orgId,
    sessaoId: alvo.sessaoId,
    contactId: contactId as string,
    conversationId: conversationId as string,
  };
  const vistos = new Set<string>();
  const novas: HistoryMessageEvent[] = [];
  for (const m of mensagens) {
    if (vistos.has(m.externalId)) continue;
    vistos.add(m.externalId);
    if (ja.has(m.externalId)) {
      if (await completarMidia(admin, alvo.orgId, m)) conta.midiasCompletadas += 1;
      else conta.existentes += 1;
      continue;
    }
    novas.push(m);
  }
  if (novas.length === 0) return;

  const { error: erroLote } = await admin.from("messages").insert(novas.map((m) => linhaDaMensagem(m, destino)));
  if (!erroLote) {
    conta.gravadas += novas.length;
    return;
  }
  // O unique de `external_id` é DEFERRABLE: um 23505 (corrida com outra entrega)
  // recusa o lote inteiro. Aí cada linha vai sozinha, e o 23505 conta como existente.
  for (const m of novas) {
    const { error } = await admin.from("messages").insert(linhaDaMensagem(m, destino));
    if (!error) conta.gravadas += 1;
    else if (error.code === "23505") {
      if (await completarMidia(admin, alvo.orgId, m)) conta.midiasCompletadas += 1;
      else conta.existentes += 1;
    } else {
      conta.falhas += 1;
      logger.error("[meta.historico] mensagem não gravada", { organization_id: alvo.orgId, erro: error.message });
    }
  }
}
