"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { formatCents } from "@/lib/money";

export interface ItemDoPedido {
  descricao: string;
  marca: string | null;
  codigo_produto: number | null;
  unidade: string | null;
  quantidade: number | null;
  valor_unitario_cents: number | null;
  valor_total_cents: number | null;
}

export interface PedidoDaTela {
  id: string;
  nunota: number;
  faturado: boolean;
  data_pedido: string | null;
  data_entrega: string | null;
  cliente_nome: string;
  cliente_codigo: number | null;
  top: string | null;
  observacao: string | null;
  itens: ItemDoPedido[];
  total_produtos_cents: number | null;
  frete_cents: number | null;
  total_cents: number | null;
  situacao: "novo" | "confirmado" | "enviado" | "ignorado";
  lido_em: string;
}

type Filtro = "novo" | "confirmado" | "ignorado" | "todos";

// Quanto tempo a tela espera o robô depois de "Checar" (ele leva de 1 a 4 min).
const ESPERA_DO_ROBO_MS = 6 * 60 * 1000;
const INTERVALO_DE_RECARGA_MS = 20 * 1000;

function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function brl(cents: number | null): string {
  return cents == null ? "—" : formatCents(cents, "BRL");
}

/** O que merece atenção antes de falar com o cliente. */
function avisosDoPedido(p: PedidoDaTela): string[] {
  const avisos: string[] = [];
  const somaItens = p.itens.reduce((s, i) => s + (i.valor_total_cents ?? 0), 0);
  if (p.itens.length && p.total_produtos_cents != null && somaItens !== p.total_produtos_cents) {
    avisos.push(
      `Itens somam ${brl(somaItens)}, mas o total de produtos é ${brl(p.total_produtos_cents)} (desconto ou acréscimo?)`,
    );
  }
  if (!p.data_entrega) avisos.push("Sem data de entrega");
  if (/ENTREGA/i.test(p.top ?? "") && (p.frete_cents ?? 0) === 0) avisos.push("Entrega pela logística sem frete");
  return avisos;
}

export function PedidosDoSankhya({
  pedidos,
  ultimaLeitura,
  podeAgir,
}: {
  pedidos: PedidoDaTela[];
  ultimaLeitura: string | null;
  podeAgir: boolean;
}) {
  const t = useT();
  const tagDeIdioma = useTagDeIdioma();
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("novo");
  const [aberto, setAberto] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [checandoAte, setChecandoAte] = useState<number | null>(null);
  const leituraNoInicio = useRef(ultimaLeitura);

  // Depois de "Checar", recarrega de tempos em tempos até a leitura nova chegar.
  useEffect(() => {
    if (!checandoAte) return;
    if (ultimaLeitura && ultimaLeitura !== leituraNoInicio.current) {
      setChecandoAte(null);
      return;
    }
    const id = setInterval(() => {
      if (Date.now() > checandoAte) setChecandoAte(null);
      else router.refresh();
    }, INTERVALO_DE_RECARGA_MS);
    return () => clearInterval(id);
  }, [checandoAte, ultimaLeitura, router]);

  const contagem = useMemo(() => {
    const c = { novo: 0, confirmado: 0, ignorado: 0, todos: pedidos.length };
    for (const p of pedidos) if (p.situacao in c) c[p.situacao as "novo" | "confirmado" | "ignorado"]++;
    return c;
  }, [pedidos]);
  const visiveis = filtro === "todos" ? pedidos : pedidos.filter((p) => p.situacao === filtro);

  async function checar() {
    try {
      await apiClient.post("/api/v1/dutorwork/checar", { periodo: "hoje" });
      leituraNoInicio.current = ultimaLeitura;
      setChecandoAte(Date.now() + ESPERA_DO_ROBO_MS);
    } catch (e) {
      showApiError(e);
    }
  }

  async function mudar(p: PedidoDaTela, situacao: "novo" | "confirmado" | "ignorado") {
    setSalvando(p.id);
    try {
      await apiClient.patch(`/api/v1/dutorwork/pedidos/${p.id}`, { situacao });
      router.refresh();
    } catch (e) {
      showApiError(e);
    } finally {
      setSalvando(null);
    }
  }

  const filtros: Array<[Filtro, string]> = [
    ["novo", t("Novos")],
    ["confirmado", t("Confirmados")],
    ["ignorado", t("Ignorados")],
    ["todos", t("Todos")],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="text-sm">
          <div className="font-medium">
            {checandoAte ? t("O robô está lendo o Sankhya…") : t("Última leitura do Sankhya")}
          </div>
          <div className="text-text-muted" data-testid="dutorwork-ultima-leitura">
            {ultimaLeitura ? new Date(ultimaLeitura).toLocaleString(tagDeIdioma) : t("Nenhuma leitura ainda")}
          </div>
        </div>
        {podeAgir ? (
          <Button onClick={checar} disabled={Boolean(checandoAte)} data-testid="dutorwork-checar">
            {checandoAte ? t("Checando…") : t("Checar")}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {filtros.map(([valor, rotulo]) => (
          <Button
            key={valor}
            role="tab"
            aria-selected={filtro === valor}
            variant={filtro === valor ? "default" : "outline"}
            size="sm"
            onClick={() => setFiltro(valor)}
          >
            {rotulo} ({contagem[valor]})
          </Button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <p className="text-sm text-text-muted">{t("Nenhum pedido aqui.")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visiveis.map((p) => {
            const avisos = avisosDoPedido(p);
            const estaAberto = aberto === p.id;
            return (
              <li key={p.id} className="rounded-lg border border-border bg-surface" data-testid="dutorwork-pedido">
                <button
                  type="button"
                  className="flex w-full flex-wrap items-start justify-between gap-2 p-3 text-left"
                  onClick={() => setAberto(estaAberto ? null : p.id)}
                  aria-expanded={estaAberto}
                >
                  <div className="min-w-0">
                    <div className="font-medium">
                      #{p.nunota} · {p.cliente_nome}
                    </div>
                    <div className="text-xs text-text-muted">
                      {t("Pedido")} {dataCurta(p.data_pedido)} · {t("Entrega")} {dataCurta(p.data_entrega)}
                      {p.top ? ` · ${p.top}` : ""}
                    </div>
                    {avisos.length ? (
                      <div className="mt-1 text-xs text-amber-700">⚠ {avisos.length} {t("ponto(s) para conferir")}</div>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{brl(p.total_cents)}</div>
                    <div className="text-xs text-text-muted">{p.faturado ? t("Faturado") : t("Não faturado")}</div>
                  </div>
                </button>

                {estaAberto ? (
                  <div className="flex flex-col gap-3 border-t border-border p-3 text-sm">
                    {avisos.length ? (
                      <ul className="rounded-md bg-amber-50 p-2 text-amber-900">
                        {avisos.map((a) => (
                          <li key={a}>⚠ {a}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div>
                      <div className="text-xs uppercase text-text-muted">{t("Cliente")}</div>
                      <div>
                        {p.cliente_nome}
                        {p.cliente_codigo ? ` · ${t("Cód.")} ${p.cliente_codigo}` : ""}
                      </div>
                    </div>
                    {p.observacao ? (
                      <div>
                        <div className="text-xs uppercase text-text-muted">{t("Observação")}</div>
                        <p className="whitespace-pre-line">{p.observacao}</p>
                      </div>
                    ) : null}
                    <div>
                      <div className="text-xs uppercase text-text-muted">{t("Itens")}</div>
                      <ul className="flex flex-col gap-1">
                        {p.itens.map((i, n) => (
                          <li key={n} className="flex justify-between gap-2">
                            <span>
                              {i.quantidade ?? "?"} × {i.descricao}
                              {i.marca ? <span className="text-text-muted"> · {i.marca}</span> : null}
                            </span>
                            <span className="whitespace-nowrap">{brl(i.valor_total_cents)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex flex-col gap-0.5 border-t border-border pt-2">
                      <div className="flex justify-between">
                        <span>{t("Produtos")}</span>
                        <span>{brl(p.total_produtos_cents)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t("Frete")}</span>
                        <span>{brl(p.frete_cents)}</span>
                      </div>
                      <div className="flex justify-between font-semibold">
                        <span>{t("Total")}</span>
                        <span>{brl(p.total_cents)}</span>
                      </div>
                    </div>
                    {podeAgir && p.situacao !== "enviado" ? (
                      <div className="flex flex-wrap gap-2">
                        {p.situacao !== "confirmado" ? (
                          <Button size="sm" disabled={salvando === p.id} onClick={() => mudar(p, "confirmado")}>
                            {t("Confirmar")}
                          </Button>
                        ) : null}
                        {p.situacao !== "ignorado" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={salvando === p.id}
                            onClick={() => mudar(p, "ignorado")}
                          >
                            {t("Ignorar")}
                          </Button>
                        ) : null}
                        {p.situacao !== "novo" ? (
                          <Button size="sm" variant="ghost" disabled={salvando === p.id} onClick={() => mudar(p, "novo")}>
                            {t("Voltar para novos")}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
