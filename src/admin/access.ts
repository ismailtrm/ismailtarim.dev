import type { MiddlewareHandler } from 'hono'
import { verifyWithJwks } from 'hono/jwt'
import type { Env } from '../env'

// Cloudflare Access already stops anonymous requests at the edge. The Worker checks the
// Access JWT again so that a misconfigured Access app or a forgotten hostname cannot open
// the write API. https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
export function requireAccess(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (isLocalDev(c.req.url, c.env)) return next()

    const token = c.req.header('Cf-Access-Jwt-Assertion')
    if (!token) return c.json({ error: 'missing Access token' }, 401)

    const team = c.env.ACCESS_TEAM_DOMAIN.replace(/\/+$/, '')
    let payload: Record<string, unknown>
    try {
      payload = await verifyWithJwks(token, {
        jwks_uri: `${team}/cdn-cgi/access/certs`,
        allowedAlgorithms: ['RS256'],
        verification: { iss: team, aud: c.env.ACCESS_AUD },
      },
      // The signing keys rotate every few weeks; ten minutes of edge cache saves a fetch per request without
      // locking the owner out for long after a rotation.
      { cf: { cacheTtl: 600, cacheEverything: true } })
    } catch {
      return c.json({ error: 'invalid Access token' }, 403)
    }
    if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== c.env.ADMIN_EMAIL.toLowerCase()) {
      return c.json({ error: 'not allowed' }, 403)
    }
    return next()
  }
}

// `wrangler dev` has no Access in front of it. The bypass needs both a localhost URL and an
// opt-in variable that only exists in .dev.vars, so a deployed Worker can never take it.
function isLocalDev(url: string, env: Env): boolean {
  const host = new URL(url).hostname
  return env.ADMIN_DEV_BYPASS === '1' && (host === 'localhost' || host === '127.0.0.1')
}
