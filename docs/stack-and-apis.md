# Stack and APIs

Every tool, database object and API in HYDERABAD LINKS, with one word for what each is for.

Verified against the codebase on 2026-10-27: package references, migration files, route
registrations and the live API. Where something is listed but not yet working, it says so — a
reference that quietly implies more than is true is worse than no reference.

---

## Tools

| Tool | Role |
| --- | --- |
| Next.js | Frontend |
| React | UI |
| TypeScript | Type-safety |
| Tailwind CSS | Styling |
| ASP.NET Core | Backend |
| C# | Language |
| SQL Server | Database |
| DbUp | Migrations |
| Azure App Service | API-hosting |
| Vercel | Frontend-hosting |
| Cloudflare R2 | Media-storage |
| AWS SDK for .NET (S3) | R2-client |
| Azure Blob Storage | Fallback-storage |
| Razorpay | Payments |
| MSG91 | OTP-delivery |
| Resend | Email |
| JWT | Authorization |
| OTP | Authentication |
| TOTP | Admin-MFA |
| Git | Version-control |
| GitHub | Repository |
| GitHub Actions | CI/CD |
| Claude Code | AI-coding |
| xUnit | Testing |
| Azure environment variables | Configuration |

### Not in this project

Three things are commonly assumed to be here and are not. They are listed so nobody adds them to a
diagram by habit.

| Not used | Why |
| --- | --- |
| Docker | No Dockerfile, no compose file, no container in CI or deployment. The API ships to App Service as a zip; the sites are built by Vercel. See CLAUDE.md. |
| Swagger / OpenAPI | No Swashbuckle and no `AddOpenApi`. The endpoint list below is maintained by hand. |
| SSMS / VS Code SQL extension | Developer tooling, not a project dependency. |

### Not yet configured

| Tool | State |
| --- | --- |
| MSG91 | Keys unset, so owner OTP sign-in fails on every attempt. `Auth:DummyOtpEnabled` is covering for it and must be turned off before launch. |
| Resend | Keys unset, so no notification email is delivered. Every attempt is still recorded in `notifications`. |
| Azure Blob Storage | Supported in code; production uses R2. `Media:Provider` chooses. |
| Key Vault, Application Insights | Named in CLAUDE.md as intended infrastructure; not wired up. |

---

## Database objects

25 of the 34 tables and all 3 views. The rest are session, token and search-index tables that
nothing outside the API reads.

| Object | Role |
| --- | --- |
| `users` | User-records |
| `businesses` | Company-records |
| `business_members` | Ownership |
| `listings` | Business-records |
| `categories` | Categorization |
| `localities` | Locality-management |
| `cities` | City-management |
| `plans` | Pricing |
| `subscriptions` | Subscription-management |
| `subscription_payments` | Payment-records |
| `listing_media` | Media-metadata |
| `listing_links` | Social-links |
| `listing_alerts` | Owner-messages |
| `enquiries` | Leads |
| `reviews` | Ratings |
| `favourites` | Saves |
| `reports` | Moderation |
| `notifications` | Delivery-log |
| `admin_users` | Staff-accounts |
| `roles` | Role-definitions |
| `permissions` | Permission-catalogue |
| `audit_logs` | Audit-trail |
| `listing_entitlements` *(view)* | Plan-entitlements |
| `listing_visible_media` *(view)* | Media-visibility |
| `listing_overview` *(view)* | Listing-reporting |

`listing_overview` ships in migration `S0018` and is **not applied until `npm run db:migrate` is
run**.

The three views are the reason there is no `verified_listings` table: `listing_entitlements`
compares the subscription period against the clock at read time, so verification is correct the
moment it is asked and there is nothing to keep in step.

---

## The project's own API

About 75 endpoints under `/api/v1`. Route groups follow the audience, and a separate JWT audience
per group is what keeps them apart — a token for one is refused by the others before any handler
runs.

| Group | Role |
| --- | --- |
| `/api/v1/public` | Directory |
| `/api/v1/auth/owner` | Owner-login |
| `/api/v1/me` | Owner-dashboard |
| `/api/v1/auth/admin` | Staff-login |
| `/api/v1/admin` | Moderation |
| `/api/v1/super-admin` | Administration |
| `/api/v1/webhooks` | Payment-notifications |
| `/health` | Monitoring |

### Public — no authentication

```
GET  /cities                                    GET  /categories
GET  /cities/{city}/localities                  GET  /listings/nearby
GET  /localities/search                         GET  /listings/search
GET  /localities/nearest                        GET  /listings/highlights
GET  /listings/{parent}/{category}/{slug}       GET  /sitemap
GET  /listings/{city}/{locality}/{slug}/reviews GET  /report-reasons
POST /listings/{city}/{locality}/{slug}/enquiries
POST /listings/{city}/{locality}/{slug}/reports
POST /reviews/{city}/{locality}/{slug}
POST /reviews/{id}/reports
```

### Owner sign-in

```
POST /otp/request    POST /otp/verify    POST /refresh    POST /logout
```

### Owner — owner token

```
GET        /                       GET  /overview         PUT  /profile
POST       /onboarding             GET  /enquiries        PUT  /enquiries/{id}/status
GET        /favourites             PUT  /favourites/{city}/{locality}/{slug}
DELETE     /favourites/{city}/{locality}/{slug}
GET        /subscriptions          GET  /reviews
GET,POST   /listings               GET,PUT /listings/{id}
POST       /listings/{id}/submit
GET,POST   /listings/{id}/media    POST /listings/{id}/media/{mediaId}/move
DELETE     /listings/{id}/media/{mediaId}
GET,POST   /listings/{id}/links    DELETE /listings/{id}/links/{linkId}
GET        /listings/{id}/subscription
POST       /listings/{id}/subscription/order
POST       /listings/{id}/subscription/verify
GET        /listings/{id}/alerts
POST       /listings/{id}/alerts/{alertId}/acknowledge
```

### Staff sign-in

```
POST /login   POST /refresh   POST /logout
POST /mfa/verify   POST /mfa/enroll/start   POST /mfa/enroll/confirm
```

### Admin — admin token, plus a permission check per route

```
GET      /me
GET      /listings                 GET /listings/{id}
POST     /listings/{id}/approve | /reject | /suspend | /reinstate
GET,POST /listings/{id}/alerts
GET,POST /categories               PUT,DELETE /categories/{id}      GET /cities
GET,POST /localities               PUT,DELETE /localities/{id}
GET      /reviews                  POST /reviews/{id}/approve | /reject
GET      /reports                  POST /reports/{id}/action | /dismiss
```

An admin cannot create, edit or delete a listing, and cannot choose the homepage Featured shelf.
Those routes do not exist on this surface at all — they answer 404 or 405 rather than 401, which is
asserted by an integration test so the separation cannot quietly regress.

### Super admin — super-admin token

```
GET        /me  /overview  /admins  /roles  /audit
PUT        /admins/{id}/roles | /status     POST /admins/{id}/reset-mfa
GET,POST   /listings                        GET,PUT,DELETE /listings/{id}
POST       /listings/{id}/archive
GET,POST   /listings/{id}/alerts
GET        /listings/featured
PUT,DELETE /listings/{id}/featured
```

### Webhook and health — no authentication

```
POST /api/v1/webhooks/razorpay     GET /health/live     GET /health/ready
```

The webhook has no token and no authorization policy by design. It authenticates by HMAC signature
over the raw request body, which proves both who sent it and that the body — carrying the amount —
was not edited in transit.

---

## External APIs

| API | Role | State |
| --- | --- | --- |
| Razorpay Orders | Order-creation | Working, test mode |
| Razorpay Webhooks | Payment-confirmation | Working, test mode |
| Cloudflare R2 (S3) | File-storage | Working |
| MSG91 | SMS | Not configured |
| Resend | Email | Not configured |
| Azure Blob Storage | File-storage | Supported, not in use |

Razorpay stays in test mode until `Payments:LiveModeApproved` is set. A `rzp_live_` key is refused
until then, and the subscription endpoints answer 503 exactly as if nothing were configured.
