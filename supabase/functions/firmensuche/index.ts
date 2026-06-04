// ============================================================
// SubmitOne – Edge Function "firmensuche"
// Proxy zum Schweizer Handelsregister (Zefix). Hält die Zefix-
// Zugangsdaten serverseitig geheim und erlaubt CORS für die App.
//
// Deploy (Supabase CLI):  supabase functions deploy firmensuche --no-verify-jwt
// Secret setzen:          supabase secrets set ZEFIX_AUTH="benutzer:passwort"
//   (ZEFIX_AUTH = "benutzer:passwort"  ODER  schon "Basic <base64>")
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    let q = '';
    if (req.method === 'POST') { const b = await req.json().catch(() => ({})); q = (b.q || '').toString().trim(); }
    else { q = (new URL(req.url).searchParams.get('q') || '').trim(); }
    if (q.length < 2) return json([]);

    const auth = Deno.env.get('ZEFIX_AUTH') || '';
    const authHeader = auth ? (auth.startsWith('Basic ') ? auth : 'Basic ' + btoa(auth)) : '';
    if (!authHeader) return json({ error: 'ZEFIX_AUTH fehlt (Secret setzen)' }, 500);

    const r = await fetch('https://www.zefix.admin.ch/ZefixPublicREST/api/v1/company/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ name: q, activeOnly: true }),
    });
    if (!r.ok) return json({ error: 'zefix ' + r.status }, 502);

    const list = await r.json();
    const out = (Array.isArray(list) ? list : []).slice(0, 8).map((c: any) => ({
      name: c.name,
      uid: c.uidFormatted || c.uid || '',
      rechtsform: c.legalForm?.shortName?.de || c.legalForm?.name?.de || '',
      plz: '',
      ort: c.legalSeat || '',
      kanton: '',
      branche: '',
    }));
    return json(out);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
