// Runs before every request to this site — both the app pages and /api/*.
// Requires a shared password via standard HTTP Basic Auth (the browser's
// built-in login prompt). The password is read from the SITE_PASSWORD
// environment variable/secret, set in the Cloudflare Pages dashboard —
// it is never stored in this code.

export async function onRequest(context) {
  const { request, next, env } = context;
  const expected = env.SITE_PASSWORD;

  if (!expected) {
    return new Response(
      'Site password not configured. Add a SITE_PASSWORD secret in the Pages project settings and redeploy.',
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const decoded = atob(authHeader.slice(6));
      const password = decoded.slice(decoded.indexOf(':') + 1);
      if (password === expected) {
        return next();
      }
    } catch {
      // fall through to 401
    }
  }

  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Resource Planner", charset="UTF-8"',
    },
  });
}
