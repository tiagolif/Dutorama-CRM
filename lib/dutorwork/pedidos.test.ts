import { describe, expect, it } from "vitest";

import { linhaDoPedido, loteDePedidosSchema, separarPorDetalhe } from "./pedidos";

const pedido = {
  nunota: 953507,
  status_sankhya: "PENDENTE",
  faturado: false,
  data_pedido: "2026-11-14",
  data_entrega: "2026-11-14",
  cliente_nome: "CLIENTE DE TESTE",
  cliente_codigo: 123,
  top: "PV - SAI LOJA - CLIENTE RETIRA",
  observacao: "SAI LOJA 408 CLIENTE RETIRA",
  itens: [
    {
      descricao: "PRODUTO DE TESTE",
      marca: "MARCA",
      codigo_produto: 317800,
      unidade: "UN",
      quantidade: 1,
      valor_unitario_cents: 229900,
      valor_total_cents: 229900,
    },
  ],
  total_produtos_cents: 229900,
  frete_cents: 0,
  total_cents: 229900,
  detalhe_lido: true,
};
const lote = { lido_em: "2026-11-15T00:00:00.000Z", periodo: "7dias", pedidos: [pedido] };

describe("dutorwork — lote do robô", () => {
  it("aceita o formato que o robô monta", () => {
    expect(loteDePedidosSchema.safeParse(lote).success).toBe(true);
  });

  it("recusa nunota zero, data fora do formato e período desconhecido", () => {
    expect(loteDePedidosSchema.safeParse({ ...lote, pedidos: [{ ...pedido, nunota: 0 }] }).success).toBe(false);
    expect(loteDePedidosSchema.safeParse({ ...lote, pedidos: [{ ...pedido, data_pedido: "14/11/2026" }] }).success).toBe(false);
    expect(loteDePedidosSchema.safeParse({ ...lote, periodo: "ano" }).success).toBe(false);
  });

  it("a linha do upsert nunca leva a situação do checklist", () => {
    const linha = linhaDoPedido("00000000-0000-4000-8000-000000000000", pedido, lote.lido_em);
    expect(linha).not.toHaveProperty("situacao");
    expect(linha.organization_id).toBe("00000000-0000-4000-8000-000000000000");
    expect(linha.total_cents).toBe(229900);
  });

  it("separa quem veio sem detalhe, para não apagar itens já lidos", () => {
    const { completos, resumidos } = separarPorDetalhe([pedido, { ...pedido, nunota: 2, detalhe_lido: false, itens: [] }]);
    expect(completos.map((p) => p.nunota)).toEqual([953507]);
    expect(resumidos.map((p) => p.nunota)).toEqual([2]);
  });
});
