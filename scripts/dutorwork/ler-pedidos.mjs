// DutorWork — LEITOR DE PEDIDOS do Painel do Vendedor (somente leitura).
//
// Abre Vendas > Pedidos no período escolhido (PERIODO = hoje | 7dias | mes),
// lê a lista e o detalhe de cada pedido e grava `pedidos.json` na pasta SAIDA,
// que o workflow CRIPTOGRAFA antes de publicar. No log vão só contagens.
//
// ⚠️ Cada linha da lista tem botões de EXCLUIR pedido e MUDAR NEGOCIAÇÃO, e o
// detalhe tem EDITAR OBSERVAÇÃO. O robô clica apenas no número do pedido
// (.pedido-col.nunota) e no botão Fechar (#btnFecharDetalhesPedidoOK).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { abrirAbaPainel, abrirNavegador, entrar, framePainel, relato } from "./sankhya.mjs";

const SAIDA = process.env.SAIDA || "retrato";
const PERIODO = (process.env.PERIODO || "hoje").toLowerCase();
const ROTULO_PERIODO = { hoje: /^\s*hoje\s*$/i, "7dias": /^\s*7 dias\s*$/i, mes: /^\s*m[eê]s\s*$/i }[PERIODO];
const LIMITE_DETALHES = Number(process.env.LIMITE_DETALHES || 40);
mkdirSync(SAIDA, { recursive: true });

// "R$ 2.299,00" -> 229900
function centavos(txt) {
  const m = String(txt || "").replace(/\s/g, "").match(/-?[\d.]+,\d{2}/);
  return m ? Math.round(Number(m[0].replace(/\./g, "").replace(",", ".")) * 100) : null;
}
// "14/11/2026" -> "2026-11-14"
function dataIso(txt) {
  const m = String(txt || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

async function clicarBotao(painel, rotulo, nome) {
  const alvo = painel.getByRole("button", { name: rotulo }).first();
  const ok = await alvo.isVisible().catch(() => false);
  if (ok) await alvo.click();
  relato(`clique ${nome}`, ok ? "sim" : "não visível");
  return ok;
}

async function lerLista(painel) {
  return painel.$$eval(".pedido-row[data-nunota]", (linhas) =>
    linhas.map((l) => {
      const col = (c) => l.querySelector(`.pedido-col.${c}`);
      const cli = col("cliente");
      const small = cli?.querySelector("small")?.textContent?.trim() || "";
      const nome = cli ? [...cli.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim() : "";
      const [codTxt, ...topPartes] = small.split("·").map((s) => s.trim());
      return {
        nunota: l.getAttribute("data-nunota"),
        status_sankhya: l.getAttribute("data-status"),
        status_rotulo: col("status")?.textContent?.trim() || "",
        data: col("data")?.textContent?.trim() || "",
        cliente_nome: nome,
        cliente_codigo: (codTxt || "").replace(/\D/g, ""),
        top: topPartes.join(" · "),
        valor: col("valor")?.textContent?.trim() || "",
      };
    }),
  );
}

async function lerDetalhe(painel, nunota) {
  await painel.locator(`.pedido-row[data-nunota="${nunota}"] .pedido-col.nunota`).click();
  const conteudo = painel.locator("#modalPedConteudo");
  await conteudo.waitFor({ state: "visible", timeout: 20000 });
  // O modal reaproveita os mesmos campos: espera trocar para ESTE pedido.
  await painel
    .waitForFunction((n) => (document.body.innerText || "").includes(`#${n}`), nunota, { timeout: 20000 })
    .catch(() => {});
  await painel.waitForTimeout(800);
  const d = await painel.evaluate(() => {
    const t = (id) => document.getElementById(id)?.textContent?.trim() || "";
    const itens = [...document.querySelectorAll("#modalPedItens .modal-ped-item")].map((it) => ({
      descricao: it.querySelector(".ped-it-info strong")?.textContent?.trim() || "",
      marca: it.querySelector(".ped-it-marca")?.textContent?.trim() || "",
      linha: it.querySelector(".ped-it-cod")?.textContent?.replace(/ /g, " ").trim() || "",
      valor: it.querySelector(".ped-it-valor")?.textContent?.trim() || "",
    }));
    return {
      cliente: t("modalPedCliente"),
      codparc: t("modalPedCodParc"),
      top: t("modalPedTop"),
      data_pedido: t("modalPedData"),
      data_entrega: t("modalPedDtEntrega"),
      observacao: document.getElementById("modalPedObs")?.innerText?.trim() || "",
      itens,
      total_produtos: t("modalPedTotProd"),
      frete: t("modalPedTotFrete"),
      total: t("modalPedTotGeral"),
    };
  });
  await painel.locator("#btnFecharDetalhesPedidoOK").click();
  await conteudo.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  return d;
}

function montarPedido(linha, d) {
  return {
    nunota: Number(linha.nunota),
    status_sankhya: linha.status_sankhya,
    faturado: /^faturado$/i.test(linha.status_rotulo),
    data_pedido: dataIso(d?.data_pedido || linha.data),
    data_entrega: dataIso(d?.data_entrega),
    cliente_nome: d?.cliente || linha.cliente_nome,
    cliente_codigo: Number((d?.codparc || linha.cliente_codigo).replace(/\D/g, "")) || null,
    top: d?.top || linha.top,
    observacao: d?.observacao ?? null,
    itens: (d?.itens || []).map((it) => {
      const m = it.linha.match(/C[óo]d\.\s*(\d+)\s*·\s*([^·]+?)\s*·\s*([\d.,]+)\s*×\s*(R\$\s*[\d.,]+)/);
      return {
        descricao: it.descricao,
        marca: it.marca || null,
        codigo_produto: m ? Number(m[1]) : null,
        unidade: m ? m[2].trim() : null,
        quantidade: m ? Number(m[3].replace(/\./g, "").replace(",", ".")) : null,
        valor_unitario_cents: m ? centavos(m[4]) : null,
        valor_total_cents: centavos(it.valor),
      };
    }),
    total_produtos_cents: centavos(d?.total_produtos),
    frete_cents: centavos(d?.frete),
    total_cents: centavos(d?.total) ?? centavos(linha.valor),
    detalhe_lido: Boolean(d),
  };
}

const { browser, page } = await abrirNavegador(chromium);
let ok = false;
try {
  if (!ROTULO_PERIODO) throw new Error(`PERIODO inválido: ${PERIODO}`);
  const logou = await entrar(page, {
    url: process.env.SANKHYA_URL,
    usuario: process.env.SANKHYA_USUARIO,
    senha: process.env.SANKHYA_SENHA,
  });
  if (logou) {
    await abrirAbaPainel(page);
    const painel = await framePainel(page, 90000);
    if (!painel) throw new Error("painel do vendedor não carregou");

    await painel.getByText(/^\s*vendas\s*$/i).first().click();
    await page.waitForTimeout(3000);
    const pular = painel.getByText(/^\s*pular\s*$/i).first();
    if (await pular.isVisible().catch(() => false)) await pular.click();
    await clicarBotao(painel, /^\s*pedidos\s*$/i, "visão Pedidos");
    await clicarBotao(painel, ROTULO_PERIODO, `período ${PERIODO}`);
    await page.waitForTimeout(5000);

    const lista = await lerLista(painel);
    relato("pedidos na lista", lista.length);

    const pedidos = [];
    let detalhes = 0;
    for (const linha of lista) {
      let d = null;
      if (detalhes < LIMITE_DETALHES) {
        d = await lerDetalhe(painel, linha.nunota).catch((e) => {
          relato("detalhe falhou", String(e?.message ?? e).split("\n")[0].slice(0, 120));
          return null;
        });
        if (d) detalhes++;
      }
      pedidos.push(montarPedido(linha, d));
    }
    relato("detalhes lidos", detalhes);
    writeFileSync(
      `${SAIDA}/pedidos.json`,
      JSON.stringify({ lido_em: new Date().toISOString(), periodo: PERIODO, pedidos }, null, 2),
    );
    ok = true;
  }
} catch (erro) {
  relato("erro", String(erro?.message ?? erro).split("\n")[0].slice(0, 300));
} finally {
  await browser.close();
}
relato("RESULTADO", ok ? "pedidos lidos" : "leitura não concluída");
process.exit(ok ? 0 : 1);
