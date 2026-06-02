# VOLTZ Store — Setup Guide
## Como ativar a automação completa

---

## Estrutura de arquivos para subir no GitHub

```
voltz-store/
├── index.html          ← site principal
├── package.json        ← dependências Node
├── vercel.json         ← config do Vercel
├── imgs/               ← fotos dos produtos
│   ├── id1_0.jpg
│   └── ...
└── api/
    ├── create-payment.js   ← cria pagamento no Stripe
    ├── webhook.js          ← automação principal
    └── check-tracking.js  ← verifica rastreio no CJ
```

---

## Passo 1 — Criar contas nas plataformas

### Stripe (pagamentos)
1. Acesse stripe.com e crie conta grátis
2. Vá em **Developers → API Keys**
3. Copie:
   - `Publishable key` → começa com `pk_live_...`
   - `Secret key` → começa com `sk_live_...`
4. Vá em **Developers → Webhooks → Add endpoint**
5. URL: `https://seusite.vercel.app/api/webhook`
6. Eventos: selecione `payment_intent.succeeded`
7. Copie o **Webhook signing secret** → começa com `whsec_...`

### CJDropshipping (fornecedor)
1. Acesse cjdropshipping.com
2. Crie conta grátis
3. Vá em **My CJ → API** no menu do perfil
4. Copie seu **Email** e **API Key**

### Resend (emails grátis)
1. Acesse resend.com e crie conta grátis
2. Plano grátis: 3.000 emails/mês — suficiente para começar
3. Vá em **API Keys → Create API Key**
4. Copie a chave → começa com `re_...`
5. Em **Domains**, adicione seu domínio (opcional — sem domínio usa o sandbox)

---

## Passo 2 — Configurar variáveis de ambiente no Vercel

No painel do Vercel, vá em:
**Project → Settings → Environment Variables**

Adicione estas variáveis:

| Nome | Valor | Onde pegar |
|------|-------|------------|
| `STRIPE_SECRET_KEY` | `sk_live_...` | Stripe → API Keys |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe → Webhooks |
| `STRIPE_PUBLIC_KEY` | `pk_live_...` | Stripe → API Keys |
| `CJ_EMAIL` | `seu@email.com` | Seu email do CJ |
| `CJ_API_KEY` | `abc123...` | CJ → API Settings |
| `RESEND_API_KEY` | `re_...` | Resend → API Keys |
| `CRON_SECRET` | `qualquer_senha_forte` | Você cria agora |

Depois de adicionar todas, clique em **Redeploy**.

---

## Passo 3 — Colocar sua Stripe Public Key no site

No `index.html`, na função `placeOrder()`, substitua:
```js
window.STRIPE_PUBLIC_KEY || 'pk_test_YOUR_KEY_HERE'
```
Por:
```js
'pk_live_SUA_CHAVE_AQUI'
```

---

## Passo 4 — Adicionar VIDs dos produtos do CJ

Cada produto no CJ tem um **VID (Variant ID)** — é o ID real para criar pedidos.

Como achar:
1. Abra o produto no CJDropshipping
2. Vá em **API → Product Query** com o SPU
3. No resultado, cada variante tem um `vid`

No arquivo `api/webhook.js`, a linha:
```js
vid: item.variantId || item.spu,
```
...usa o SPU como fallback. Para produção, adicione o VID real de cada produto.

---

## Como a automação funciona (fluxo completo)

```
Cliente preenche checkout
        ↓
Frontend chama /api/create-payment
        ↓
Stripe processa o cartão
        ↓
Stripe chama /api/webhook automaticamente
        ↓
webhook.js:
  1. Pega token do CJ
  2. Cria pedido no CJ com endereço do cliente
  3. Chama Claude para gerar email personalizado
  4. Envia email via Resend
        ↓
CJ embala e envia para o cliente
        ↓
(Opcional) Chame /api/check-tracking periodicamente
para enviar email de rastreio quando CJ despachar
```

---

## Custos mensais para começar

| Serviço | Custo |
|---------|-------|
| Vercel (hospedagem) | Grátis |
| Stripe | 2.9% + $0.30 por venda |
| CJDropshipping | Grátis (paga só o produto) |
| Resend (email) | Grátis até 3.000/mês |
| **Total fixo** | **$0/mês** |

Você só paga quando vende. Perfeito para começar.

---

## Suporte

Se tiver dúvidas na configuração, me manda os erros que aparecem no painel do Vercel (aba **Functions → Logs**) que eu resolvo.
