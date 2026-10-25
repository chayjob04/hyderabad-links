/**
 * Where this site's server calls the API. Server-side only: the browser never calls the API
 * directly (architecture principle 1), it calls this Next.js server, which calls the API.
 *
 * `API_BASE_URL` comes first, and that ordering is the whole point of this file.
 *
 * It used to be the other way round -- `NEXT_PUBLIC_API_URL ?? API_BASE_URL` -- duplicated in three
 * places. On the deployment both variables existed: `NEXT_PUBLIC_API_URL` set first and left
 * pointing at a host that no longer resolves, and `API_BASE_URL` added later with the right value.
 * The stale one won, so every server-side fetch failed DNS resolution with `ENOTFOUND` and the site
 * showed its "temporarily unreachable" panel while a perfectly good API sat behind the correct
 * variable. Preferring `API_BASE_URL` fixes that without anyone having to edit the deployment.
 *
 * `NEXT_PUBLIC_API_URL` is kept only so an older deployment that has nothing else still works. It
 * is deprecated and should be deleted once every environment sets `API_BASE_URL`: anything named
 * `NEXT_PUBLIC_*` is inlined into the browser bundle by Next.js, and the API's address is not
 * something the browser has any business knowing.
 */
export const API_BASE_URL =
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:5080";
