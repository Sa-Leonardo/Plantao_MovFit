# Escala de Suporte — Instruções de Deploy

## Requisitos

- Docker e Docker Compose instalados na máquina

## Primeiro uso

### 1. Configure o ambiente

Copie o arquivo de exemplo e edite as variáveis:

```bash
cp .env.example .env
```

Edite o `.env`:
- **JWT_SECRET** — troque por uma string longa e aleatória (obrigatório em produção)
- **ADMIN_PASSWORD** — senha do primeiro admin (mínimo 8 caracteres)
- **PORT** — porta de acesso (padrão: 8080)

### 2. Suba os containers

```bash
docker compose up -d --build
```

O build pode levar alguns minutos na primeira vez.

### 3. Acesse a aplicação

Abra no navegador: **http://localhost:8080**

Login padrão:
- Usuário: `admin`
- Senha: `Admin@1234` (ou o valor definido em ADMIN_PASSWORD)

> **Importante:** Altere a senha após o primeiro login em _Usuários → Alterar senha_.

---

## Fluxo recomendado

1. Faça login como admin
2. Crie os **turnos** (aba Turnos) — ex: Manhã 08:00–14:00, Tarde 14:00–20:00
3. Adicione os **atendentes** (aba Time) — cada um vinculado a um turno
4. Adicione os **feriados** do ano (aba Feriados)
5. Visualize a **escala** gerada automaticamente (aba Calendário)
6. Crie **usuários de leitura** para sua equipe (aba Usuários)

---

## Níveis de acesso

| Papel | Permissões |
|-------|-----------|
| **Admin** | Ver + criar/editar/excluir turnos, atendentes, feriados, usuários e editar escala |
| **Usuário** | Somente visualizar calendário, time, feriados e turnos |

---

## Gerenciar a aplicação

```bash
# Parar
docker compose down

# Ver logs
docker compose logs -f

# Atualizar após mudanças
docker compose up -d --build

# Backup do banco
cp data/escala.db data/escala_backup_$(date +%Y%m%d).db
```

---

## Estrutura do projeto

```
ProjetoEscala/
├── backend/          # API Node.js + Express + SQLite
├── frontend/         # React + Vite (servido via Nginx)
├── data/             # Banco de dados SQLite (persiste entre reinicializações)
├── docker-compose.yml
├── .env.example
└── INSTRUCOES.md
```

---

## Segurança implementada

- Senhas com hash bcrypt (custo 12)
- Tokens JWT com expiração de 8 horas
- Rate limiting no login (10 tentativas por 15 min por IP)
- Rotas de escrita protegidas por role admin
- Foreign keys no banco para integridade dos dados
- Validação de inputs no backend
