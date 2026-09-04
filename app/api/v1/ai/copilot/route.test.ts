import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { runModelCall } from "@/lib/agent-engine/edge/llm/run-model-call";
import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: vi.fn(() => ({})) }));
vi.mock("@/lib/agent-engine/edge/llm/run-model-call", () => ({
  llmEdgeConfigFromEnv: vi.fn(() => ({})),
  runModelCall: vi.fn(),
  normalizarErro: vi.fn(() => ({ error_code: "erro_desconhecido" })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: {} }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function autenticar() {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: {
      id: USER_ID,
      email: "pessoa@example.com",
      full_name: null,
      avatar_url: null,
      is_platform_admin: false,
      idioma: "pt-BR",
      organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "viewer" }],
    },
    org: { orgId: ORG_ID, name: "Org", role: "viewer" },
  });
}

function credenciais() {
  const linhas = [
    {
      id: "33333333-3333-4333-8333-333333333333",
      provider: "openai",
      models_available: ["gpt-5-mini"],
      created_at: "2026-09-04T12:00:00Z",
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      provider: "google",
      models_available: ["gemini-2.5-flash"],
      created_at: "2026-09-04T12:00:00Z",
    },
  ];
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    then: (resolve: (value: { data: typeof linhas; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: linhas, error: null })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.not.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockReturnValue(query);
  vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => query) } as never);
}

function post(body: unknown) {
  return new NextRequest("http://localhost/api/v1/ai/copilot", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  autenticar();
  credenciais();
});

describe("assistente geral", () => {
  it("GET expõe somente provedor, rótulo e modelo — nunca id ou segredo", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      { provider: "openai", rotulo: "GPT", model: "gpt-5-mini" },
      { provider: "google", rotulo: "Gemini", model: "gemini-2.5-flash" },
    ]);
    expect(JSON.stringify(body)).not.toContain("33333333-3333-4333-8333-333333333333");
  });

  it("POST respeita o Gemini escolhido e não entrega ferramentas ao modelo", async () => {
    vi.mocked(runModelCall).mockResolvedValue({
      result: { text: "Resposta do Gemini" },
      callId: "55555555-5555-4555-8555-555555555555",
      provider: "google",
      model: "gemini-2.5-flash",
      usage: { inputTokens: 4, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costCents: 0,
      latencyMs: 10,
      origem: "herdado_de_quem_chamou",
      avisos: [],
    } as never);

    const { POST } = await import("./route");
    const res = await POST(post({ provider: "google", message: "Resuma isto", history: [] }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.answer).toBe("Resposta do Gemini");

    const [, , input] = vi.mocked(runModelCall).mock.calls[0]!;
    expect(input).toMatchObject({
      tenantId: ORG_ID,
      purpose: "general_copilot",
      model: "gemini-2.5-flash",
      maxSteps: 1,
      llmOverride: {
        provider: "google",
        credentialId: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(input.tools).toBeUndefined();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.general_copilot_asked",
        organizationId: ORG_ID,
        metadata: { provider: "google", model: "gemini-2.5-flash" },
      }),
    );
  });

  it("recusa provedor fora de GPT e Gemini antes de chamar uma IA", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ provider: "anthropic", message: "Oi", history: [] }));
    expect(res.status).toBe(422);
    expect(runModelCall).not.toHaveBeenCalled();
  });

  it("sem autenticação repassa a resposta do guard", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("unauthenticated", "Auth required.", 401),
    });
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(401);
  });
});
