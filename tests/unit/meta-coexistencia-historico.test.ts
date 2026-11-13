import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O HISTÓRICO do app WhatsApp Business (coexistência) — o campo `history`.
 *
 * O que este arquivo mede:
 *   1. o parser lê `history[].threads[].messages[]`, decide a direção pelo
 *      número da EMPRESA, e transforma `media_placeholder` em linha marcada;
 *   2. a recusa do celular (2593109) vira um pedaço com erro, não silêncio;
 *   3. a ingestão grava com `historico_importado = 'true'` (a chave que os
 *      gatilhos de `messages` leem) e pela conversa IMPORTADA, sem nenhum
 *      efeito de mensagem nova;
 *   4. quem pediu apagamento não volta, e a pergunta que falha deixa o lote fora;
 *   5. a mídia que chega depois completa a linha do placeholder.
 */

const estado = vi.hoisted(() => ({
  rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>,
  inseridas: [] as Array<Record<string, unknown>>,
  atualizadas: [] as Array<Record<string, unknown>>,
  existentes: [] as Array<{ id: string; external_id: string; metadata: Record<string, unknown> }>,
  apagados: { data: [] as unknown, error: null as { message: string } | null },
  contato: null as { id: string; phone_number: string | null; is_anonymized: boolean | null } | null,
}));

vi.mock("@/lib/channels/contato-por-telefone", () => ({
  encontrarContatoPorTelefone: async () => estado.contato,
  encontrarContatoPorTelefoneComAnonimizacao: async () => estado.contato,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { historicoDaRecebida, ingestMetaHistorico, statusDoHistorico } from "@/lib/channels/meta/historico";
import {
  parseMetaWebhook,
  type HistoryChunkEvent,
  type HistoryMessageEvent,
  type InboundMessageEvent,
} from "@/lib/channels/meta/webhook";

const EMPRESA = "554797507391";
const CLIENTE = "5547999990000";

function envelopeDeHistorico(history: unknown[]) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "history",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "+55 47 9750-7391", phone_number_id: "phone-1" },
              history,
            },
          },
        ],
      },
    ],
  } as Parameters<typeof parseMetaWebhook>[0];
}

function pedaco(messages: unknown[]) {
  return {
    metadata: { phase: 1, chunk_order: 3, progress: 40 },
    threads: [{ id: CLIENTE, messages }],
  };
}

/** Admin falso: o suficiente para as consultas que a ingestão faz, e o registro delas. */
function adminFalso(): SupabaseClient {
  const builder = (table: string) => {
    const filtros: Array<[string, unknown]> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: unknown = null;
    const b: Record<string, unknown> = {};
    const resolver = () => {
      if (table === "channel_sessions") return { data: { id: "sessao-1", organization_id: "org-1" }, error: null };
      if (table === "messages" && op === "select") {
        const ext = filtros.find(([c]) => c === "external_id")?.[1];
        const lista = filtros.find(([c]) => c === "external_id.in")?.[1] as string[] | undefined;
        if (lista) return { data: estado.existentes.filter((m) => lista.includes(m.external_id)), error: null };
        return { data: estado.existentes.find((m) => m.external_id === ext) ?? null, error: null };
      }
      if (table === "messages" && op === "insert") {
        const linhas = Array.isArray(payload) ? payload : [payload];
        estado.inseridas.push(...(linhas as Array<Record<string, unknown>>));
        return { data: null, error: null };
      }
      if (table === "messages" && op === "update") {
        estado.atualizadas.push(payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };
    Object.assign(b, {
      select: () => b,
      insert: (p: unknown) => ((op = "insert"), (payload = p), b),
      update: (p: unknown) => ((op = "update"), (payload = p), b),
      eq: (c: string, v: unknown) => (filtros.push([c, v]), b),
      is: () => b,
      in: (c: string, v: unknown) => (filtros.push([`${c}.in`, v]), b),
      maybeSingle: async () => resolver(),
      then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko),
    });
    return b;
  };
  return {
    from: builder,
    rpc: async (name: string, args: Record<string, unknown>) => {
      estado.rpcs.push({ name, args });
      if (name === "fn_titulares_apagados_a_pedido") return estado.apagados;
      if (name === "fn_upsert_wa_contact") return { data: "contato-1", error: null };
      if (name === "fn_upsert_wa_conversation_importada") return { data: "conversa-1", error: null };
      return { data: null, error: { message: `rpc inesperada: ${name}` } };
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  estado.rpcs = [];
  estado.inseridas = [];
  estado.atualizadas = [];
  estado.existentes = [];
  estado.apagados = { data: [], error: null };
  estado.contato = null;
});

describe("parser do campo history", () => {
  it("lê a conversa, decide a direção pelo número da empresa e marca o placeholder de mídia", () => {
    const eventos = parseMetaWebhook(
      envelopeDeHistorico([
        pedaco([
          { from: CLIENTE, id: "wamid.1", timestamp: "1739230955", type: "text", text: { body: "Oi, tem sofá?" }, history_context: { status: "READ" } },
          { from: EMPRESA, id: "wamid.2", timestamp: "1739231000", type: "text", text: { body: "Temos sim!" }, history_context: { status: "DELIVERED" } },
          { from: CLIENTE, id: "wamid.3", timestamp: "1739231100", type: "media_placeholder", history_context: { status: "READ" } },
          { from: CLIENTE, id: "wamid.4", timestamp: "1739231200", type: "reaction", reaction: { message_id: "wamid.2", emoji: "👍" } },
        ]),
      ]),
    );
    const mensagens = eventos.filter((e): e is HistoryMessageEvent => e.kind === "history_message");
    const pedacos = eventos.filter((e): e is HistoryChunkEvent => e.kind === "history_chunk");

    expect(mensagens.map((m) => m.externalId)).toEqual(["wamid.1", "wamid.2", "wamid.3"]);
    expect(mensagens[0]).toMatchObject({ threadId: CLIENTE, businessNumber: EMPRESA, type: "text", text: "Oi, tem sofá?" });
    expect(mensagens[0]!.sentAt.toISOString()).toBe("2025-02-10T23:42:35.000Z");
    expect(statusDoHistorico(mensagens[0]!)).toBe("read");
    expect(statusDoHistorico(mensagens[1]!)).toBe("delivered");
    expect(mensagens[2]).toMatchObject({ placeholder: true, type: "text" });
    expect(pedacos).toEqual([
      expect.objectContaining({ phase: 1, chunkOrder: 3, progress: 40, mensagens: 3, erro: null }),
    ]);
  });

  it("a recusa do celular vira pedaço com erro, sem mensagem", () => {
    const eventos = parseMetaWebhook(
      envelopeDeHistorico([
        { errors: [{ code: 2593109, title: "History sync is turned off", message: "History sync is turned off by the business" }] },
      ]),
    );
    expect(eventos).toEqual([
      expect.objectContaining({
        kind: "history_chunk",
        mensagens: 0,
        erro: { code: 2593109, motivo: "History sync is turned off by the business" },
      }),
    ]);
  });

  it("a mídia antiga em `messages` com history_context é marcada como histórico", () => {
    const eventos = parseMetaWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-1",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { display_phone_number: "+55 47 9750-7391", phone_number_id: "phone-1" },
                messages: [
                  { from: CLIENTE, id: "wamid.3", timestamp: "1739231100", type: "image", image: { id: "midia-9", mime_type: "image/jpeg" }, history_context: { status: "READ" } },
                ],
              },
            },
          ],
        },
      ],
    } as Parameters<typeof parseMetaWebhook>[0]);
    const recebida = eventos[0] as InboundMessageEvent;
    expect(recebida).toMatchObject({ kind: "inbound_message", historico: true, businessNumber: EMPRESA });
    expect(historicoDaRecebida(recebida)).toMatchObject({ threadId: CLIENTE, media: { id: "midia-9" } });
    // A da EMPRESA não diz para quem foi: não há conversa onde gravar.
    expect(historicoDaRecebida({ ...recebida, from: EMPRESA })).toBeNull();
    // ...nem na grafia com o nono dígito, que a Meta pode usar no `from`.
    expect(historicoDaRecebida({ ...recebida, from: "5547997507391" })).toBeNull();
  });
});

describe("ingestão do histórico", () => {
  function eventos(): HistoryMessageEvent[] {
    return parseMetaWebhook(
      envelopeDeHistorico([
        pedaco([
          { from: CLIENTE, id: "wamid.1", timestamp: "1739230955", type: "text", text: { body: "Oi" }, history_context: { status: "READ" } },
          { from: EMPRESA, id: "wamid.2", timestamp: "1739231000", type: "text", text: { body: "Olá" }, history_context: { status: "READ" } },
        ]),
      ]),
    ).filter((e): e is HistoryMessageEvent => e.kind === "history_message");
  }

  it("grava como passado: marca do histórico, conversa importada, nenhum efeito de mensagem nova", async () => {
    const conta = await ingestMetaHistorico(adminFalso(), eventos(), { organizationId: "org-1" });

    expect(conta).toMatchObject({ gravadas: 2, existentes: 0, falhas: 0 });
    expect(estado.rpcs.map((r) => r.name)).toEqual([
      "fn_titulares_apagados_a_pedido",
      "fn_upsert_wa_contact",
      "fn_upsert_wa_conversation_importada",
    ]);
    expect(estado.inseridas).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        direction: "inbound",
        external_id: "wamid.1",
        metadata: expect.objectContaining({ historico_importado: "true", origem_historico: "meta_coexistencia" }),
      }),
      expect.objectContaining({
        direction: "outbound",
        sent_via: "external_device",
        status: "read",
        metadata: expect.objectContaining({ historico_importado: "true", from_business_app: true }),
      }),
    ]);
  });

  it("quem pediu apagamento não volta pelo histórico", async () => {
    estado.apagados = { data: [`+${CLIENTE}`], error: null };
    const conta = await ingestMetaHistorico(adminFalso(), eventos(), { organizationId: "org-1" });
    expect(conta).toMatchObject({ gravadas: 0, ignoradas: 2 });
    expect(estado.inseridas).toEqual([]);
  });

  it("a pergunta do apagamento que falha deixa o lote inteiro fora (falha fechada)", async () => {
    estado.apagados = { data: null, error: { message: "rede" } };
    const conta = await ingestMetaHistorico(adminFalso(), eventos(), { organizationId: "org-1" });
    expect(conta).toMatchObject({ gravadas: 0, falhas: 2 });
    expect(estado.inseridas).toEqual([]);
  });

  it("a mídia que chega depois completa a linha do placeholder em vez de duplicar", async () => {
    estado.existentes = [{ id: "msg-3", external_id: "wamid.3", metadata: { historico_importado: "true", media_placeholder: true } }];
    const midia: HistoryMessageEvent = {
      ...eventos()[0]!,
      externalId: "wamid.3",
      type: "image",
      text: null,
      media: { id: "midia-9", url: null, mime: "image/jpeg", voice: false },
    };
    const conta = await ingestMetaHistorico(adminFalso(), [midia], { organizationId: "org-1" });
    expect(conta).toMatchObject({ gravadas: 0, midiasCompletadas: 1 });
    expect(estado.atualizadas).toEqual([
      expect.objectContaining({
        type: "image",
        media_url: "meta-media:midia-9",
        metadata: expect.objectContaining({ historico_importado: "true", media_placeholder: false }),
      }),
    ]);
  });
});
