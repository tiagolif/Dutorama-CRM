// DutorWork — teste de login no Sankhya a partir do GitHub Actions.
// Só responde: o login passou? Não tira print nem escreve dados de cliente no
// log, porque o repositório é público. Ver .github/workflows/dutorwork-teste-login.yml
import { chromium } from "playwright";

const URL = process.env.SANKHYA_URL;
const USUARIO = process.env.SANKHYA_USUARIO;
const SENHA = process.env.SANKHYA_SENHA;

// Lê o texto visível de todos os frames, atravessando shadow DOM (o cartão de
// login do Sankhya é um componente web e o innerText do body não o enxerga).
async function textoVisivel(page) {
  const partes = [];
  for (const f of page.frames()) {
    const t = await f.evaluate(() => {
      const out = [];
      const andar = (raiz) => {
        for (const el of raiz.querySelectorAll("*")) {
          if (el.shadowRoot) andar(el.shadowRoot);
          if (el.children.length === 0 && el.textContent && el.getClientRects().length) out.push(el.textContent.trim());
        }
      };
      andar(document);
      return out.filter(Boolean).join(" · ");
    }).catch(() => "");
    if (t) partes.push(t);
  }
  return partes.join(" | ").replace(/\s+/g, " ").slice(0, 500) || "(nenhum texto)";
}

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
  // Só "Prosseguir": "Entrar com Sankhya Pass" também casaria com /entrar/ e leva a outro login.
  const prosseguir = page.getByRole("button", { name: /^\s*prosseguir\s*$/i }).first();

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
  await page.waitForTimeout(2500);
  relato("texto da tela 2,5 s depois da senha", await textoVisivel(page));

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
    relato("senha ainda na tela", (await senhaVisivel.count()) ? "sim" : "não");
    relato("texto da tela no fim", await textoVisivel(page));
  }
} catch (erro) {
  relato("erro", String(erro && erro.message ? erro.message : erro).split("\n")[0].slice(0, 300));
} finally {
  await browser.close();
}

relato("RESULTADO", ok ? "LOGIN OK — o Sankhya aceitou o acesso pelo GitHub" : "LOGIN NÃO PASSOU");
process.exit(ok ? 0 : 1);
