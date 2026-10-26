-- S0005: subscription plans, the plan a listing is on, and listing media.
-- The SQL Server counterpart of PostgreSQL V0008.
--
-- OUTSTANDING OWNER DECISIONS, carried over unchanged and still not invented here:
--   * the photo/video allowance per tier (the numbers below are the documented ones, with the
--     middle tier carrying what requirements.md called "Gold"); `media_limits_confirmed` marks them
--     provisional so the application can say so
--   * the billing period for the paid tiers, which is documented nowhere
--   * whether a paid plan grants a verified badge: it does not, and `grants_verified_badge` is 0
--     everywhere, because requirements.md says a paid plan must never grant verification

-- Spatial and filtered indexes require these to be ON, and a client that leaves either OFF makes
-- the index creation fail rather than silently differ. Microsoft.Data.SqlClient has them ON already;
-- sqlcmd does not, so they are set here and the file is correct whichever applies it.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* slug is nvarchar(50), here and on listings.plan_slug further down. It said varchar(60) until
   S0009 was first applied to the company database and failed: that database's schema was built
   outside these migrations and its plans.slug is nvarchar(50), and SQL Server checks a foreign key
   against the column that actually exists, so subscriptions.plan_slug could not reference it.

   Editing an applied migration is normally wrong, and this is the exception that proves the rule
   rather than breaking it: DbUp journals a script by name and never re-reads an applied one, so
   this changes nothing for any database that already has the table. What it does change is a
   database built from scratch, which now gets the same type as production instead of one that
   S0009 would refuse. 50 characters is far more than any slug here needs. */
CREATE TABLE plans (
    slug                    nvarchar(50) NOT NULL CONSTRAINT plans_pkey PRIMARY KEY,
    name                    nvarchar(120) NOT NULL,
    -- Paise, not rupees: integer money avoids the rounding problems of a float.
    price_paise             bigint NOT NULL,
    photo_limit             int NOT NULL,
    video_limit             int NOT NULL,
    -- A logo is identity rather than promotion, so it is counted separately from photos.
    logo_limit              int NOT NULL,
    grants_verified_badge   bit NOT NULL CONSTRAINT plans_badge_default DEFAULT 0,
    /* 0 until the owner confirms the per-tier allowances. The UI reads this so it can avoid
       presenting a provisional number as a promise. */
    media_limits_confirmed  bit NOT NULL CONSTRAINT plans_limits_confirmed_default DEFAULT 0,
    sort_order              int NOT NULL CONSTRAINT plans_sort_default DEFAULT 0,
    is_active               bit NOT NULL CONSTRAINT plans_is_active_default DEFAULT 1,
    created_at              datetimeoffset(3) NOT NULL CONSTRAINT plans_created_default DEFAULT SYSDATETIMEOFFSET(),
    updated_at              datetimeoffset(3) NOT NULL CONSTRAINT plans_updated_default DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT plans_price_not_negative CHECK (price_paise >= 0),
    CONSTRAINT plans_limits_not_negative CHECK (photo_limit >= 0 AND video_limit >= 0 AND logo_limit >= 0),
    CONSTRAINT plans_slug_format CHECK (
        LEN(slug) > 0
        AND slug COLLATE Latin1_General_BIN2 NOT LIKE '%[^a-z0-9-]%'
        AND slug NOT LIKE '-%' AND slug NOT LIKE '%-' AND slug NOT LIKE '%--%'
    )
);

-- The four plans have to exist before the column that references them, because every existing
-- listing takes the 'free' default the moment the column is added. R004_plans.sql is the idempotent
-- reference seed that keeps these rows current afterwards.
INSERT INTO plans (slug, name, price_paise, photo_limit, video_limit, logo_limit, sort_order) VALUES
  ('free',     'Free',     0,        0,  0, 0, 0),
  ('basic',    'Basic',    69900,    4,  0, 1, 1),
  ('advanced', 'Advanced', 699900,   4,  2, 1, 2),
  ('premium',  'Premium',  3699900, 16,  4, 1, 3);

-- Decision D5: subscriptions are per listing, so the plan hangs off the listing.
-- Every existing listing becomes Free, which is the no-cost default and changes nothing about them.
ALTER TABLE listings
    ADD plan_slug nvarchar(50) NOT NULL CONSTRAINT listings_plan_default DEFAULT 'free'
        CONSTRAINT listings_plan_fk REFERENCES plans (slug);
GO

CREATE INDEX listings_plan_idx ON listings (plan_slug);

-- Media belongs to a listing. The binary never goes in the database: `storage_key` names the blob
-- and the bytes live in Azure Blob Storage (Azurite locally).
CREATE TABLE listing_media (
    id                 bigint IDENTITY(1,1) NOT NULL CONSTRAINT listing_media_pkey PRIMARY KEY,
    listing_id         bigint NOT NULL CONSTRAINT listing_media_listing_fk
                           REFERENCES listings (id) ON DELETE CASCADE,
    kind               varchar(20) NOT NULL,
    -- Random, not derived from the uploaded filename: a caller must never be able to choose a path.
    storage_key        nvarchar(400) NOT NULL,
    content_type       varchar(100) NOT NULL,
    byte_size          bigint NOT NULL,
    -- Null for video, and for an image whose dimensions could not be read.
    width              int NULL,
    height             int NULL,
    sort_order         int NOT NULL CONSTRAINT listing_media_sort_default DEFAULT 0,
    /* D10: when a plan is downgraded, media over the new allowance is hidden, never deleted. */
    is_hidden          bit NOT NULL CONSTRAINT listing_media_hidden_default DEFAULT 0,
    created_at         datetimeoffset(3) NOT NULL CONSTRAINT listing_media_created_default DEFAULT SYSDATETIMEOFFSET(),
    created_by_user_id bigint NULL CONSTRAINT listing_media_created_by_fk REFERENCES users (id),
    CONSTRAINT listing_media_storage_key_key UNIQUE (storage_key),
    CONSTRAINT listing_media_kind_check CHECK (kind IN ('logo', 'photo', 'video')),
    CONSTRAINT listing_media_size_positive CHECK (byte_size > 0),
    /* Either both dimensions are known or neither is. The IS NOT NULL tests are not redundant:
       with only a width set, "width > 0 AND height > 0" is NULL rather than false, and a CHECK
       constraint accepts NULL, so the half-filled row would have been stored. */
    CONSTRAINT listing_media_dimensions CHECK (
        (width IS NULL AND height IS NULL)
        OR (width IS NOT NULL AND height IS NOT NULL AND width > 0 AND height > 0)
    )
);

-- The gallery for one listing, in display order.
CREATE INDEX listing_media_listing_idx ON listing_media (listing_id, kind, sort_order);

-- Counting what a listing already has, to compare against its allowance.
CREATE INDEX listing_media_quota_idx ON listing_media (listing_id, kind) WHERE is_hidden = 0;
