/**
 * Coexistência — o número que JÁ está no app WhatsApp Business entra na Cloud API
 * sem sair do celular, pela janela da Meta (Embedded Signup com
 * `featureType: "whatsapp_business_app_onboarding"`).
 *
 * As três chamadas à Graph que a porta precisa, e só elas:
 *
 *   1. `trocarCodigoPorToken` — a janela devolve um CÓDIGO de uso único; o token
 *      sai dele aqui, no servidor, com o App Secret. O segredo nunca vai ao browser.
 *   2. `numeroDaWaba` — a mensagem da janela pode chegar só com a WABA. O número é
 *      perguntado à Meta, nunca chutado.
 *   3. `pedirSincronizacaoDoApp` — `POST /{phone_number_id}/smb_app_data`, uma vez
 *      para os contatos (`smb_app_state_sync`) e uma para as conversas antigas
 *      (`history`). A Meta só aceita nas 24 h seguintes à conexão e só UMA vez por
 *      tipo; perder a janela obriga a desconectar o número no app e refazer tudo.
 *
 * ─── O que esta porta NUNCA faz ─────────────────────────────────────────────
 *
 * `POST /{phone_number_id}/register`. Em coexistência o número já está
 * registrado pelo app; registrá-lo pela API é o que TIRA o número do celular.
 * Não existe chamada a `register` neste arquivo, e é proposital.
 *
 * Nada aqui lança: rede caída e recusa da Meta voltam como `{ ok: false, motivo }`
 * — o operador precisa do motivo, e a rota decide o status.
 */
import { graphBaseUrl } from "./graph-base";

type Resultado<T> = ({ ok: true } & T) | { ok: false; motivo: string };

interface ErroDaGraph {
  error?: { message?: string; error_data?: { details?: string }; code?: number };
}

function motivoDaGraph(body: ErroDaGraph, status: number): string {
  return body.error?.error_data?.details ?? body.error?.message ?? `http_${status}`;
}

async function lerJson(res: Response): Promise<Record<string, unknown> & ErroDaGraph> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown> & ErroDaGraph;
}

/**
 * Código da janela → token de acesso do negócio.
 *
 * O segredo vai no CORPO (form), não na URL: a Graph aceita os dois, e URL com
 * segredo acaba em log de proxy.
 */
export async function trocarCodigoPorToken(input: {
  code: string;
  appId: string;
  appSecret: string;
}): Promise<Resultado<{ token: string }>> {
  try {
    const corpo = new URLSearchParams({
      client_id: input.appId,
      client_secret: input.appSecret,
      code: input.code,
    });
    const res = await fetch(`${graphBaseUrl()}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: corpo.toString(),
    });
    const body = await lerJson(res);
    const token = typeof body.access_token === "string" ? body.access_token : "";
    if (!res.ok || body.error || !token) {
      return { ok: false, motivo: `a Meta recusou o código da janela: ${motivoDaGraph(body, res.status)}` };
    }
    return { ok: true, token };
  } catch (err) {
    return { ok: false, motivo: `rede indisponível: ${err instanceof Error ? err.message : "erro"}` };
  }
}

/** O número da WABA, quando a janela não o mandou. Mais de um = o operador escolhe. */
export async function numeroDaWaba(input: {
  wabaId: string;
  token: string;
}): Promise<Resultado<{ phoneNumberId: string }>> {
  try {
    const res = await fetch(
      `${graphBaseUrl()}/${input.wabaId}/phone_numbers?fields=id,display_phone_number&limit=50`,
      { headers: { Authorization: `Bearer ${input.token}` } },
    );
    const body = await lerJson(res);
    if (!res.ok || body.error) return { ok: false, motivo: motivoDaGraph(body, res.status) };
    const ids = (Array.isArray(body.data) ? (body.data as Array<{ id?: unknown }>) : [])
      .map((n) => (typeof n.id === "string" ? n.id : ""))
      .filter(Boolean);
    if (ids.length === 1) return { ok: true, phoneNumberId: ids[0]! };
    if (ids.length === 0) return { ok: false, motivo: `a WABA ${input.wabaId} não devolveu nenhum número` };
    return {
      ok: false,
      motivo: `a WABA ${input.wabaId} tem ${ids.length} números e a janela não disse qual foi conectado`,
    };
  } catch (err) {
    return { ok: false, motivo: `rede indisponível: ${err instanceof Error ? err.message : "erro"}` };
  }
}

export const TIPOS_DE_SINCRONIZACAO = ["smb_app_state_sync", "history"] as const;
export type TipoDeSincronizacao = (typeof TIPOS_DE_SINCRONIZACAO)[number];

/**
 * Pede à Meta que entregue o que está no app: contatos ou conversas antigas.
 *
 * `ok: true` só diz que o PEDIDO foi aceito (a Meta devolve um `request_id`).
 * Se o dono do celular recusou compartilhar o histórico, a recusa chega depois,
 * pelo webhook `history` com o erro 2593109 — e é lá que ela é registrada.
 */
export async function pedirSincronizacaoDoApp(input: {
  phoneNumberId: string;
  token: string;
  tipo: TipoDeSincronizacao;
}): Promise<Resultado<{ requestId: string | null }>> {
  try {
    const res = await fetch(`${graphBaseUrl()}/${input.phoneNumberId}/smb_app_data`, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", sync_type: input.tipo }),
    });
    const body = await lerJson(res);
    if (!res.ok || body.error) return { ok: false, motivo: motivoDaGraph(body, res.status) };
    return { ok: true, requestId: typeof body.request_id === "string" ? body.request_id : null };
  } catch (err) {
    return { ok: false, motivo: `rede indisponível: ${err instanceof Error ? err.message : "erro"}` };
  }
}

/**
 * O número está mesmo em coexistência? `is_on_biz_app: true` e
 * `platform_type: CLOUD_API` é o par que a Meta documenta como sucesso.
 * Informativo: a conexão não depende disto.
 */
export async function estadoDaCoexistencia(input: {
  phoneNumberId: string;
  token: string;
}): Promise<{ noApp: boolean | null; plataforma: string | null }> {
  try {
    const res = await fetch(`${graphBaseUrl()}/${input.phoneNumberId}?fields=is_on_biz_app,platform_type`, {
      headers: { Authorization: `Bearer ${input.token}` },
    });
    const body = await lerJson(res);
    return {
      noApp: typeof body.is_on_biz_app === "boolean" ? body.is_on_biz_app : null,
      plataforma: typeof body.platform_type === "string" ? body.platform_type : null,
    };
  } catch {
    return { noApp: null, plataforma: null };
  }
}
