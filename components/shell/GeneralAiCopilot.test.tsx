import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GeneralAiCopilot } from "./GeneralAiCopilot";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

describe("assistente geral lateral", () => {
  it("abre como painel persistente, não modal, e só fecha pelo controle explícito", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ provider: "openai", rotulo: "GPT", model: "gpt-5-mini" }] }),
    });

    render(<GeneralAiCopilot />);
    const painel = screen.getByTestId("general-ai-copilot");
    expect(painel).toHaveAttribute("data-open", "false");

    await user.click(screen.getByRole("button", { name: "Abrir assistente geral" }));
    expect(painel).toHaveAttribute("data-open", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(document.body);
    expect(painel).toHaveAttribute("data-open", "true");

    await user.click(screen.getByRole("button", { name: "Fechar assistente geral" }));
    expect(painel).toHaveAttribute("data-open", "false");
  });

  it("permite escolher Gemini e envia a pergunta com esse provedor", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { provider: "openai", rotulo: "GPT", model: "gpt-5-mini" },
            { provider: "google", rotulo: "Gemini", model: "gemini-2.5-flash" },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { answer: "Resposta de teste", provider: "google", model: "gemini-2.5-flash" },
        }),
      });

    render(<GeneralAiCopilot />);
    await user.click(screen.getByRole("button", { name: "Abrir assistente geral" }));
    expect(await screen.findByRole("heading", { name: "Assistente geral" })).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Escolher inteligência artificial" }));
    await user.click(await screen.findByRole("option", { name: "Gemini" }));

    await user.type(
      screen.getByRole("textbox", { name: "Mensagem para o assistente" }),
      "Pode me ajudar?",
    );
    await user.click(screen.getByRole("button", { name: "Enviar pergunta" }));

    expect(await screen.findByText("Resposta de teste")).toBeInTheDocument();
    const pedido = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      provider: string;
      message: string;
    };
    expect(pedido).toMatchObject({ provider: "google", message: "Pode me ajudar?" });
  });

  it("Enter envia e Shift+Enter mantém a quebra de linha", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ provider: "openai", rotulo: "GPT", model: "gpt-5-mini" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { answer: "Tudo certo", provider: "openai", model: "gpt-5-mini" },
        }),
      });

    render(<GeneralAiCopilot />);
    await user.click(screen.getByRole("button", { name: "Abrir assistente geral" }));
    const campo = await screen.findByRole("textbox", { name: "Mensagem para o assistente" });
    await user.type(campo, "linha 1");
    fireEvent.keyDown(campo, { key: "Enter", shiftKey: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(campo, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("sem credencial validada mostra o caminho para corrigir", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });

    render(<GeneralAiCopilot />);
    await user.click(screen.getByRole("button", { name: "Abrir assistente geral" }));

    expect(
      await screen.findByText("Nenhuma IA validada está disponível para o chat."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir credenciais de IA" })).toHaveAttribute(
      "href",
      "/app/ai/credentials",
    );
  });
});
