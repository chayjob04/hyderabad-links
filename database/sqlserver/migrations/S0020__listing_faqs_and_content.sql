-- S0020: FAQs and content sections on a listing, and the plan allowances that govern them.
--
-- Two things a Free listing cannot say and a Verified one can. This is the first time the paid
-- plan buys something other than a badge, media and links, which is the point: an owner weighing
-- Rs 399 should be able to see what it adds.
--
-- Additive: two new tables, two new columns on `plans`, and one new view. No existing column is
-- altered and no row is touched.
--
-- THE ALLOWANCE WORKS LIKE MEDIA, DELIBERATELY. The limit lives in `plans`, is read through
-- `listing_entitlements` against the clock, and rows over the allowance are KEPT AND HIDDEN rather
-- than deleted (decision D10). An owner whose plan lapses does not lose what they wrote; it stops
-- being shown, and comes back when they renew. `listing_visible_faqs` and
-- `listing_visible_content` below do that the same way `listing_visible_media` (S0012) does.
--
-- The columns are added with a default of 0, so every existing plan — Free and Verified alike —
-- starts with no allowance and nothing changes until R004 sets the Verified numbers. That is on
-- purpose: a migration that silently granted an allowance would change what a listing shows the
-- moment it ran, before anyone had decided the figure.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ---------------------------------------------------------------- 1. the allowances
IF COL_LENGTH('dbo.plans', 'faq_limit') IS NULL
BEGIN
    ALTER TABLE dbo.plans ADD faq_limit int NOT NULL
        CONSTRAINT plans_faq_limit_default DEFAULT 0;
END
GO

IF COL_LENGTH('dbo.plans', 'content_section_limit') IS NULL
BEGIN
    ALTER TABLE dbo.plans ADD content_section_limit int NOT NULL
        CONSTRAINT plans_content_limit_default DEFAULT 0;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE parent_object_id = OBJECT_ID('dbo.plans')
                 AND name = 'plans_faq_content_limits_not_negative')
BEGIN
    ALTER TABLE dbo.plans WITH CHECK ADD CONSTRAINT plans_faq_content_limits_not_negative
        CHECK (faq_limit >= 0 AND content_section_limit >= 0);
END
GO

-- ---------------------------------------------------------------- 2. the FAQs
IF OBJECT_ID('dbo.listing_faqs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.listing_faqs (
        id          bigint IDENTITY(1,1) NOT NULL CONSTRAINT listing_faqs_pkey PRIMARY KEY,
        listing_id  bigint NOT NULL CONSTRAINT listing_faqs_listing_fk
                        REFERENCES dbo.listings (id) ON DELETE CASCADE,
        question    nvarchar(300) NOT NULL,
        answer      nvarchar(2000) NOT NULL,
        /* What the owner chose, and what decides which survive a downgrade: the view below keeps
           the lowest sort_order first, so the owner's own ordering decides what is kept rather
           than insertion order deciding for them. */
        sort_order  int NOT NULL CONSTRAINT listing_faqs_sort_default DEFAULT 0,
        created_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT listing_faqs_created_default DEFAULT SYSDATETIMEOFFSET(),
        updated_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT listing_faqs_updated_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT listing_faqs_question_not_blank CHECK (LEN(LTRIM(RTRIM(question))) > 0),
        CONSTRAINT listing_faqs_answer_not_blank CHECK (LEN(LTRIM(RTRIM(answer))) > 0)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'listing_faqs_listing_idx' AND object_id = OBJECT_ID('dbo.listing_faqs'))
BEGIN
    CREATE INDEX listing_faqs_listing_idx ON dbo.listing_faqs (listing_id, sort_order, id);
END
GO

-- ---------------------------------------------------------------- 3. the content sections
IF OBJECT_ID('dbo.listing_content_sections', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.listing_content_sections (
        id          bigint IDENTITY(1,1) NOT NULL
                        CONSTRAINT listing_content_sections_pkey PRIMARY KEY,
        listing_id  bigint NOT NULL CONSTRAINT listing_content_sections_listing_fk
                        REFERENCES dbo.listings (id) ON DELETE CASCADE,
        heading     nvarchar(200) NOT NULL,
        /* Plain text, rendered with line breaks preserved. Not HTML: this is written by business
           owners and shown on a public page, so accepting markup would be accepting stored XSS
           from the least-trusted authors on the platform. */
        body        nvarchar(4000) NOT NULL,
        sort_order  int NOT NULL CONSTRAINT listing_content_sections_sort_default DEFAULT 0,
        created_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT listing_content_sections_created_default DEFAULT SYSDATETIMEOFFSET(),
        updated_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT listing_content_sections_updated_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT listing_content_sections_heading_not_blank CHECK (LEN(LTRIM(RTRIM(heading))) > 0),
        CONSTRAINT listing_content_sections_body_not_blank CHECK (LEN(LTRIM(RTRIM(body))) > 0)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'listing_content_sections_listing_idx'
                 AND object_id = OBJECT_ID('dbo.listing_content_sections'))
BEGIN
    CREATE INDEX listing_content_sections_listing_idx
        ON dbo.listing_content_sections (listing_id, sort_order, id);
END
GO

-- ---------------------------------------------------------------- 4. what is visible right now
/* The same shape as listing_visible_media (S0012): number each listing's rows in the owner's own
   order, and show only those within the allowance the entitlement view reports this instant. A
   lapsed plan hides the extras; a renewal brings them straight back; nothing is deleted and no job
   runs. */
CREATE OR ALTER VIEW dbo.listing_visible_faqs
AS
SELECT f.id, f.listing_id, f.question, f.answer, f.sort_order, f.created_at, f.updated_at
FROM (
    SELECT f.*,
           ROW_NUMBER() OVER (PARTITION BY f.listing_id ORDER BY f.sort_order, f.id) AS rank_in_listing
    FROM dbo.listing_faqs f
) f
JOIN dbo.listing_entitlements e ON e.listing_id = f.listing_id
WHERE f.rank_in_listing <= e.faq_limit;
GO

CREATE OR ALTER VIEW dbo.listing_visible_content
AS
SELECT c.id, c.listing_id, c.heading, c.body, c.sort_order, c.created_at, c.updated_at
FROM (
    SELECT c.*,
           ROW_NUMBER() OVER (PARTITION BY c.listing_id ORDER BY c.sort_order, c.id) AS rank_in_listing
    FROM dbo.listing_content_sections c
) c
JOIN dbo.listing_entitlements e ON e.listing_id = c.listing_id
WHERE c.rank_in_listing <= e.content_section_limit;
GO

-- ---------------------------------------------------------------- 5. entitlements carry the new limits
/* listing_entitlements is replaced wholesale with the same definition plus two columns. Every
   existing column keeps its name, position and meaning, so nothing that reads this view has to
   change -- the two views above and the API simply gain something to read. */
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
    CASE WHEN p.grants_verified_badge = 1 THEN 5 ELSE 0 END AS link_limit,
    sub.expires_at                               AS paid_until,
    li.plan_slug                                 AS subscribed_plan_slug,
    -- New in S0020.
    p.faq_limit,
    p.content_section_limit
FROM dbo.listings li
OUTER APPLY (
    SELECT TOP (1) s.plan_slug, s.expires_at
    FROM dbo.subscriptions s
    WHERE s.listing_id = li.id
      AND s.status = 'active'
      AND s.starts_at <= SYSDATETIMEOFFSET()
      AND s.expires_at > SYSDATETIMEOFFSET()
    ORDER BY s.expires_at DESC
) sub
JOIN dbo.plans p ON p.slug = COALESCE(sub.plan_slug, 'free');
GO

-- ---------------------------------------------------------------- what must be true afterwards
IF COL_LENGTH('dbo.plans', 'faq_limit') IS NULL
   OR COL_LENGTH('dbo.plans', 'content_section_limit') IS NULL
   OR OBJECT_ID('dbo.listing_faqs', 'U') IS NULL
   OR OBJECT_ID('dbo.listing_content_sections', 'U') IS NULL
BEGIN
    THROW 51026, 'S0020 did not create the FAQ and content tables and their plan limits.', 1;
END
GO

/* The entitlements view still answers for every listing and still reports the media allowances it
   always did. Replacing a view that the whole API reads is the one risky step in this file, so it
   is checked rather than assumed. */
IF (SELECT COUNT_BIG(*) FROM dbo.listing_entitlements) <> (SELECT COUNT_BIG(*) FROM dbo.listings)
BEGIN
    THROW 51027, 'listing_entitlements no longer returns one row per listing.', 1;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM dbo.listing_entitlements e
    JOIN dbo.plans p ON p.slug = e.effective_plan_slug
    WHERE e.photo_limit = p.photo_limit AND e.video_limit = p.video_limit)
   AND EXISTS (SELECT 1 FROM dbo.listings)
BEGIN
    THROW 51028, 'listing_entitlements no longer reports the plan media allowances.', 1;
END
GO
