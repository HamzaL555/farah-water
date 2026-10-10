/**
 * Verifies a credential against the LIVE API (not the database), so the whole
 * chain is exercised: bcrypt compare -> JWT issue -> /auth/me.
 * Usage: node verify-login.js <identifier> <password> [baseUrl]
 */
const identifier = process.argv[2];
const password = process.argv[3];
const base = (process.argv[4] || 'https://farah-water.vercel.app/api/v1').replace(/\/$/, '');

if (!identifier || !password) {
  console.error('Usage: node verify-login.js <identifier> <password> [baseUrl]');
  process.exit(1);
}

(async () => {
  let bad = 0;

  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const body = await res.json().catch(() => ({}));

  console.log(`POST /auth/login -> ${res.status}`);
  if (!res.ok) {
    console.log(`  body: ${JSON.stringify(body)}`);
    process.exit(1);
  }

  const token = body?.data?.tokens?.accessToken;
  const user = body?.data?.user;
  console.log(`  user     : ${user?.username} (${user?.role})`);
  console.log(`  token    : ${token ? `${token.slice(0, 12)}... (${token.length} chars)` : 'MISSING'}`);
  if (!token) bad++;

  if (token) {
    const me = await fetch(`${base}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const meBody = await me.json().catch(() => ({}));
    console.log(`GET  /auth/me   -> ${me.status}`);
    if (!me.ok) {
      console.log(`  body: ${JSON.stringify(meBody)}`);
      bad++;
    } else {
      const u = meBody?.data?.user ?? meBody?.user ?? meBody;
      console.log(`  user     : ${u?.username} (${u?.role})`);
    }
  }

  console.log(`\nRESULT: ${bad === 0 ? 'LOGIN WORKS' : 'FAILED'}`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
