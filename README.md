# shopify-printavo-proxy
Proxy server for Shopify to Printavo integration

## Configuration

Environment variables (set in Vercel): `PRINTAVO_EMAIL`, `PRINTAVO_TOKEN`, `SHOPIFY_SECRET`,
Upstash Redis (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`), and optionally
`PRINTAVO_ALLOWED_ENDPOINTS` (comma-separated list of allowed first path segments for `/api/proxy`, e.g. `orders,customers`).
