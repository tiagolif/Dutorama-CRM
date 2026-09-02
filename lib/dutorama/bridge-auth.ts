import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Autenticação da ponte administrativa do Dutorama.
 *
 * A ponte fica DESLIGADA quando DUTORAMA_BRIDGE_TOKEN não existe. O segredo
 * nunca deve ser versionado; ele vive apenas no ambiente da instalação.
 */
export function authorizeDutoramaBridge(req: NextRequest): boolean {
  const expected = process.env.DUTORAMA_BRIDGE_TOKEN?.trim();
  if (!expected) return false;

  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const supplied = match?.[1]?.trim();
  if (!supplied) return false;

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied, "utf8");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
