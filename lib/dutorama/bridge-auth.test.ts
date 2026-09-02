import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const original = process.env.DUTORAMA_BRIDGE_TOKEN;

function request(authorization?: string): NextRequest {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return { headers } as NextRequest;
}

async function authorize(authorization?: string): Promise<boolean> {
  vi.resetModules();
  const { authorizeDutoramaBridge } = await import("./bridge-auth");
  return authorizeDutoramaBridge(request(authorization));
}

describe("authorizeDutoramaBridge", () => {
  afterEach(() => {
    if (original === undefined) delete process.env.DUTORAMA_BRIDGE_TOKEN;
    else process.env.DUTORAMA_BRIDGE_TOKEN = original;
    vi.resetModules();
  });

  it("fica desligada quando o token não está configurado", async () => {
    delete process.env.DUTORAMA_BRIDGE_TOKEN;
    await expect(authorize("Bearer qualquer-token")).resolves.toBe(false);
  });

  it("recusa header ausente, esquema incorreto e segredo diferente", async () => {
    process.env.DUTORAMA_BRIDGE_TOKEN = "segredo-correto";
    await expect(authorize()).resolves.toBe(false);
    await expect(authorize("Basic segredo-correto")).resolves.toBe(false);
    await expect(authorize("Bearer segredo-errado")).resolves.toBe(false);
  });

  it("aceita somente o bearer exato", async () => {
    process.env.DUTORAMA_BRIDGE_TOKEN = "segredo-correto";
    await expect(authorize("Bearer segredo-correto")).resolves.toBe(true);
  });
});
