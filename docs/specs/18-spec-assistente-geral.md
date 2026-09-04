# Spec 18 — Assistente geral no painel lateral

## Problema

Quem trabalha no CRM precisa sair da tela atual para pedir ajuda a uma IA. Isso
interrompe o atendimento e esconde qual credencial da empresa está sendo usada.

## Decisões desta primeira versão

| Decisão                                    | Consequência                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| O botão fica no cabeçalho, ao lado do sino | o assistente está disponível em qualquer tela autenticada                       |
| O painel abre pela direita                 | a pessoa mantém o contexto do CRM visível                                       |
| A pessoa escolhe GPT ou Gemini             | somente provedores com credencial ativa, validada e modelo de conversa aparecem |
| O histórico fica só na sessão da tela      | não se cria tabela nem retenção nova nesta versão                               |
| O modelo recebe zero ferramenta            | pode orientar, escrever e analisar; não altera dados nem envia mensagens        |
| Toda chamada passa por `runModelCall`      | orçamento, telemetria e proteções de saída existentes continuam valendo         |

O identificador e o segredo da credencial permanecem no servidor. O navegador
recebe apenas provedor, rótulo e modelo. A auditoria registra quem perguntou e
qual provedor/modelo respondeu, mas nunca o conteúdo da conversa.

## Fluxo

1. O usuário abre o painel.
2. A rota lista uma opção por provedor validado da organização ativa.
3. O usuário escolhe GPT ou Gemini e envia a pergunta.
4. A rota resolve novamente a credencial, executa uma chamada sem ferramentas e
   devolve a resposta.
5. A resposta aparece identificada com o provedor usado.

## Falhas fechadas

- Sem credencial validada, o campo fica desabilitado e a tela aponta para
  Credenciais de IA.
- Provedor adulterado ou sem credencial da organização é recusado antes da
  chamada ao modelo.
- Limite, saldo, modelo ou chave recusada viram mensagem compreensível no painel.
- Uma organização nunca pode selecionar a credencial de outra: toda consulta
  administrativa contém `organization_id` explícito.

## Não-objetivos

- Executar ações no CRM, enviar WhatsApp ou alterar cadastros.
- Consultar silenciosamente dados de clientes, estoque, preços ou conversas.
- Persistir ou compartilhar o histórico do painel.
- Escolher automaticamente um provedor diferente depois de uma falha.

## Provas

- `components/shell/GeneralAiCopilot.test.tsx`: abertura, troca de provedor,
  envio, teclado e estado sem credencial.
- `app/api/v1/ai/copilot/route.test.ts`: autenticação, isolamento da credencial,
  seleção do Gemini e ausência de ferramentas.
- `lib/ai/copilot/modelo.test.ts`: escolha segura de modelos de conversa.
