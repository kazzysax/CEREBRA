const backendUrl = process.env.CEREBRA_API_URL ?? 'http://127.0.0.1:3100';
type RouteContext = { params: Promise<{ path: string[] }> };
async function proxy(request: Request, context: RouteContext) {
  const { path } = await context.params;
  const incoming = new URL(request.url);
  const target = new URL('/' + path.join('/'), backendUrl);
  target.search = incoming.search;
  try {
    const response = await fetch(target, { method: request.method, headers: { 'content-type': request.headers.get('content-type') ?? 'application/json' }, body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text() });
    return new Response(response.body, { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' } });
  } catch (error) {
    return Response.json({ error: 'CEREBRA_BACKEND_UNAVAILABLE', message: error instanceof Error ? error.message : 'The Cerebra backend is unavailable.' }, { status: 503 });
  }
}
export const GET = proxy;
export const POST = proxy;
