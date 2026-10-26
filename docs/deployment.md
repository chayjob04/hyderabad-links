# Deployment plan (nothing is provisioned yet)

- Four independent Azure App Services: main, admin, super-admin, API. They may share one App Service *plan* (the paid compute)
  at first to save cost; each still deploys independently.
- Separate staging and production resource groups and databases.
- **Azure SQL Database** (decision D41). Two things are decided when the database is created and
  cannot be changed afterwards, so they have to be right first time:
  - **Collation** must be case-insensitive — `SQL_Latin1_General_CP1_CI_AS`, which is what the local
    container uses. Every query assumes it, with explicit `COLLATE` clauses where a check needs case
    or binary comparison.
  - **Full-text search** must be available on the chosen tier. It is supported on Azure SQL Database;
    semantic search is not, and is not used.
  The API's `ConnectionStrings__Default` is a Key Vault reference and keeps `Encrypt=True`. It must
  **not** carry `TrustServerCertificate=True`, which exists locally only for the container's
  self-signed certificate. Migrations run as a gated deployment step
  (`dotnet run --project backend/BusinessDirectory.Api -- migrate`), never from the running API, and
  the runner never creates the database. Nothing here has yet been pointed at a real Azure SQL
  database: that is untested.
- GitHub Actions: one CI workflow per deployable with path filters (exists). Deploy workflows arrive in Phase 9: Azure sign-in via
  OIDC (no stored passwords), automatic staging deploy, manual approval for production, migrations as a gated step before the API.
- App Service settings: HTTPS Only on; `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` on the API; Key Vault references for secrets;
  health check path `/health/live` (API) and `/health` (websites); `APP_ENV` = STAGING or PRODUCTION on each website.
- **Storage for listing media** (needed the moment photos go live). One Storage Account per environment with a blob
  container (default name `listing-media`). The API creates the container on startup, but it can only make it public-read if
  the account has **"Allow Blob public access" enabled** — the files are public listing photos, so they are served directly to
  the browser rather than through the API (decision D33). Settings on the API: `Media__BlobConnectionString` (a secret, so a
  Key Vault reference), `Media__ContainerName`, and optionally `Media__PublicBaseUrl` when a CDN or custom domain fronts it.
  With no connection string the API refuses uploads with 503 and never records a row for a file it did not store.
- **Owner sign-in by SMS (MSG91)** — `MSG91__AuthKey` and `MSG91__TemplateId` on the API, both
  secrets, so Key Vault references. **Nothing else about the site needs them, and nobody can sign in
  without them:** OTP is the only owner login, so an unset or wrong key means every attempt fails.
  The API writes a startup warning rather than refusing to start, because search, categories and
  every listing page work without SMS.
  - **Verify them in one step, before trusting them:**
    ```powershell
    dotnet run --project backend/BusinessDirectory.Api -- sms-test --phone +91XXXXXXXXXX
    ```
    It sends one real code through the same sender the API uses and prints what MSG91 said,
    including MSG91's own refusal when there is one. It costs money, it never prints the code, and it
    stores no challenge — it tests delivery, not sign-in.
  - **Accepted is not delivered.** The sender passes the code as the `otp` query parameter *and* as
    `Param2`. If the DLT-approved template names its variable something else, MSG91 answers
    `{"type":"success"}` and the SMS arrives with an empty code in it. That is the one failure the
    API cannot detect, so the first real send has to be read on a real phone.
  - A send that fails answers **503** and **deletes the challenge**, so a provider outage does not
    burn the caller's five-codes-an-hour allowance on codes that never arrived.
- **Payments for the Verified plan** (needed the moment the ₹399 plan goes on sale). Settings on the
  API: `Payments__Provider=razorpay`, `Payments__KeyId`, `Payments__KeySecret` and
  `Payments__WebhookSecret` — the last two are secrets, so Key Vault references. `Payments__PlanSlug`
  and `Payments__PeriodMonths` default to `verified` and `12`; the price itself is read from the
  `plans` table on every request and is never configuration.
  - With no provider set the subscription endpoints answer **503** and write nothing. A key id
    without its secret counts as unconfigured, deliberately: a checkout that opens and cannot then
    be verified ends with a customer charged and no subscription.
  - The **webhook** must be registered in Razorpay's dashboard against
    `POST https://<api-host>/api/v1/webhooks/razorpay` for the `payment.captured` event, with the
    same secret as `Payments__WebhookSecret`. Without it, a customer who closes the tab mid-payment
    is charged and their listing stays Free — the browser's return trip is not a reliable messenger.
  - Use Razorpay's **test keys** (`rzp_test_…`) in staging. Staging and production must not share one
    Razorpay account: a webhook from either would reach whichever endpoint is registered, and the
    other environment's database has no record of that order.
  - Nothing in this repository has taken a real payment. The first one to go through should be
    checked against `subscriptions` and `subscription_payments` before the plan is advertised.
- No paid resource is created without an itemised cost estimate and explicit approval.
