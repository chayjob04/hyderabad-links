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
- GitHub Actions: one CI workflow per deployable with path filters, and one deploy workflow for the
  API (`.github/workflows/main_hyderabad-links-api.yml`): build and publish, then **migrate**, then
  deploy to App Service over OIDC with no stored password. The three websites are built by Vercel
  from the same repository and have no workflow here.

  **The migrate job is written and switched off**, so today the API still ships without its
  migrations being applied. Three things switch it on, and all three are deliberate:
    1. A GitHub **environment** named `production-database`. Add required reviewers to it — that is
       what makes this the gated step, and the approval prompt is where someone reads the list of
       pending migrations the job prints before it applies anything.
    2. The secret `DATABASE_CONNECTION_STRING` **on that environment**. It needs rights to create
       and alter this project's objects, which the API's own login neither needs nor should have.
    3. The repository variable `RUN_MIGRATIONS` set to `true`.

  Schema first, code second: the migrations are forward-only and additive, so the running (old)
  code is unaffected by a schema ahead of it, while new code against an old schema is not. A failed
  migration stops the deployment. `migrate --what-if` lists what would be applied and changes
  nothing, which is also the safe way to check this by hand.

  **Untested.** The database is on shared hosting rather than Azure SQL and may only accept
  allow-listed addresses, which a GitHub-hosted runner does not have. If that is how it is
  configured, this needs a self-hosted runner or an allow-list entry, and `npm run db:migrate` from
  a trusted machine stays the fallback.
- App Service settings: HTTPS Only on; `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` on the API; Key Vault references for secrets;
  health check path `/health/live` (API) and `/health` (websites); `APP_ENV` = STAGING or PRODUCTION on each website.
- **Storage for listing media** (needed the moment photos go live). `Media__Provider` picks the service; with nothing
  configured the API refuses uploads with 503 and never records a row for a file it did not store. Either way the files are
  public listing photos, served straight to the browser rather than through the API (decision D33).

  **Cloudflare R2** (`Media__Provider=r2`). Settings on the API: `Media__R2AccountId`, `Media__R2AccessKeyId` and
  `Media__R2SecretAccessKey` (the last two are secrets, so Key Vault references), `Media__BucketName` (default
  `listing-media`) and `Media__PublicBaseUrl`, which is **required** here. Four things are done once in the Cloudflare
  dashboard, and the API deliberately does none of them:
    1. Create the bucket. R2 gives a new bucket no public hostname, so one created automatically would accept uploads and
       serve nothing — and a typo in the name would quietly make a second bucket.
    2. Give it a public address: either a custom domain (`media.hyderabadlinks.com`, the right answer for production) or
       its `r2.dev` development subdomain. That address is `Media__PublicBaseUrl`, and it cannot be derived from the
       account id, which is why it is a setting rather than a default.
    3. Create an R2 API token with **Object Read & Write** on that bucket — not account-wide, and not Admin. Its S3
       credentials are the access key id and secret above.
    4. Set the bucket's CORS policy only if a browser will ever upload directly. Today it will not: every upload goes
       through the API, server to server.

  The API checks all of this on boot by listing one object, and logs what is wrong if it cannot.

  **Azure Blob Storage** (`Media__Provider=azure`, or just a connection string and no provider line) remains supported. One
  Storage Account per environment with a blob container (default name `listing-media`). The API creates the container on
  startup, but can only make it public-read if the account has **"Allow Blob public access" enabled**. Settings:
  `Media__BlobConnectionString` (a secret, so a Key Vault reference), `Media__ContainerName`, and optionally
  `Media__PublicBaseUrl` when a CDN or custom domain fronts it.
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
  - **A live key is refused until it is approved.** Razorpay puts the mode in the key id, so a
    `rzp_live_…` key is recognised as live and ignored unless `Payments__LiveModeApproved=true` is
    also set; until then payments answer 503 exactly as if nothing were configured, and the API says
    so on boot. The flag is permission, not a mode switch: with it on, a test key is still a test
    key, so switching back to test mode needs no second change. Set it on the day live payments are
    approved — the cost of forgetting is a lost sale, and the cost of not having it is real money
    taken through a flow nobody signed off.
  - Nothing in this repository has taken a real payment. The first one to go through should be
    checked against `subscriptions` and `subscription_payments` before the plan is advertised.
- No paid resource is created without an itemised cost estimate and explicit approval.
