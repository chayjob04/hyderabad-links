-- S0009: two plans instead of four, paid periods per listing, and the website/social links a paid
-- listing may show.
--
-- The plans become Free (basic listing, no media) and Verified (Rs 399 a year: the badge, 10 photos,
-- 3 videos, 1 logo and up to 5 links). The earlier four tiers from D23 are deactivated rather than
-- deleted, because listings, and later payments, reference them by slug.
--
-- This supersedes the part of D23 that said a paid plan must never grant verification
-- automatically: the owner has decided that Verified is exactly what the paid tier buys, so
-- grants_verified_badge is 1 on it and media_limits_confirmed is 1 on both. See docs/decisions.md.
--
-- Expiry is NOT stored as a flag on the listing. A listing is verified only while it has an active
-- subscription row whose period covers the current instant, so the entitlement is computed from
-- expires_at on every read. That way a missed background job cannot leave a badge up for free, and
-- the data cannot drift out of agreement with what was paid for.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- QUOTED_IDENTIFIER must be ON for the filtered indexes below to be created at all, which is why
-- the header above is not optional. DbUp runs this whole file in one transaction
-- (WithTransactionPerScript), so this script does not open one of its own.

-- ------------------------------------------------------------------ 1. the two plans
-- Any listing on a tier that is going away falls back to the free plan. The listing itself, its
-- media rows and its content are untouched: only the entitlement changes.
UPDATE listings
SET plan_slug = 'free',
    updated_at = SYSDATETIMEOFFSET()
WHERE plan_slug NOT IN ('free', 'verified');
GO

UPDATE plans
SET name = 'Free',
    price_paise = 0,
    photo_limit = 0,
    video_limit = 0,
    logo_limit = 0,
    grants_verified_badge = 0,
    media_limits_confirmed = 1,
    sort_order = 0,
    is_active = 1,
    updated_at = SYSDATETIMEOFFSET()
WHERE slug = 'free';

INSERT INTO plans (slug, name, price_paise, photo_limit, video_limit, logo_limit,
                   grants_verified_badge, media_limits_confirmed, sort_order, is_active)
SELECT 'free', 'Free', 0, 0, 0, 0, 0, 1, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE slug = 'free');
GO

UPDATE plans
SET name = 'Verified',
    price_paise = 39900,          -- Rs 399.00, in paise
    photo_limit = 10,
    video_limit = 3,
    logo_limit = 1,
    grants_verified_badge = 1,
    media_limits_confirmed = 1,
    sort_order = 1,
    is_active = 1,
    updated_at = SYSDATETIMEOFFSET()
WHERE slug = 'verified';

INSERT INTO plans (slug, name, price_paise, photo_limit, video_limit, logo_limit,
                   grants_verified_badge, media_limits_confirmed, sort_order, is_active)
SELECT 'verified', 'Verified', 39900, 10, 3, 1, 1, 1, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE slug = 'verified');
GO

-- Retired, not removed: a row that something still points at must keep existing.
UPDATE plans
SET is_active = 0,
    updated_at = SYSDATETIMEOFFSET()
WHERE slug NOT IN ('free', 'verified');
GO

-- --------------------------------------------------------- 2. what a listing has paid for
/* One row per paid period. plan_slug is nvarchar(50) to match plans.slug exactly: SQL Server
   refuses a foreign key whose column is not the same type as the one it references.

   nvarchar(50) and not varchar(60), which is what this said first. varchar(60) is what S0005
   declares, but the company database's plans.slug is nvarchar(50) -- its schema was built outside
   these migrations -- and the FK is checked against the column that is really there, not against
   the one the migration intended:

     Column 'dbo.plans.slug' is not the same data type as referencing column
     'subscriptions.plan_slug' in foreign key 'subscriptions_plan_fk'.

   S0005 was changed to nvarchar(50) in the same pass, so a database built from scratch and the
   company database now agree. 50 characters is far more than any slug here needs. */
IF OBJECT_ID('dbo.subscriptions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.subscriptions (
        id          bigint IDENTITY(1,1) NOT NULL CONSTRAINT subscriptions_pkey PRIMARY KEY,
        listing_id  bigint NOT NULL CONSTRAINT subscriptions_listing_fk
                        REFERENCES dbo.listings (id) ON DELETE CASCADE,
        plan_slug   nvarchar(50) NOT NULL CONSTRAINT subscriptions_plan_fk
                        REFERENCES dbo.plans (slug),
        status      varchar(20) NOT NULL,
        starts_at   datetimeoffset(3) NOT NULL,
        expires_at  datetimeoffset(3) NOT NULL,
        created_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT subscriptions_created_default DEFAULT SYSDATETIMEOFFSET(),
        updated_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT subscriptions_updated_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT subscriptions_status_check
            CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
        -- A period that ends before it starts would read as permanently expired, or worse,
        -- permanently active depending on which end a query looked at.
        CONSTRAINT subscriptions_period_check CHECK (expires_at > starts_at)
    );
END;
GO

-- The lookup every entitlement read does: this listing, active, not yet expired.
IF OBJECT_ID('dbo.subscriptions', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'subscriptions_listing_period_idx'
                     AND object_id = OBJECT_ID('dbo.subscriptions'))
BEGIN
    CREATE INDEX subscriptions_listing_period_idx
        ON dbo.subscriptions (listing_id, status, expires_at)
        INCLUDE (plan_slug, starts_at);
END;
GO

-- A listing must not hold two overlapping paid periods: renewing extends the period rather than
-- opening a second one, so at most one row per listing may be active at a time.
IF OBJECT_ID('dbo.subscriptions', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'subscriptions_one_active_idx'
                     AND object_id = OBJECT_ID('dbo.subscriptions'))
BEGIN
    CREATE UNIQUE INDEX subscriptions_one_active_idx
        ON dbo.subscriptions (listing_id)
        WHERE status = 'active';
END;
GO

-- ------------------------------------------------------------------ 3. payment attempts
/* Nothing in the application writes this table yet: there is no payment provider wired up, and
   decision D-pending leaves the provider open. It is created now because the owner wrote it into
   this migration deliberately, and an empty table costs nothing.

   listing_id is a plain column with no foreign key on purpose. It would otherwise give listings a
   second cascade path (listings -> subscriptions -> payments, and listings -> payments), which SQL
   Server refuses outright. The subscription it belongs to carries the real relationship. */
IF OBJECT_ID('dbo.subscription_payments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.subscription_payments (
        id                     bigint IDENTITY(1,1) NOT NULL
                                   CONSTRAINT subscription_payments_pkey PRIMARY KEY,
        listing_id             bigint NOT NULL,
        subscription_id        bigint NULL CONSTRAINT subscription_payments_subscription_fk
                                   REFERENCES dbo.subscriptions (id) ON DELETE CASCADE,
        provider               varchar(30) NOT NULL
                                   CONSTRAINT subscription_payments_provider_default DEFAULT 'razorpay',
        provider_order_id      nvarchar(100) NULL,
        provider_payment_id    nvarchar(100) NULL,
        amount_paise           bigint NOT NULL,
        currency               char(3) NOT NULL
                                   CONSTRAINT subscription_payments_currency_default DEFAULT 'INR',
        status                 varchar(20) NOT NULL,
        signature_verified_at  datetimeoffset(3) NULL,
        paid_at                datetimeoffset(3) NULL,
        webhook_event_id       nvarchar(150) NULL,
        created_at             datetimeoffset(3) NOT NULL
                                   CONSTRAINT subscription_payments_created_default DEFAULT SYSDATETIMEOFFSET(),
        updated_at             datetimeoffset(3) NOT NULL
                                   CONSTRAINT subscription_payments_updated_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT subscription_payments_amount_check CHECK (amount_paise > 0),
        CONSTRAINT subscription_payments_status_check
            CHECK (status IN ('created', 'pending', 'paid', 'failed', 'refunded'))
    );
END;
GO

/* One row per provider reference. These are what make a replayed webhook harmless: the second
   delivery of the same event collides instead of granting a second year. */
IF OBJECT_ID('dbo.subscription_payments', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'subscription_payments_order_idx'
                   AND object_id = OBJECT_ID('dbo.subscription_payments'))
BEGIN
    CREATE UNIQUE INDEX subscription_payments_order_idx
        ON dbo.subscription_payments (provider, provider_order_id)
        WHERE provider_order_id IS NOT NULL;

    CREATE UNIQUE INDEX subscription_payments_payment_idx
        ON dbo.subscription_payments (provider, provider_payment_id)
        WHERE provider_payment_id IS NOT NULL;

    CREATE UNIQUE INDEX subscription_payments_webhook_idx
        ON dbo.subscription_payments (provider, webhook_event_id)
        WHERE webhook_event_id IS NOT NULL;

    CREATE INDEX subscription_payments_listing_idx
        ON dbo.subscription_payments (listing_id, created_at);
END;
GO

-- --------------------------------------------------- 4. website and social links (max 5)
IF OBJECT_ID('dbo.listing_links', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.listing_links (
        id          bigint IDENTITY(1,1) NOT NULL CONSTRAINT listing_links_pkey PRIMARY KEY,
        listing_id  bigint NOT NULL CONSTRAINT listing_links_listing_fk
                        REFERENCES dbo.listings (id) ON DELETE CASCADE,
        link_type   varchar(20) NOT NULL,
        label       nvarchar(80) NOT NULL,
        url         nvarchar(1000) NOT NULL,
        sort_order  int NOT NULL CONSTRAINT listing_links_sort_default DEFAULT 0,
        created_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT listing_links_created_default DEFAULT SYSDATETIMEOFFSET(),
        updated_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT listing_links_updated_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT listing_links_type_check
            CHECK (link_type IN ('website', 'instagram', 'facebook', 'youtube',
                                 'linkedin', 'x', 'other')),
        /* Five links, enforced by the database rather than only by the API: the range below caps
           the slots and the unique index further down stops two links sharing one. On its own the
           range would have allowed any number of links all sitting at position 0. */
        CONSTRAINT listing_links_sort_check CHECK (sort_order BETWEEN 0 AND 4),
        CONSTRAINT listing_links_label_not_blank CHECK (LEN(LTRIM(RTRIM(label))) > 0),
        -- Only a real web address, so a stored link cannot become a javascript: payload.
        CONSTRAINT listing_links_url_shape
            CHECK (url LIKE 'https://%' OR url LIKE 'http://%')
    );
END;
GO

IF OBJECT_ID('dbo.listing_links', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'listing_links_slot_idx'
                   AND object_id = OBJECT_ID('dbo.listing_links'))
BEGIN
    CREATE UNIQUE INDEX listing_links_slot_idx ON dbo.listing_links (listing_id, sort_order);
END;
GO

-- ------------------------------------------------------- 5. what a listing is entitled to NOW
/* The one definition of "is this listing paid up", so that no query can accidentally use a
   different rule. Everything the application reads about entitlement goes through this view:
   the owner's media allowance, the public badge, and the link limit.

   Expiry is a comparison against the clock, not a stored flag. A listing whose period has run out
   reads as 'free' from the next request onwards, with no job to run and nothing to go stale. The
   listing, its media rows and its links all stay exactly where they are; only what it is allowed
   to show changes, which is what "retain the basic listing and existing data" requires.

   It is not indexable (SYSDATETIMEOFFSET makes it non-deterministic). It does not need to be: the
   OUTER APPLY seeks subscriptions_listing_period_idx for a single listing. */
CREATE OR ALTER VIEW dbo.listing_entitlements
AS
SELECT
    li.id                                        AS listing_id,
    COALESCE(sub.plan_slug, 'free')              AS effective_plan_slug,
    p.name                                       AS effective_plan_name,
    p.photo_limit,
    p.video_limit,
    p.logo_limit,
    p.media_limits_confirmed,
    p.grants_verified_badge                      AS is_verified,
    -- The paid link allowance. Free listings get none; the cap itself lives in S0009's
    -- listing_links_sort_check, and this is what the API quotes to the owner.
    CASE WHEN p.grants_verified_badge = 1 THEN 5 ELSE 0 END AS link_limit,
    sub.expires_at                               AS paid_until,
    -- What the listing has bought, even once it has lapsed, so the owner can be shown "expired on
    -- the 3rd" rather than simply losing the tier with no explanation.
    li.plan_slug                                 AS subscribed_plan_slug
FROM listings li
OUTER APPLY (
    SELECT TOP (1) s.plan_slug, s.expires_at
    FROM subscriptions s
    WHERE s.listing_id = li.id
      AND s.status = 'active'
      AND s.starts_at <= SYSDATETIMEOFFSET()
      AND s.expires_at > SYSDATETIMEOFFSET()
    ORDER BY s.expires_at DESC
) sub
JOIN plans p ON p.slug = COALESCE(sub.plan_slug, 'free');
GO
