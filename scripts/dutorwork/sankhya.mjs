// DutorWork — peças comuns do robô do Sankhya (login e leitura de tela).
// Nada aqui escreve dado de cliente no log: o repositório é público.

export function relato(chave, valor) {
  process.stdout.write(`[dutorwork] ${chave}: ${valor}\n`);
}

export async function abrirNavegador(chromium) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    // O Sankhya recusa tela menor que 1024x768; o padrão do Playwright (1280x720) fica abaixo.
    viewport: { width: 1536, height: 864 },
  });
  return { browser, page };
}

// Texto visível de um frame, atravessando shadow DOM (o cartão de login e
// partes do painel são componentes web, que o innerText do body não enxerga).
export async function textoDoFrame(frame) {
  return frame
    .evaluate(() => {
      const out = [];
      const andar = (raiz) => {
        for (const el of raiz.querySelectorAll("*")) {
          if (el.shadowRoot) andar(el.shadowRoot);
          if (el.children.length === 0 && el.textContent && el.getClientRects().length) out.push(el.textContent.trim());
        }
      };
      andar(document);
      return out.filter(Boolean).join(" · ");
    })
    .catch(() => "");
}

// Faz o login. Devolve true quando o sistema abriu; nunca tenta duas vezes,
// porque senha errada repetida pode bloquear o usuário.
export async function entrar(page, { url, usuario, senha }) {
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  relato("tela de login respondeu", resp ? resp.status() : "sem resposta");

  const senhaVisivel = page.locator('input[type="password"]:visible');
  const campoUsuario = page
    .locator('input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):visible')
    .first();
  // Só "Prosseguir": "Entrar com Sankhya Pass" também casaria com /entrar/ e leva a outro login.
  const prosseguir = page.getByRole("button", { name: /^\s*prosseguir\s*$/i }).first();

  await Promise.race([
    senhaVisivel.first().waitFor({ timeout: 45000 }),
    campoUsuario.waitFor({ timeout: 45000 }),
  ]);
  if (!(await senhaVisivel.count())) {
    await campoUsuario.fill(usuario);
    await prosseguir.click();
    await senhaVisivel.first().waitFor({ timeout: 30000 });
  }
  await senhaVisivel.first().fill(senha);
  await prosseguir.click();
  await page.waitForURL(/system\.jsp/, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const ok = new URL(page.url()).pathname.includes("system.jsp");
  if (!ok) {
    // Na tela de login não há dado de cliente: o aviso pode ir para o log.
    relato("aviso na tela de login", (await textoDoFrame(page.mainFrame())).slice(0, 300) || "(nenhum)");
  }
  relato("login", ok ? "ok" : "não passou");
  return ok;
}

// Acha o frame do Painel do Vendedor (o gadget html5 fica num iframe).
export async function framePainel(page, timeoutMs = 60000) {
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    for (const f of page.frames()) {
      if (/html5component/.test(f.url())) {
        // O menu lateral (Recolher + Região) só existe no Painel do Vendedor;
        // "Carrinho de Vendas" sozinho também aparece no cartão Lançador da tela inicial.
        const a = await f.getByText(/^\s*recolher\s*$/i).count().catch(() => 0);
        const b = await f.getByText(/^\s*região\s*$/i).count().catch(() => 0);
        if (a && b) return f;
      }
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

// Abre a aba "Painel do Vendedor" da barra superior do Sankhya (rótulo GWT).
export async function abrirAbaPainel(page) {
  const aba = page.locator(".gwt-Label", { hasText: /painel do vendedor -/i }).first();
  const ok = await aba.isVisible().catch(() => false);
  if (ok) await aba.click();
  relato("aba Painel do Vendedor clicada", ok ? "sim" : "não");
  return ok;
}
