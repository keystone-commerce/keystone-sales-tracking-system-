const origin = process.env.BACKEND_ORIGIN || (process.env.NODE_ENV !== 'production' ? 'http://127.0.0.1:8082' : '');
if (origin) {
  const u = new URL(origin);
  if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) throw Error('BACKEND_ORIGIN must be a plain origin');
  if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') throw Error('Production BACKEND_ORIGIN must use HTTPS');
}
if (process.env.VERCEL && !origin) throw Error('Set BACKEND_ORIGIN to the AWS API origin in Vercel');
export default { distDir: process.env.NODE_ENV!=='production'&&process.env.SALES_OPS_TEST_BUILD==='true'?'.next-pricing-check':'.next', devIndicators: false, async rewrites() { return origin ? [{ source: '/api/:path*', destination: `${origin}/api/:path*` }] : []; } };
