# Deploy no Railway

Este projeto esta preparado para rodar como um unico servico no Railway:

- React/Vite e buildado dentro do Docker.
- Express serve o frontend em producao.
- SQLite fica em um volume persistente montado em `/data`.

## 1. Enviar para o GitHub

Suba a pasta do projeto para um repositorio GitHub:

```text
ProjetoEscala/
  backend/
  frontend/
  Dockerfile
  railway.json
```

## 2. Criar o projeto no Railway

1. Acesse https://railway.app.
2. Clique em `New Project`.
3. Escolha `Deploy from GitHub repo`.
4. Selecione o repositorio do projeto.
5. O Railway deve detectar o `Dockerfile` pela configuracao em `railway.json`.

## 3. Criar o volume persistente

No canvas do projeto Railway:

1. Abra o servico da aplicacao.
2. Crie/adicione um `Volume`.
3. Configure o mount path como:

```text
/data
```

O banco SQLite sera salvo em:

```text
/data/escala.db
```

Sem esse volume, o banco pode ser perdido entre deploys.

## 4. Configurar variaveis

Na aba `Variables` do servico, crie:

```env
NODE_ENV=production
TZ=America/Sao_Paulo
PORT=3001
DB_PATH=/data/escala.db
PUBLIC_DIR=/app/public
JWT_SECRET=troque-por-um-segredo-com-32-ou-mais-caracteres
ADMIN_USERNAME=admin
ADMIN_PASSWORD=troque-por-uma-senha-forte
CORS_ORIGIN=
```

Para gerar um segredo localmente:

```bash
openssl rand -hex 32
```

Se nao tiver OpenSSL, crie uma string longa manualmente.

## 5. Deploy

Depois de configurar as variaveis e o volume:

1. Clique em `Deploy` ou faca um novo push no GitHub.
2. Aguarde o build terminar.
3. Abra a URL publica gerada pelo Railway.
4. Acesse com o usuario admin inicial.

## 6. Depois do primeiro login

1. Troque a senha do admin.
2. Crie usuarios para a equipe.
3. Mantenha backup do banco pela tela de backup do sistema ou copiando o volume.

## Observacoes importantes

- Use apenas 1 replica enquanto o banco for SQLite.
- Nao remova o volume `/data`.
- Se migrar para Vercel/Firebase no futuro, migre tambem o banco para Postgres/Firestore.
