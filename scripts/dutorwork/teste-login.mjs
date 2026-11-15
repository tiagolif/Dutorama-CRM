// DutorWork — teste de login no Sankhya a partir do GitHub Actions.
// Só responde: o login passou? Ver .github/workflows/dutorwork-teste-login.yml
import { chromium } from "playwright";
import { abrirNavegador, entrar, relato } from "./sankhya.mjs";

const { browser, page } = await abrirNavegador(chromium);
let ok = false;
try {
  ok = await entrar(page, {
    url: process.env.SANKHYA_URL,
    usuario: process.env.SANKHYA_USUARIO,
    senha: process.env.SANKHYA_SENHA,
  });
  if (ok) {
    const n = await page.getByText(/painel do vendedor/i).count();
    relato("aba Painel do Vendedor visível", n ? "sim" : "não");
  }
} catch (erro) {
  relato("erro", String(erro?.message ?? erro).split("\n")[0].slice(0, 300));
} finally {
  await browser.close();
}
relato("RESULTADO", ok ? "LOGIN OK — o Sankhya aceitou o acesso pelo GitHub" : "LOGIN NÃO PASSOU");
process.exit(ok ? 0 : 1);
