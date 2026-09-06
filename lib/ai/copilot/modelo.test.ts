import { describe, expect, it } from "vitest";

import { escolherModeloDoCopilot, montarOpcoesDoCopilot } from "./modelo";

describe("modelo do assistente geral", () => {
  it("prefere os modelos econômicos de conversa que o provedor confirmou", () => {
    expect(escolherModeloDoCopilot("openai", ["gpt-4o", "gpt-5-mini"])).toBe("gpt-5-mini");
    expect(
      escolherModeloDoCopilot("google", [
        "gemini-3-pro-image-preview",
        "gemini-2.5-flash",
        "gemini-3.6-flash",
      ]),
    ).toBe("gemini-3.6-flash");
  });

  it("não oferece modelo de imagem, áudio ou embedding como chat", () => {
    expect(
      escolherModeloDoCopilot("google", ["gemini-embedding-001", "gemini-3-pro-image-preview"]),
    ).toBeNull();
    expect(
      escolherModeloDoCopilot("openai", ["gpt-image-1", "gpt-4o-realtime-preview"]),
    ).toBeNull();
  });

  it("oferece uma opção por provedor e mantém o id da credencial só no objeto interno", () => {
    const opcoes = montarOpcoesDoCopilot([
      {
        id: "openai-nova",
        provider: "openai",
        models_available: ["gpt-5-mini"],
        created_at: "2026-09-04T12:00:00Z",
      },
      {
        id: "openai-antiga",
        provider: "openai",
        models_available: ["gpt-4o-mini"],
        created_at: "2026-09-03T12:00:00Z",
      },
      {
        id: "google",
        provider: "google",
        models_available: ["gemini-2.5-flash", "gemini-3.6-flash"],
        created_at: "2026-09-04T12:00:00Z",
      },
    ]);

    expect(opcoes).toEqual([
      {
        provider: "openai",
        rotulo: "GPT",
        model: "gpt-5-mini",
        credentialId: "openai-nova",
      },
      {
        provider: "google",
        rotulo: "Gemini",
        model: "gemini-3.6-flash",
        credentialId: "google",
      },
    ]);
  });
});
