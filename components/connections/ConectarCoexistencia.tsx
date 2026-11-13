"use client";
/**
 * "Conectar com o app WhatsApp Business" — a porta da coexistência (#4074).
 *
 * Abre a janela da Meta (SDK JavaScript do Facebook, `FB.login` com o
 * `config_id` da instalação e `featureType: whatsapp_business_app_onboarding`).
 * O dono escaneia o QR com o celular onde o app já está; o número CONTINUA no
 * celular. A janela devolve duas coisas por caminhos diferentes:
 *
 *   - a mensagem `WA_EMBEDDED_SIGNUP` (postMessage de facebook.com) com a WABA e,
 *     às vezes, o número;
 *   - o `code` de uso único, no retorno do `FB.login`.
 *
 * Só o CÓDIGO vai ao servidor — nunca um token. Quem troca é a rota, com o App
 * Secret, e é ela que pede o histórico do app logo em seguida (prazo de 24 h).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

interface ConfiguracaoDaJanela {
  disponivel: boolean;
  falta: string | null;
  app_id: string | null;
  config_id: string | null;
  graph_version: string;
}

interface Sincronizacao {
  pedido: boolean;
  request_id: string | null;
  erro: string | null;
}

interface RespostaDaConexao {
  connected: boolean;
  displayName: string;
  phoneNumber: string | null;
  sincronizacao: { contatos: Sincronizacao; historico: Sincronizacao };
}

interface FacebookSdk {
  init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(
    cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void,
    opts: Record<string, unknown>,
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = "https://connect.facebook.net/pt_BR/sdk.js";

/** Carrega o SDK uma vez e devolve o `FB` já iniciado com o app da instalação. */
function carregarSdk(appId: string, version: string): Promise<FacebookSdk> {
  return new Promise((resolve, reject) => {
    if (window.FB) {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB);
      return;
    }
    window.fbAsyncInit = () => {
      if (!window.FB) return reject(new Error("sdk_sem_fb"));
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB);
    };
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("sdk_nao_carregou"));
    document.body.appendChild(s);
  });
}

/** A mensagem da janela só vale vinda do domínio do Facebook. */
function origemDoFacebook(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "facebook.com" || host.endsWith(".facebook.com");
  } catch {
    return false;
  }
}

export function ConectarCoexistencia() {
  const t = useT();
  const qc = useQueryClient();
  const [etapa, setEtapa] = useState<"parado" | "janela" | "concluindo">("parado");
  const [resultado, setResultado] = useState<RespostaDaConexao | null>(null);
  const sessao = useRef<{ waba_id?: string; phone_number_id?: string }>({});

  const { data } = useQuery({
    queryKey: ["official-channel-coexistencia"],
    queryFn: async () => apiClient.get<{ data: ConfiguracaoDaJanela }>("/api/v1/channels/official/coexistencia"),
    staleTime: 60_000,
  });
  const cfg = data?.data;
  if (!cfg?.disponivel || !cfg.app_id || !cfg.config_id) return null;
  const appId = cfg.app_id;
  const configId = cfg.config_id;

  async function abrir() {
    setResultado(null);
    sessao.current = {};
    setEtapa("janela");

    const ouvir = (ev: MessageEvent) => {
      if (!origemDoFacebook(ev.origin)) return;
      try {
        const msg = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        if (msg?.type !== "WA_EMBEDDED_SIGNUP") return;
        const d = msg.data ?? {};
        if (typeof d.waba_id === "string") sessao.current.waba_id = d.waba_id;
        if (typeof d.phone_number_id === "string") sessao.current.phone_number_id = d.phone_number_id;
      } catch {
        // mensagem de outra coisa do facebook.com — não é nossa
      }
    };
    window.addEventListener("message", ouvir);

    try {
      const fb = await carregarSdk(appId, cfg!.graph_version);
      fb.login(
        (r) => {
          const code = r.authResponse?.code;
          // A mensagem da janela pode chegar um instante depois do retorno.
          window.setTimeout(() => {
            window.removeEventListener("message", ouvir);
            void concluir(code ?? null);
          }, 1500);
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
        },
      );
    } catch {
      window.removeEventListener("message", ouvir);
      setEtapa("parado");
      toast.error(t("Não foi possível abrir a janela da Meta. Confira se o navegador não bloqueou pop-ups."));
    }
  }

  async function concluir(code: string | null) {
    const wabaId = sessao.current.waba_id;
    if (!code || !wabaId) {
      setEtapa("parado");
      toast.error(t("A conexão não foi concluída na janela da Meta. Nada foi alterado."));
      return;
    }
    setEtapa("concluindo");
    try {
      const r = await apiClient.post<{ data: RespostaDaConexao }>("/api/v1/channels/official/coexistencia", {
        code,
        waba_id: wabaId,
        phone_number_id: sessao.current.phone_number_id ?? null,
      });
      setResultado(r.data);
      toast.success(`${t("Conectado:")} ${r.data.displayName} ${r.data.phoneNumber ?? ""}`.trim());
      void qc.invalidateQueries({ queryKey: ["official-channel"] });
    } catch (err) {
      showApiError(err);
    } finally {
      setEtapa("parado");
    }
  }

  return (
    <Card className="p-4" data-testid="coexistencia">
      <h2 className="font-medium">{t("Conectar com o app WhatsApp Business")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(
          "O número continua funcionando no celular. Você escaneia um QR com o app WhatsApp Business e autoriza o compartilhamento das conversas — o CRM recebe os contatos e até 6 meses de histórico.",
        )}
      </p>
      <Button
        className="mt-3"
        onClick={() => void abrir()}
        disabled={etapa !== "parado"}
        data-testid="btn-coexistencia"
      >
        {etapa === "janela"
          ? t("Aguardando a janela da Meta…")
          : etapa === "concluindo"
            ? t("Concluindo a conexão…")
            : t("Conectar com o app WhatsApp Business")}
      </Button>
      {resultado ? (
        <ul className="mt-3 text-sm" data-testid="coexistencia-resultado">
          <li>
            {t("Contatos:")}{" "}
            {resultado.sincronizacao.contatos.pedido
              ? t("pedido enviado à Meta")
              : `${t("não pedido")} — ${resultado.sincronizacao.contatos.erro ?? ""}`}
          </li>
          <li>
            {t("Histórico:")}{" "}
            {resultado.sincronizacao.historico.pedido
              ? t("pedido enviado à Meta — as conversas chegam aos poucos")
              : `${t("não pedido")} — ${resultado.sincronizacao.historico.erro ?? ""}`}
          </li>
        </ul>
      ) : null}
    </Card>
  );
}
