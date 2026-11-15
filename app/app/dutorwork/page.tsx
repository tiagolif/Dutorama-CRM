import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

import { PedidosDoSankhya, type PedidoDaTela } from "./_client";

export const dynamic = "force-dynamic";

/**
 * DUTORWORK — os pedidos do Sankhya que o robô trouxe.
 *
 * O robô (GitHub Actions) lê o Painel do Vendedor e grava em
 * `dutorwork_pedidos`; esta tela mostra o que chegou e deixa conferir cada
 * pedido (Confirmar / Ignorar). "Checar" pede uma leitura nova. A leitura é
 * pela sessão do usuário: a RLS da tabela só entrega a própria organização.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);

  const { data } = await (await createClient())
    .from("dutorwork_pedidos")
    .select(
      "id, nunota, faturado, data_pedido, data_entrega, cliente_nome, cliente_codigo, top, observacao, itens, total_produtos_cents, frete_cents, total_cents, situacao, lido_em",
    )
    .eq("organization_id", org.orgId)
    .order("data_pedido", { ascending: false })
    .order("nunota", { ascending: false })
    .limit(200);

  const pedidos = (data ?? []) as PedidoDaTela[];
  const ultimaLeitura = pedidos.reduce<string | null>(
    (max, p) => (!max || p.lido_em > max ? p.lido_em : max),
    null,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Pedidos do Sankhya")}</h1>
        <p className="text-sm text-text-muted">
          {t("O que o robô trouxe do Painel do Vendedor, para conferir antes de falar com o cliente.")}
        </p>
      </div>
      <PedidosDoSankhya
        pedidos={pedidos}
        ultimaLeitura={ultimaLeitura}
        podeAgir={ROLE_RANK[org.role] >= ROLE_RANK.agent}
      />
    </div>
  );
}
