-- S0018: one row per listing, with its owner, place, category and plan already joined.
--
-- Asked for by the owner on 2026-10-27: a way to read users, all listings, verified listings and
-- free listings without writing the joins each time.
--
-- **Nothing new is stored.** Every column below already exists somewhere; what was missing was the
-- path between them. Getting from a user to their listings takes three hops --
-- users -> business_members -> businesses -> listings -- which is correct (a business can have
-- several members, a person several businesses) but tedious and easy to get subtly wrong.
--
-- A view rather than a table, deliberately. A `verified_listings` table would have to be kept in
-- step with every payment, renewal and expiry, and would be wrong the first time a plan lapsed
-- overnight with nothing running. This reads `listing_entitlements`, which works verification out
-- at read time by comparing the subscription period against the clock, so the answer is correct the
-- moment it is asked and there is nothing to synchronise.
--
-- Additive: one CREATE VIEW. No table is altered, no row is read, written, moved or deleted, and
-- nothing writes to a view, so no existing behaviour can change.
--
-- ONE ROW PER LISTING. That was the explicit requirement, and there are exactly two places this
-- could have gone wrong:
--
--   * business_members has primary key (business_id, user_id), so a business with an owner and a
--     manager would multiply its listings by two under a plain JOIN. It is read through OUTER APPLY
--     TOP (1) instead, picking the longest-standing 'owner' -- the same rule, deliberately, that
--     Notifications/OwnerLookup.cs uses to decide who gets the business's mail.
--   * listing_categories could in principle hold two primary rows, except that
--     listing_categories_one_primary_idx (S0002) is a UNIQUE filtered index on (listing_id) WHERE
--     is_primary = 1. So the LEFT JOIN below cannot duplicate, and that index is what guarantees
--     it rather than this file hoping so.
--
-- Everything else is one-to-one: listing_entitlements is itself one row per listing, and localities,
-- cities and categories are joined on their primary keys.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER VIEW dbo.listing_overview
AS
SELECT
    -- ---- the listing
    li.id                        AS listing_id,
    li.slug                      AS listing_slug,
    li.name                      AS listing_name,
    li.status,
    li.phone_primary,
    li.email                     AS listing_email,
    li.website_url,
    li.address_line,
    li.pincode,
    li.published_at,
    li.created_at,
    li.updated_at,

    /* The public path, built the same way Listings/PublicUrl.cs builds it: /parent/category/slug.
       NULL when the listing has no primary category, because it genuinely has no public page until
       one is set -- which is exactly the kind of thing this view is useful for finding. */
    CASE
        WHEN pc.slug IS NULL OR pcp.slug IS NULL THEN NULL
        ELSE '/' + pcp.slug + '/' + pc.slug + '/' + li.slug
    END                          AS public_url,

    -- ---- who owns it
    b.id                         AS business_id,
    b.name                       AS business_name,
    owner.user_id                AS owner_user_id,
    owner.name                   AS owner_name,
    owner.email                  AS owner_email,
    owner.phone_e164             AS owner_phone,

    -- ---- where it is
    ci.slug                      AS city_slug,
    ci.name                      AS city_name,
    lo.slug                      AS locality_slug,
    lo.name                      AS locality_name,

    -- ---- what it is
    pc.slug                      AS category_slug,
    pc.name                      AS category_name,
    pcp.slug                     AS parent_category_slug,
    pcp.name                     AS parent_category_name,

    /* ---- what it has paid for.
       Straight from listing_entitlements, so this view can never disagree with what the API
       enforces: both read the same computed answer rather than each deciding for themselves. */
    e.is_verified,
    e.effective_plan_slug        AS plan_slug,
    e.effective_plan_name        AS plan_name,
    e.paid_until,
    e.subscribed_plan_slug,
    e.photo_limit,
    e.video_limit,
    e.logo_limit,
    e.link_limit,

    -- ---- editorial
    li.featured_at
FROM dbo.listings li
JOIN dbo.listing_entitlements e ON e.listing_id = li.id
JOIN dbo.businesses b ON b.id = li.business_id
JOIN dbo.localities lo ON lo.id = li.locality_id
JOIN dbo.cities ci ON ci.id = lo.city_id
/* Left, not inner: a listing with no primary category still belongs in the overview. It simply has
   no public URL yet, and finding those is half the point of having this. */
LEFT JOIN dbo.listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
LEFT JOIN dbo.categories pc ON pc.id = lc.category_id
LEFT JOIN dbo.categories pcp ON pcp.id = pc.parent_id
/* One owner, never two. See the note at the top: a JOIN here would multiply a listing by the number
   of people who can manage the business. Oldest 'owner' membership wins; a 'manager' is never
   reported as the owner. */
OUTER APPLY (
    SELECT TOP (1) u.id AS user_id, u.name, u.email, u.phone_e164
    FROM dbo.business_members bm
    JOIN dbo.users u ON u.id = bm.user_id
    WHERE bm.business_id = li.business_id
      AND bm.role = 'owner'
    ORDER BY bm.created_at, u.id
) owner;
GO

-- The view must exist and must be readable; a view that compiles but cannot be selected from is a
-- failure worth catching here rather than in the first query someone writes against it.
IF NOT EXISTS (SELECT 1 FROM sys.views WHERE object_id = OBJECT_ID('dbo.listing_overview'))
BEGIN
    THROW 51023, 'S0018 did not create dbo.listing_overview.', 1;
END
GO

/* The requirement, asserted rather than assumed: exactly as many rows as there are listings. If the
   owner join ever multiplies a row, this fails on the next migration run instead of quietly
   inflating every count taken from the view. */
IF (SELECT COUNT_BIG(*) FROM dbo.listing_overview) <> (SELECT COUNT_BIG(*) FROM dbo.listings)
BEGIN
    THROW 51024, 'dbo.listing_overview does not return exactly one row per listing.', 1;
END
GO
