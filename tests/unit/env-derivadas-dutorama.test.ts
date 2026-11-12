import { describe, it, expect } from "vitest";
import { preencherVariaveisDerivadas } from "@/lib/env-derivadas";
describe("env derivadas", () => {
  it("deriva estável e respeita explícitas", () => {
    process.env.VERCEL = "1"; process.env.SUPABASE_SERVICE_ROLE_KEY = "abc"; process.env.POSTGRES_URL = "postgres://x";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "dutorama-crm.vercel.app"; process.env.INTERNAL_SECRET = "fixo";
    delete process.env.AI_CRED_AES_KEY; delete process.env.SUPABASE_DB_URL; delete process.env.NEXT_PUBLIC_APP_URL;
    preencherVariaveisDerivadas();
    expect(process.env.INTERNAL_SECRET).toBe("fixo");
    expect(Buffer.from(process.env.AI_CRED_AES_KEY!, "base64").length).toBe(32);
    expect(process.env.SUPABASE_DB_URL).toBe("postgres://x");
    expect(process.env.NEXT_PUBLIC_APP_URL).toBe("https://dutorama-crm.vercel.app");
    const a = process.env.AI_CRED_AES_KEY; delete process.env.AI_CRED_AES_KEY; preencherVariaveisDerivadas();
    expect(process.env.AI_CRED_AES_KEY).toBe(a);
  });
});
