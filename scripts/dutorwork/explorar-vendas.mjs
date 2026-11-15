// DutorWork — RETRATO da tela de Vendas, para escrever o leitor de pedidos.
// Guarda HTML, texto e imagem de cada passo numa pasta que o workflow
// CRIPTOGRAFA com a chave pública antes de publicar. No log só vai sim/não.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { abrirAbaPainel, abrirNavegador, entrar, framePainel, relato, textoDoFrame } from "./sankhya.mjs";

const SAIDA = process.env.SAIDA || "retrato";
mkdirSync(SAIDA, { recursive: true });

async function guardar(page, nome) {
  await page.screenshot({ path: `${SAIDA}/${nome}.png`, fullPage: true }).catch(() => {});
  let i = 0;
  for (const f of page.frames()) {
    const html = await f.content().catch(() => "");
    const texto = await textoDoFrame(f);
    const url = f.url().split("?")[0];
    writeFileSync(`${SAIDA}/${nome}-frame${i}.html`, `<!-- ${url} -->\n${html}`);
    writeFileSync(`${SAIDA}/${nome}-frame${i}.txt`, `${url}\n${texto}`);
    i++;
  }
  relato(`retrato ${nome}`, `${i} frames`);
}

async function clicarSeVisivel(alvo, nome) {
  const ok = await alvo.first().isVisible().catch(() => false);
  if (ok) await alvo.first().click().catch(() => {});
  relato(`clique ${nome}`, ok ? "sim" : "não visível");
  return ok;
}

const { browser, page } = await abrirNavegador(chromium);
let ok = false;
try {
  ok = await entrar(page, {
    url: process.env.SANKHYA_URL,
    usuario: process.env.SANKHYA_USUARIO,
    senha: process.env.SANKHYA_SENHA,
  });
  if (ok) {
    await guardar(page, "01-depois-do-login");
    await abrirAbaPainel(page);
    const painel = await framePainel(page, 90000);
    relato("painel encontrado", painel ? "sim" : "não");
    await guardar(page, "02-painel");
    if (painel) {
      await clicarSeVisivel(painel.getByText(/^\s*vendas\s*$/i), "menu Vendas");
      await page.waitForTimeout(4000);
      await clicarSeVisivel(painel.getByText(/^\s*pular\s*$/i), "pular tour");
      await guardar(page, "03-vendas-faturamento-hoje");
      await clicarSeVisivel(painel.getByText(/^\s*pedidos\s*$/i), "visão Pedidos");
      await clicarSeVisivel(painel.getByText(/^\s*7 dias\s*$/i), "período 7 dias");
      await page.waitForTimeout(5000);
      await guardar(page, "04-vendas-pedidos-7dias");
      // Abre o primeiro pedido da lista, para ver como é o detalhe.
      const primeiro = painel.locator("text=/^#\\d{5,}/").first();
      await clicarSeVisivel(primeiro, "primeiro pedido");
      await page.waitForTimeout(4000);
      await guardar(page, "05-detalhe-do-pedido");
    }
  }
} catch (erro) {
  relato("erro", String(erro?.message ?? erro).split("\n")[0].slice(0, 300));
} finally {
  await browser.close();
}
relato("RESULTADO", ok ? "retrato feito" : "login não passou");
process.exit(ok ? 0 : 1);
