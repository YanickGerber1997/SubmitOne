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

// Ein Stripe-Preis steht für ENTWEDER ein Paket (metadata.plan = 'basis'|'komplett')
// ODER ein Einzelmodul (metadata.modul = 'termine' | 'solar' | …).
function planFromPrice(price: Stripe.Price | null | undefined): string | null {
  const meta = (price?.metadata?.plan || '').toLowerCase()
  if (meta === 'basis' || meta === 'komplett') return meta
  const id = price?.id
  if (id && id === Deno.env.get('STRIPE_PRICE_KOMPLETT')) return 'komplett'
  if (id && id === Deno.env.get('STRIPE_PRICE_BASIS')) return 'basis'
  return null
}
function modulFromPrice(price: Stripe.Price | null | undefined): string | null {
  const m = (price?.metadata?.modul || '').toLowerCase()
  return m || null
}

async function getEnt(userId: string): Promise<{ plan: string; module: string[] }> {
  const { data } = await admin.from('entitlements').select('plan,module').eq('user_id', userId).maybeSingle()
  return { plan: data?.plan ?? 'free', module: (data?.module as string[]) ?? [] }
}

// Abo anwenden: Paket-Preis setzt den Plan, Modul-Preis fügt/entfernt das Modul in module[].
async function applySubscription(userId: string, sub: Stripe.Subscription, customer: string, active: boolean) {
  const price = sub.items.data[0]?.price
  const planKey = planFromPrice(price)
  const modulKey = modulFromPrice(price)
  const cur = await getEnt(userId)
  let plan = cur.plan
  let modules = new Set(cur.module)

  if (planKey) {
    plan = active ? planKey : 'free'
  } else if (modulKey) {
    if (active) modules.add(modulKey); else modules.delete(modulKey)
    // Reines Modul-Abo zählt als aktiv (Cloud-Speichern), ohne Paket
    if (plan === 'free' && modules.size) plan = 'modul'
    if (!active && modules.size === 0 && plan === 'modul') plan = 'free'
  } else if (active) {
    plan = 'komplett'   // unbekannter Preis: lieber freischalten als sperren
  }

  await admin.from('entitlements').upsert({
    user_id: userId,
    plan,
    module: [...modules],
    aktiv_bis: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    stripe_customer_id: customer,
    stripe_subscription_id: sub.id,
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
        await applySubscription(userId, sub, s.customer as string, true)
      }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      // Verlängerung / Wechsel / Kündigung-zum-Periodenende
      const sub = event.data.object as Stripe.Subscription
      const userId = await userIdByCustomer(sub.customer as string)
      if (userId) {
        const active = sub.status === 'active' || sub.status === 'trialing'
        await applySubscription(userId, sub, sub.customer as string, active)
      }
    } else if (event.type === 'customer.subscription.deleted') {
      // Abo beendet → Paket auf 'free' bzw. Modul entfernen
      const sub = event.data.object as Stripe.Subscription
      const userId = await userIdByCustomer(sub.customer as string)
      if (userId) await applySubscription(userId, sub, sub.customer as string, false)
    }
  } catch (err) {
    console.error('Webhook-Verarbeitung fehlgeschlagen:', err)
    return new Response('Handler-Fehler', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'content-type': 'application/json' },
  })
})
