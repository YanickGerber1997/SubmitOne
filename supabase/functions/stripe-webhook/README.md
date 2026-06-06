# Stripe-Webhook (Supabase Edge Function)

Schaltet Konten nach Zahlung automatisch frei: schreibt `plan` + `aktiv_bis`
in `public.entitlements`. Voraussetzung: das Abo-SQL ist eingespielt (Tabelle
`entitlements` existiert).

## Einmal einrichten

1. **Supabase CLI** installieren und einloggen
   ```bash
   npm i -g supabase
   supabase login
   supabase link --project-ref <DEIN_PROJECT_REF>
   ```

2. **Secrets setzen** (Werte aus dem Stripe-Dashboard)
   ```bash
   supabase secrets set \
     STRIPE_SECRET_KEY=sk_live_xxx \
     STRIPE_WEBHOOK_SECRET=whsec_xxx
   # optional, falls du keine Preis-Metadaten nutzt:
   # STRIPE_PRICE_BASIS=price_xxx  STRIPE_PRICE_KOMPLETT=price_yyy
   ```
   `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` stellt Supabase automatisch bereit.

3. **Deployen**
   ```bash
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```

4. **Webhook in Stripe registrieren**
   Stripe → Developers → Webhooks → *Add endpoint*
   - URL: `https://<DEIN_PROJECT_REF>.functions.supabase.co/stripe-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   - Das angezeigte **Signing secret** (`whsec_…`) als `STRIPE_WEBHOOK_SECRET` setzen (Schritt 2).

## Pakete zuordnen

Am einfachsten: bei jedem **Stripe-Preis** unter *Metadata* `plan = basis`
bzw. `plan = komplett` setzen – dann erkennt der Webhook das Paket automatisch.
Alternativ die Preis-IDs als `STRIPE_PRICE_BASIS` / `STRIPE_PRICE_KOMPLETT` setzen.

## Zusammenspiel mit der App

- Die App hängt beim „Upgraden" `?client_reference_id=<user.id>` an den Payment Link
  → der Webhook weiss, welches Konto bezahlt hat.
- Payment Links selbst trägst du in `config.js` unter `STRIPE_LINKS` ein.
- Plan-Änderungen greifen beim nächsten App-Laden (`loadEntitlements`).
