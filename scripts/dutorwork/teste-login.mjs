// DutorWork — teste de login no Sankhya a partir do GitHub Actions.
// Só responde: o login passou? Não tira print nem escreve dados de cliente no
// log, porque o repositório é público. Ver .github/workflows/dutorwork-teste-login.yml
import { chromium } from "playwright";

const URL = process.env.SANKHYA_URL;
const USUARIO = process.env.SANKHYA_USUARIO;
const SENHA = process.env.SANKHYA_SENHA;

function relato(chave, valor) {
  process.stdout.write(`[dutorwork] ${chave}: ${valor}\n`);
}

const browser = await chromium.launch();
const page = await browser.newPage({
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
  // O Sankhya recusa tela menor que 1024x768; o padrão do Playwright (1280x720) fica abaixo.
  viewport: { width: 1536, height: 864 },
});
let ok = false;

try {
  const resp = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  relato("tela de login respondeu", resp ? resp.status() : "sem resposta");

  const senhaVisivel = page.locator('input[type="password"]:visible');
  const usuario = page.locator('input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):visible').first();
  const prosseguir = page.getByRole("button", { name: /prosseguir|entrar|login/i }).first();

  await Promise.race([
    senhaVisivel.first().waitFor({ timeout: 45000 }),
    usuario.waitFor({ timeout: 45000 }),
  ]);

  // Passo 1: usuário (a tela do Sankhya pede o usuário antes da senha).
  if (!(await senhaVisivel.count())) {
    await usuario.fill(USUARIO);
    await prosseguir.click();
    await senhaVisivel.first().waitFor({ timeout: 30000 });
  }
  relato("campo de senha apareceu", "sim");

  // Passo 2: senha.
  await senhaVisivel.first().fill(SENHA);
  await prosseguir.click();

  await page.waitForURL(/system\.jsp/, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);

  const caminho = new globalThis.URL(page.url()).pathname;
  ok = caminho.includes("system.jsp");
  relato("página depois do login", caminho);
  relato("título", await page.title());

  if (ok) {
    const texto = (await page.locator("body").innerText().catch(() => "")) || "";
    relato("aba Painel do Vendedor visível", /painel do vendedor/i.test(texto) ? "sim" : "não");
  } else {
    // Ainda na tela de login: o aviso dali (senha errada, acesso bloqueado)
    // não traz dado de cliente, então pode ir para o log, curto.
    const textos = [];
    for (const f of page.frames()) textos.push(await f.locator("body").innerText().catch(() => ""));
    const aviso = textos.join(" | ").replace(/\s+/g, " ").slice(0, 400);
    relato("aviso na tela de login", aviso || "(nenhum texto)");
  }
} catch (erro) {
  relato("erro", String(erro && erro.message ? erro.message : erro).split("\n")[0].slice(0, 300));
} finally {
  await browser.close();
}

relato("RESULTADO", ok ? "LOGIN OK — o Sankhya aceitou o acesso pelo GitHub" : "LOGIN NÃO PASSOU");
process.exit(ok ? 0 : 1);
