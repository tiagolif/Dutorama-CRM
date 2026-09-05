"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { CircleNotch, PaperPlaneTilt, Sparkle, Trash, X } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Opcao {
  provider: "openai" | "google";
  rotulo: string;
  model: string;
}

interface Mensagem {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: string;
}

type RespostaApi<T> = { data?: T; error?: { message?: string } };

export function GeneralAiCopilot() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [entrada, setEntrada] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);

  async function carregarOpcoes() {
    if (opcoes.length > 0 || carregando) return;
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch("/api/v1/ai/copilot");
      const json = (await res.json()) as RespostaApi<Opcao[]>;
      if (!res.ok || !Array.isArray(json.data)) {
        throw new Error(json.error?.message ?? t("Não consegui carregar as IAs."));
      }
      setOpcoes(json.data);
      setProvider((atual) => atual || json.data?.[0]?.provider || "");
    } catch (error) {
      setErro(error instanceof Error ? error.message : t("Não consegui carregar as IAs."));
    } finally {
      setCarregando(false);
    }
  }

  function abrir() {
    setOpen(true);
    void carregarOpcoes();
  }

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens, enviando]);

  async function enviar(event?: FormEvent) {
    event?.preventDefault();
    const texto = entrada.trim();
    if (!texto || !provider || enviando) return;

    const anteriores = mensagens.slice(-20).map(({ role, content }) => ({ role, content }));
    const pergunta: Mensagem = { id: crypto.randomUUID(), role: "user", content: texto };
    setMensagens((atual) => [...atual, pergunta]);
    setEntrada("");
    setErro(null);
    setEnviando(true);

    try {
      const res = await fetch("/api/v1/ai/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, message: texto, history: anteriores }),
      });
      const json = (await res.json()) as RespostaApi<{
        answer: string;
        provider: string;
        model: string;
      }>;
      if (!res.ok || !json.data) {
        throw new Error(json.error?.message ?? t("A IA não conseguiu responder."));
      }
      setMensagens((atual) => [
        ...atual,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: json.data!.answer,
          provider: json.data!.provider === "google" ? "Gemini" : "GPT",
        },
      ]);
    } catch (error) {
      setErro(error instanceof Error ? error.message : t("A IA não conseguiu responder."));
    } finally {
      setEnviando(false);
    }
  }

  function aoDigitar(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void enviar();
    }
  }

  return (
    <aside
      data-testid="general-ai-copilot"
      data-open={open ? "true" : "false"}
      aria-label={t("Assistente geral")}
      className={cn(
        "fixed right-0 z-30 shrink-0 bg-background transition-[width,box-shadow] duration-200 ease-out",
        "md:sticky md:top-0 md:right-auto md:h-screen md:border-l",
        open
          ? "inset-y-0 flex w-[92vw] max-w-[430px] flex-col border-l shadow-2xl md:w-[420px] md:max-w-none md:shadow-none xl:w-[440px]"
          : "top-24 h-12 w-12 md:top-0 md:h-screen md:w-12",
      )}
    >
      {!open ? (
        <button
          type="button"
          aria-label={t("Abrir assistente geral")}
          aria-expanded="false"
          data-testid="general-ai-trigger"
          onClick={abrir}
          className="flex h-12 w-12 items-center justify-center rounded-l-xl border border-r-0 bg-background text-muted-foreground shadow-lg transition-colors hover:bg-muted hover:text-foreground md:mt-3 md:rounded-none md:border-0 md:shadow-none"
        >
          <Sparkle size={20} weight="duotone" aria-hidden />
        </button>
      ) : (
        <div className="flex h-full min-h-0 w-full flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Sparkle size={18} weight="duotone" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{t("Assistente geral")}</h2>
                <p className="truncate text-xs text-muted-foreground">
                  {t("Converse sem sair da tela atual.")}
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("Fechar assistente geral")}
              onClick={() => setOpen(false)}
            >
              <X aria-hidden />
            </Button>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">{t("Usar")}</span>
            <Select
              value={provider}
              onValueChange={setProvider}
              disabled={carregando || opcoes.length === 0}
            >
              <SelectTrigger
                className="h-9 flex-1"
                aria-label={t("Escolher inteligência artificial")}
              >
                <SelectValue placeholder={carregando ? t("Carregando…") : t("Escolha uma IA")} />
              </SelectTrigger>
              <SelectContent>
                {opcoes.map((opcao) => (
                  <SelectItem key={opcao.provider} value={opcao.provider}>
                    {opcao.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mensagens.length > 0 ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("Limpar conversa")}
                onClick={() => {
                  setMensagens([]);
                  setErro(null);
                }}
              >
                <Trash aria-hidden />
              </Button>
            ) : null}
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4 p-4" aria-live="polite">
              {!carregando && opcoes.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  <p>{erro ?? t("Nenhuma IA validada está disponível para o chat.")}</p>
                  <Link
                    className="mt-2 inline-block text-accent underline underline-offset-4"
                    href="/app/ai/credentials"
                  >
                    {t("Abrir credenciais de IA")}
                  </Link>
                </div>
              ) : mensagens.length === 0 ? (
                <div className="py-10 text-center">
                  <Sparkle
                    className="mx-auto mb-3 text-accent"
                    size={32}
                    weight="duotone"
                    aria-hidden
                  />
                  <p className="font-medium">{t("Como posso ajudar?")}</p>
                  <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                    {t("Peça ajuda para analisar, escrever ou esclarecer uma dúvida.")}
                  </p>
                </div>
              ) : null}

              {mensagens.map((mensagem) => (
                <div
                  key={mensagem.id}
                  className={cn("flex", mensagem.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[88%] rounded-lg px-3 py-2 text-sm",
                      mensagem.role === "user"
                        ? "bg-accent text-accent-foreground"
                        : "border bg-muted/50 text-foreground",
                    )}
                  >
                    {mensagem.provider ? (
                      <div className="mb-1 text-[11px] font-semibold opacity-70">
                        {mensagem.provider}
                      </div>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words">{mensagem.content}</p>
                  </div>
                </div>
              ))}

              {enviando ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CircleNotch className="animate-spin" aria-hidden />
                  {t("Pensando…")}
                </div>
              ) : null}
              {erro && opcoes.length > 0 ? (
                <div
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                  role="alert"
                >
                  {erro}
                </div>
              ) : null}
              <div ref={fimRef} />
            </div>
          </ScrollArea>

          <form className="shrink-0 border-t p-4" onSubmit={(event) => void enviar(event)}>
            <div className="flex items-end gap-2">
              <Textarea
                value={entrada}
                onChange={(event) => setEntrada(event.target.value)}
                onKeyDown={aoDigitar}
                placeholder={t("Digite sua pergunta…")}
                aria-label={t("Mensagem para o assistente")}
                rows={2}
                maxLength={8_000}
                disabled={opcoes.length === 0 || enviando}
                className="min-h-11 resize-none"
              />
              <Button
                type="submit"
                size="icon"
                aria-label={t("Enviar pergunta")}
                disabled={!entrada.trim() || !provider || enviando}
              >
                <PaperPlaneTilt aria-hidden />
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("Esta versão orienta e responde, mas não altera dados do CRM.")}
            </p>
          </form>
        </div>
      )}
    </aside>
  );
}
