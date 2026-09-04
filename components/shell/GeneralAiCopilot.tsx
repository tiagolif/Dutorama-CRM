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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { CircleNotch, PaperPlaneTilt, Sparkle, Trash } from "@/lib/ui/icons";
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

  function mudarAbertura(proximo: boolean) {
    setOpen(proximo);
    if (proximo) void carregarOpcoes();
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
    <Sheet open={open} onOpenChange={mudarAbertura}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={t("Abrir assistente geral")}
          data-testid="general-ai-trigger"
          className="relative inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:h-9 lg:w-9"
        >
          <Sparkle size={19} weight="duotone" aria-hidden />
        </button>
      </SheetTrigger>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-5 py-4 pr-12 text-left">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Sparkle size={18} weight="duotone" aria-hidden />
            </span>
            <div className="min-w-0">
              <SheetTitle>{t("Assistente geral")}</SheetTitle>
              <SheetDescription>{t("Converse sem sair da tela atual.")}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex items-center gap-2 border-b px-5 py-3">
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
          <div className="space-y-4 p-5" aria-live="polite">
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
                      : "bg-muted/50 border text-foreground",
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
                className="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-sm text-destructive"
                role="alert"
              >
                {erro}
              </div>
            ) : null}
            <div ref={fimRef} />
          </div>
        </ScrollArea>

        <form className="border-t p-4" onSubmit={(event) => void enviar(event)}>
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
      </SheetContent>
    </Sheet>
  );
}
