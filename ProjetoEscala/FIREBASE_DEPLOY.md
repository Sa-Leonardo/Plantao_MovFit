# Deploy no Firebase gratuito

Esta versao usa:

- Firebase Hosting para o frontend.
- Firebase Authentication para login.
- Cloud Firestore como banco de dados.

O backend Express/SQLite continua existindo para uso local ou deploy Docker, mas no modo Firebase o frontend usa Firestore diretamente.

## 1. Criar projeto no Firebase

1. Acesse https://console.firebase.google.com.
2. Crie um projeto.
3. Ative `Authentication`.
4. Em Authentication, ative o provedor `Email/password`.
5. Ative `Cloud Firestore`.
6. Ative `Hosting`.

## 2. Criar o app Web

No Firebase Console:

1. Abra `Project settings`.
2. Em `Your apps`, crie um app Web.
3. Copie as configuracoes do Firebase.
4. Crie o arquivo:

```text
frontend/.env.local
```

Use como base:

```text
frontend/.env.firebase.example
```

Exemplo:

```env
VITE_DATA_PROVIDER=firebase
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=seu-projeto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=seu-projeto
VITE_FIREBASE_STORAGE_BUCKET=seu-projeto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## 3. Instalar Firebase CLI

```powershell
npm install -g firebase-tools
firebase login
```

## 4. Conectar o projeto local ao Firebase

Na raiz do projeto:

```powershell
cd "C:\Users\Usuário\OneDrive\Documentos\ProjetoEscala\ProjetoEscala"
firebase use --add
```

Escolha o projeto criado no Firebase.

Isso criara um arquivo `.firebaserc`.

## 5. Criar o primeiro admin

Como nao existe backend Admin SDK no plano gratuito, o primeiro admin precisa ser criado manualmente:

1. Firebase Console > Authentication > Users > Add user.
2. Use um email de login.

Se quiser login com usuario `admin`, use:

```text
admin@movfit.local
```

3. Copie o `User UID` criado.
4. Firestore Database > crie a collection `users`.
5. Crie um documento com ID igual ao UID do usuario.
6. Campos do documento:

```json
{
  "username": "admin",
  "name": "Administrador",
  "role": "admin",
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

7. Crie tambem a collection `username_reservations`.
8. Documento ID:

```text
admin
```

Campos:

```json
{
  "username": "admin",
  "status": "active"
}
```

Depois disso voce pode logar no sistema com:

```text
Usuario: admin
Senha: a senha criada no Firebase Auth
```

## 6. Build e deploy

Na raiz do projeto:

```powershell
cd frontend
npm install
npm run build
cd ..
firebase deploy
```

## 7. Dados iniciais MovFit

No primeiro login admin, o sistema cria automaticamente no Firestore:

- colaboradores MovFit;
- faixas F1, F2, F3, F4;
- feriados oficiais de 2026;
- configuracoes iniciais.

## Limitacoes do modo Firebase gratuito

- Webhooks reais precisam de backend/Cloud Functions.
- API Keys externas nao fazem sentido sem backend.
- Exclusao de usuario remove o perfil do Firestore, mas nao remove o usuario do Firebase Auth pelo frontend. Remova no Console se precisar.
- Solicitacao de cadastro armazena a senha temporariamente ate aprovacao. Aprove ou rejeite rapidamente.
