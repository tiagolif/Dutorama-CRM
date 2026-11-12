/**
 * Dutorama na Vercel: completa `process.env` com o que a integração
 * Supabase ↔ Vercel não entrega, para ninguém precisar digitar segredo.
 *
 * - `SUPABASE_DB_URL` ← `POSTGRES_URL` (pooler de transações, criado pela integração).
 * - `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_ADMIN_URL` ← domínio de produção da Vercel.
 * - Chaves internas (INTERNAL_SECRET, AI_CRED_AES_KEY, …) ← HMAC-SHA256 da
 *   `SUPABASE_SERVICE_ROLE_KEY` com um rótulo por chave. São estáveis enquanto a
 *   service role não for rotacionada. ATENÇÃO: rotacionar a service role muda
 *   AI_CRED_AES_KEY e torna ilegíveis as credenciais de IA já salvas — antes de
 *   rotacionar, defina as chaves explicitamente nas variáveis da Vercel.
 *
 * Só preenche o que está VAZIO: variável definida explicitamente sempre vence.
 * Fora da Vercel (sem `VERCEL`) não faz nada. A chave do CPF que vale para a
 * cifra mora no banco (`private.app_secrets.cpf_key`); a do ambiente só passa
 * pela validação do boot.
 */
import { createHmac } from "node:crypto";

const vazio = (nome: string) => !process.env[nome] || process.env[nome]!.trim() === "";

export function preencherVariaveisDerivadas(): void {
  if (!process.env.VERCEL) return;

  if (vazio("SUPABASE_DB_URL") && !vazio("POSTGRES_URL")) {
    process.env.SUPABASE_DB_URL = process.env.POSTGRES_URL;
  }

  if (vazio("NEXT_PUBLIC_SUPABASE_URL") && !vazio("SUPABASE_URL")) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
  }
  if (vazio("NEXT_PUBLIC_SUPABASE_ANON_KEY") && !vazio("SUPABASE_ANON_KEY")) {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  }

  const dominio = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (dominio) {
    for (const nome of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_ADMIN_URL"]) {
      if (vazio(nome)) process.env[nome] = `https://${dominio}`;
    }
  }
  if (vazio("APP_NAME")) process.env.APP_NAME = "Dutorama CRM";

  const raiz = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!raiz) return;
  const derivar = (rotulo: string) => createHmac("sha256", raiz).update(`dutorama:${rotulo}`).digest();

  const hex = ["INTERNAL_SECRET", "IMPERSONATE_COOKIE_SECRET", "LGPD_SIGNING_KEY", "NUVEMSHOP_OAUTH_ENCRYPTION_KEY"];
  const base64 = ["AI_CRED_AES_KEY", "CPF_ENCRYPTION_KEY", "WAHA_BYO_ENCRYPTION_KEY"];
  for (const nome of hex) if (vazio(nome)) process.env[nome] = derivar(nome).toString("hex");
  for (const nome of base64) if (vazio(nome)) process.env[nome] = derivar(nome).toString("base64");
}
