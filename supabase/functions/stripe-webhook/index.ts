// ============================================================
// Supabase Edge Function: Stripe-Webhook
// ------------------------------------------------------------
// Nach erfolgreicher Zahlung schreibt diese Funktion das Abo in
// public.entitlements (plan + aktiv_bis), damit die App den Nutzer
// automatisch freischaltet. Läuft mit dem Service-Role-Key (umgeht RLS).
//
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets: siehe README.md
// ============================================================
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
const whSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Stripe-Preis → Plan-Schlüssel. Bevorzugt price.metadata.plan ('basis'|'komplett'),
// sonst Abgleich mit den Umgebungs-IDs. Fallback: 'komplett' (lieber freischalten als sperren).
function planFromPrice(price: Stripe.Price | null | undefined): string {
  const meta = (price?.metadata?.plan || '').toLowerCase()
  if (meta === 'basis' || meta === 'komplett') return meta
  const id = price?.id
  if (id && id === Deno.env.get('STRIPE_PRICE_KOMPLETT')) return 'komplett'
  if (id && id === Deno.env.get('STRIPE_PRICE_BASIS')) return 'basis'
  return 'komplett'
}

async function setEntitlement(
  userId: string, plan: string, periodEnd: number | null,
  customer: string | null, sub: string | null,
) {
  await admin.from('entitlements').upsert({
    user_id: userId,
    plan,
    aktiv_bis: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    stripe_customer_id: customer,
    stripe_subscription_id: sub,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
}

async function userIdByCustomer(customer: string): Promise<string | null> {
  const { data } = await admin
    .from('entitlements').select('user_id')
    .eq('stripe_customer_id', customer).maybeSingle()
  return data?.user_id ?? null
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature')
  const body = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, whSecret)
  } catch (err) {
    return new Response('Ungültige Signatur: ' + (err as Error).message, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      // Erstkauf über Payment Link / Checkout. client_reference_id = Supabase user.id (von der App angehängt)
      const s = event.data.object as Stripe.Checkout.Session
      const userId = s.client_reference_id
      if (userId && s.subscription) {
        const sub = await stripe.subscriptions.retrieve(s.subscription as string)
        const plan = planFromPrice(sub.items.data[0]?.price)
        await setEntitlement(userId, plan, sub.current_period_end, s.customer as string, sub.id)
      }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      // Verlängerung / Wechsel / Kündigung-zum-Periodenende
      const sub = event.data.object as Stripe.Subscription
      const userId = await userIdByCustomer(sub.customer as string)
      if (userId) {
        const active = sub.status === 'active' || sub.status === 'trialing'
        const plan = active ? planFromPrice(sub.items.data[0]?.price) : 'free'
        await setEntitlement(userId, plan, sub.current_period_end, sub.customer as string, sub.id)
      }
    } else if (event.type === 'customer.subscription.deleted') {
      // Abo beendet → zurück auf 'free'
      const sub = event.data.object as Stripe.Subscription
      const userId = await userIdByCustomer(sub.customer as string)
      if (userId) await setEntitlement(userId, 'free', null, sub.customer as string, sub.id)
    }
  } catch (err) {
    console.error('Webhook-Verarbeitung fehlgeschlagen:', err)
    return new Response('Handler-Fehler', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'content-type': 'application/json' },
  })
})
