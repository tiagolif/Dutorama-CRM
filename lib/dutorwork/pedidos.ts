/**
 * DutorWork — contrato dos pedidos que o robô do Sankhya entrega.
 *
 * O robô (`scripts/dutorwork/ler-pedidos.mjs`) monta este formato; a rota
 * `POST /api/v1/webhooks/dutorwork/pedidos` valida com `loteDePedidosSchema` e
 * grava em `dutorwork_pedidos` com `linhaDoPedido`. Dinheiro em centavos.
 */
import { z } from "zod";

const centavos = z.number().int().nullable();
const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const itemDoPedidoSchema = z.object({
  descricao: z.string().max(500),
  marca: z.string().max(200).nullable(),
  codigo_produto: z.number().int().nullable(),
  unidade: z.string().max(20).nullable(),
  quantidade: z.number().nullable(),
  valor_unitario_cents: centavos,
  valor_total_cents: centavos,
});

export const pedidoDoRoboSchema = z.object({
  nunota: z.number().int().positive(),
  status_sankhya: z.string().max(50).nullable(),
  faturado: z.boolean(),
  data_pedido: dataIso,
  data_entrega: dataIso,
  cliente_nome: z.string().min(1).max(300),
  cliente_codigo: z.number().int().nullable(),
  top: z.string().max(300).nullable(),
  observacao: z.string().max(5000).nullable(),
  itens: z.array(itemDoPedidoSchema).max(200),
  total_produtos_cents: centavos,
  frete_cents: centavos,
  total_cents: centavos,
  detalhe_lido: z.boolean(),
});

export const loteDePedidosSchema = z.object({
  lido_em: z.string().datetime(),
  periodo: z.enum(["hoje", "7dias", "mes"]),
  pedidos: z.array(pedidoDoRoboSchema).max(500),
});

export type PedidoDoRobo = z.infer<typeof pedidoDoRoboSchema>;
export type LoteDePedidos = z.infer<typeof loteDePedidosSchema>;

/**
 * Linha de `dutorwork_pedidos` para o upsert. NÃO inclui `situacao`: reler o
 * pedido atualiza os dados do Sankhya e preserva a decisão de quem confere.
 */
export function linhaDoPedido(organizationId: string, p: PedidoDoRobo, lidoEm: string) {
  return {
    organization_id: organizationId,
    nunota: p.nunota,
    status_sankhya: p.status_sankhya,
    faturado: p.faturado,
    data_pedido: p.data_pedido,
    data_entrega: p.data_entrega,
    cliente_nome: p.cliente_nome,
    cliente_codigo: p.cliente_codigo,
    top: p.top,
    observacao: p.observacao,
    itens: p.itens,
    total_produtos_cents: p.total_produtos_cents,
    frete_cents: p.frete_cents,
    total_cents: p.total_cents,
    lido_em: lidoEm,
  };
}

/**
 * Pedido sem detalhe (o robô não conseguiu abrir) não apaga o que já foi lido:
 * só entra se ainda não existe. Devolve os dois grupos.
 */
export function separarPorDetalhe(pedidos: readonly PedidoDoRobo[]) {
  return {
    completos: pedidos.filter((p) => p.detalhe_lido),
    resumidos: pedidos.filter((p) => !p.detalhe_lido),
  };
}
