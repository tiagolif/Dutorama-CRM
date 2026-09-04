import type { Provider } from "@/lib/ai/provider-validators";

export const PROVEDORES_DO_COPILOT = ["openai", "google"] as const;
export type ProvedorDoCopilot = (typeof PROVEDORES_DO_COPILOT)[number];

export interface CredencialDoCopilot {
  id: string;
  provider: string;
  models_available: unknown;
  created_at: string;
}

export interface OpcaoDoCopilot {
  provider: ProvedorDoCopilot;
  rotulo: string;
  model: string;
  credentialId: string;
}

const PREFERIDOS: Record<ProvedorDoCopilot, readonly string[]> = {
  openai: ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"],
  google: ["gemini-2.5-flash", "gemini-flash-latest"],
};

const ROTULOS: Record<ProvedorDoCopilot, string> = {
  openai: "GPT",
  google: "Gemini",
};

function ehModeloDeChat(provider: ProvedorDoCopilot, model: string): boolean {
  const id = model.toLowerCase();
  if (provider === "openai") {
    return (
      /^(gpt-|chatgpt-|o[134](?:-|$))/.test(id) &&
      !/(audio|realtime|transcribe|tts|image|embedding|search)/.test(id)
    );
  }
  return (
    id.startsWith("gemini-") && !/(embedding|image|live|audio|tts|transcribe|computer-use)/.test(id)
  );
}

export function escolherModeloDoCopilot(
  provider: ProvedorDoCopilot,
  modelsAvailable: unknown,
): string | null {
  if (!Array.isArray(modelsAvailable)) return null;
  const modelos = modelsAvailable.filter(
    (model): model is string => typeof model === "string" && model.trim().length > 0,
  );
  const preferido = PREFERIDOS[provider].find((model) => modelos.includes(model));
  if (preferido) return preferido;
  return modelos.find((model) => ehModeloDeChat(provider, model)) ?? null;
}

/**
 * Uma opção por provedor: a credencial validada mais nova ganha, igual ao
 * resolvedor do runtime. O id fica só no servidor e nunca é enviado ao browser.
 */
export function montarOpcoesDoCopilot(
  credenciais: readonly CredencialDoCopilot[],
): OpcaoDoCopilot[] {
  const opcoes: OpcaoDoCopilot[] = [];
  for (const provider of PROVEDORES_DO_COPILOT) {
    const credencial = credenciais.find((item) => item.provider === provider);
    if (!credencial) continue;
    const model = escolherModeloDoCopilot(provider, credencial.models_available);
    if (!model) continue;
    opcoes.push({
      provider,
      rotulo: ROTULOS[provider],
      model,
      credentialId: credencial.id,
    });
  }
  return opcoes;
}

export function ehProvedorDoCopilot(provider: string): provider is ProvedorDoCopilot {
  return (PROVEDORES_DO_COPILOT as readonly string[]).includes(provider);
}

// Garante que os ids do painel também continuam sendo providers suportados.
const _provedoresSuportados: readonly Provider[] = PROVEDORES_DO_COPILOT;
void _provedoresSuportados;
