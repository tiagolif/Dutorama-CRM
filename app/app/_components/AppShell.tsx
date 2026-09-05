"use client";
import type { ReactNode } from "react";
import { GeneralAiCopilot } from "@/components/shell/GeneralAiCopilot";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { useInboundMessageAlerts } from "@/hooks/notifications/useInboundMessageAlerts";
import { useCrmAlerts } from "@/hooks/notifications/useCrmAlerts";
import { useNotifyOpenFromServiceWorker } from "@/lib/notifications/notify_open";

interface AppShellProps {
  sidebarCollapsed: boolean;
  children: ReactNode;
}

export function AppShell({ sidebarCollapsed, children }: AppShellProps) {
  useInboundMessageAlerts();
  useCrmAlerts();
  useNotifyOpenFromServiceWorker();
  return (
    <div className="flex min-h-screen w-full bg-background">
      <div className="hidden md:block">
        <Sidebar collapsed={sidebarCollapsed} />
      </div>
      {/*
        `min-w-0` é o que permite a coluna de conteúdo ENCOLHER. Um flex item
        nasce com `min-width: auto`, ou seja, nunca fica menor que o conteúdo —
        então qualquer bloco largo (uma fila de abas, uma tabela) empurrava a
        PÁGINA INTEIRA para o lado em vez de rolar dentro da própria caixa, e o
        conteúdo sumia sem nada indicando que existia.

        Isso também é o que permite ao Copilot ocupar uma coluna real à direita:
        quando ele abre, esta coluna reduz de largura e o CRM continua utilizável
        ao lado, em vez de ficar coberto por um modal.
      */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
      <GeneralAiCopilot />
    </div>
  );
}
