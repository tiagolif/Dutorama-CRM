# Dutorama — reinício no Vercel

Base: DeskcommCRM v1.74.0, commit cad19848c4782dc5239b9f53b2c2f4718221b865.
Destino: uso pessoal para testes, com WhatsApp oficial da Meta.

## Estado confirmado
- Esta branch parte da release original; não contém os ajustes antigos feitos apenas na VPS.
- vercel.json declara Next.js, instalação com lockfile e build pnpm.
- next.config.ts já desativa standalone quando VERCEL está definido.
- O upstream deixou de suportar o CRM no Vercel (docs/current-state.md).
- lib/env.ts ainda exige WAHA_API_BASE_URL, WAHA_API_KEY e WAHA_WEBHOOK_BASE_URL em produção.
- Há worker contínuo e rotas de cron; conectar GitHub ao Vercel não agenda esses processos.
- O histórico guardado pelo NOWEB não equivale a importar mensagens para a Inbox.

## Próximas etapas
1. Identificar o projeto Supabase existente e preservar seus dados e chaves de criptografia. Não aplicar reset.
2. Adaptar o boot e a interface para operação somente com o canal Meta, com canais não configurados claramente indisponíveis.
3. Definir processamento de eventos e automações compatível com o plano escolhido antes de habilitar respostas automáticas.
4. Cadastrar variáveis e validar build, login, isolamento de organização, webhook e envio oficial em ambiente de teste.
5. Publicar somente depois dessas verificações.

## Configuração
Obrigatórias atualmente: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL, INTERNAL_SECRET, CPF_ENCRYPTION_KEY,
WAHA_BYO_ENCRYPTION_KEY, AI_CRED_AES_KEY, WAHA_API_BASE_URL, WAHA_API_KEY,
WAHA_WEBHOOK_BASE_URL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN.
Confirmar a lista com lib/env.ts ao configurar; chaves condicionais ainda serão adaptadas.
Definir NEXT_PUBLIC_APP_URL e NEXT_PUBLIC_ADMIN_URL para o endereço publicado e APP_NAME=Dutorama CRM.
As credenciais Meta e de IA dependem da configuração escolhida no produto.
Nunca colocar valores secretos no GitHub.

## Validação e limites
Base da release conferida pela API do GitHub.
Configuração JSON validada sintaticamente.
Build e funcionamento no Vercel ainda não verificados; esta branch não é uma implantação concluída.
