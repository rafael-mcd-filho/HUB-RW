# HUB RW Meta Hub

Hub standalone e multi-app para conectar canais da Meta: WhatsApp Business, Messenger e Instagram. O painel cadastra apps Meta, executa os fluxos OAuth, recebe webhooks por app, exibe interacoes em tempo real e encaminha eventos para outros sistemas.

O projeto nao depende de backend externo obrigatorio. Em desenvolvimento e Docker simples, os dados podem ficar em arquivos JSON no diretorio `data/`. Em Vercel ou qualquer ambiente serverless, configure `DATABASE_URL` para usar PostgreSQL como storage persistente.

## Recursos

- Multi-app: varios apps Meta, cada um com credenciais, verify token, webhook e destinos proprios.
- OAuth por canal: WhatsApp Business Embedded Signup, Messenger e Instagram Login.
- Webhooks por app: callback em `/webhook/app/<id>` com aliases por produto.
- Encaminhamento: POST do payload recebido para URLs configuradas por app.
- Modo historico ou transacional: salvar eventos no painel ou apenas encaminhar.
- Botoes embed: snippets publicos para iniciar conexao fora do painel.
- Painel protegido por senha, textos em portugues e console ao vivo.
- Healthcheck em `GET /health`.

## Desenvolvimento Local

Requisitos: Node.js 18+.

```bash
npm install
cp .env.example .env
npm run build
npm start
```

Em desenvolvimento:

```bash
npm run dev
```

Acesse `http://localhost:3300`.

## Variaveis Principais

| Variavel | Uso |
| --- | --- |
| `PORT` | Porta HTTP interna. Padrao: `3300`. |
| `PUBLIC_URL` | URL publica sem barra final. Em producao: `https://hub.rwsolucoesdigitais.com`. |
| `DATABASE_URL` | PostgreSQL persistente. Obrigatorio para Vercel/serverless. Vazio usa JSON local em `data/`. |
| `PG_POOL_MAX` | Maximo de conexoes Postgres por instancia. Padrao recomendado para Vercel: `3`. |
| `ADMIN_PASSWORD` | Senha do painel. Obrigatoria em producao. |
| `SESSION_SECRET` | Segredo HMAC para sessao, OAuth state e assinatura. Obrigatorio em producao. |
| `BRAND_NAME` | Nome exibido no painel. Padrao: `HUB RW`. |
| `META_API_VERSION` | Versao padrao da Graph API. |
| `FORWARD_TIMEOUT_MS` | Timeout dos encaminhamentos. |
| `WEBHOOK_EVENTS_MAX` | Tamanho maximo do historico de eventos. |

As variaveis `META_APP_*`, `INSTAGRAM_APP_*` e `WEBHOOK_VERIFY_TOKEN` sao opcionais e servem para semear um app no primeiro boot.

## Producao Na Vercel

O projeto ja inclui `api/index.ts` e `vercel.json`. Na Vercel, o Express roda como Function e os assets em `public/` sao servidos pela propria plataforma. Como filesystem serverless nao e storage persistente, use obrigatoriamente PostgreSQL externo.

1. Crie o projeto na Vercel apontando para este repositorio.
2. Configure o dominio customizado `hub.rwsolucoesdigitais.com` no projeto.
3. No DNS, aponte `hub.rwsolucoesdigitais.com` conforme a instrucoes mostradas pela Vercel.
4. Configure as variaveis de ambiente abaixo em Production, Preview e Development se necessario.

```env
PUBLIC_URL=https://hub.rwsolucoesdigitais.com
DATABASE_URL=postgresql://USUARIO:SENHA@HOST:5432/NOME_DO_BANCO?sslmode=disable
PG_POOL_MAX=3
ADMIN_PASSWORD=troque-por-uma-senha-forte
SESSION_SECRET=gere-com-openssl-rand-hex-32
BRAND_NAME=HUB RW
```

Gere o segredo com:

```bash
openssl rand -hex 32
```

Depois do deploy, valide:

```bash
curl https://hub.rwsolucoesdigitais.com/health
```

Se o banco estiver no aaPanel, confirme que:

- PostgreSQL esta ouvindo em `0.0.0.0:5432` ou no IP publico necessario.
- `pg_hba.conf` permite o usuario/banco do hub via `md5` ou `scram-sha-256`.
- A porta `5432/tcp` esta liberada no firewall.
- A porta `5432/udp` nao e necessaria para PostgreSQL e pode ser removida.

Para reduzir exposicao em producao, prefira liberar a porta 5432 apenas para IPs de saida fixos do provedor ou usar um banco gerenciado. Se usar Vercel sem IP fixo, a alternativa simples e manter `5432/tcp` publico com senha forte, rotacao e monitoramento.

## Subdominio `hub`

Nao precisa alterar rotas do codigo por rodar em subdominio. Os pontos obrigatorios sao:

- `PUBLIC_URL=https://hub.rwsolucoesdigitais.com`
- Dominio customizado configurado na Vercel.
- DNS do subdominio apontando para a Vercel.
- No painel da Meta, usar as URLs com o mesmo host `hub.rwsolucoesdigitais.com`.

As URLs geradas pelo painel ficarao assim:

- Webhook: `https://hub.rwsolucoesdigitais.com/webhook/app/<idDoApp>`
- WhatsApp alias: `https://hub.rwsolucoesdigitais.com/webhook/app/<idDoApp>/waba`
- Messenger alias: `https://hub.rwsolucoesdigitais.com/webhook/app/<idDoApp>/messenger`
- Instagram alias: `https://hub.rwsolucoesdigitais.com/webhook/app/<idDoApp>/instagram`
- Instagram redirect URI: `https://hub.rwsolucoesdigitais.com/connect/instagram/callback`

## Producao Com Docker Compose

Docker continua suportado para VPS ou servidor proprio. Sem `DATABASE_URL`, o volume `hub-rw-meta-data` mantem apps, canais, tokens, eventos e settings em JSON. Com `DATABASE_URL`, o container usa PostgreSQL.

1. Configure DNS para `hub.rwsolucoesdigitais.com`.
2. Publique o servico atras de HTTPS. A Meta exige HTTPS para OAuth e webhooks.
3. Crie `.env` a partir do exemplo:

```bash
cp .env.example .env
```

4. Defina pelo menos:

```env
PUBLIC_URL=https://hub.rwsolucoesdigitais.com
ADMIN_PASSWORD=troque-por-uma-senha-forte
SESSION_SECRET=gere-com-openssl-rand-hex-32
BRAND_NAME=HUB RW
HOST_PORT=3300
```

5. Suba o container:

```bash
docker compose up -d --build
docker compose logs -f
```

Atualizacao:

```bash
docker compose up -d --build
```

Parada:

```bash
docker compose down
```

## Reverse Proxy

Exemplo Nginx:

```nginx
server {
  server_name hub.rwsolucoesdigitais.com;

  location / {
    proxy_pass http://127.0.0.1:3300;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Com Caddy:

```caddyfile
hub.rwsolucoesdigitais.com {
  reverse_proxy 127.0.0.1:3300
}
```

## Configuracao Na Meta

No painel do HUB RW, cada app mostra as URLs prontas:

- Webhook: `https://SEU_DOMINIO/webhook/app/<idDoApp>`
- WhatsApp alias: `.../waba`
- Messenger alias: `.../messenger`
- Instagram alias: `.../instagram`
- Instagram redirect URI: `https://SEU_DOMINIO/connect/instagram/callback`

No App Dashboard da Meta:

1. Adicione o dominio publico em `Dominios do app`.
2. Configure OAuth redirect URIs quando o produto exigir.
3. Configure Webhooks com a callback URL e o Verify Token do app.
4. Assine os campos necessarios, como `messages` e, no Instagram, `comments`.
5. Use a aba `Canais` do HUB RW para conectar WhatsApp, Messenger ou Instagram.

## Seguranca Operacional

- Nunca rode producao sem `ADMIN_PASSWORD`.
- Nunca use `PUBLIC_URL` com HTTP em producao.
- Nunca grave senhas reais no repositorio. Use variaveis de ambiente na Vercel.
- Rotacione a senha do PostgreSQL antes de considerar o ambiente final.
- Faca backup do PostgreSQL ou do volume `hub-rw-meta-data`, conforme o storage usado.
- Proteja o banco: senha forte, firewall, logs e, se possivel, allowlist de IPs.
- Rotacione `SESSION_SECRET` apenas sabendo que sessoes e OAuth em andamento serao invalidados.
- Restrinja o acesso ao painel por rede/VPN quando possivel.
- Monitore `GET /health` no provedor.

## Endpoints

Painel/admin:

- `GET /api/bootstrap`
- `POST /api/login`
- `GET /api/config`
- `POST /api/settings`
- `GET/POST /api/apps`
- `PUT/DELETE /api/apps/:id`
- `GET /api/channels`
- `DELETE /api/channels/:id`
- `GET /api/events?since=ISO`
- `POST /api/events/clear`
- `POST /api/connect/:channel/init`

Conexao:

- `GET /connect/waba|messenger|instagram`
- `GET /connect/instagram/callback`
- `POST /api/connect/waba|messenger/exchange`

Embed publico:

- `GET /embed/connect?app=<id>&channel=<waba|messenger|instagram>`

Webhooks:

- `GET|POST /webhook/app/:appKey`
- `GET|POST /webhook/app/:appKey/:product`
- `GET|POST /webhook`
- `GET|POST /webhook/:product`

Saude:

- `GET /health`
