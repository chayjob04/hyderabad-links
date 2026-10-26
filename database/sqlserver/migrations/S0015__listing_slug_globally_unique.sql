-- S0015: a listing slug becomes unique across the whole directory.
--
-- Public URLs move from /city/locality/category/slug to /category/subcategory/slug, so the slug is
-- no longer qualified by an area. `listings_locality_slug_key` (UNIQUE (locality_id, slug)) allowed
-- a "Garden Cafe" in Madhapur and another in Banjara Hills to share the slug `garden-cafe` --
-- correct under the old URL, a collision under /food/cafes/garden-cafe where only one of them can
-- answer.
--
-- Unique on the slug alone rather than on (category, slug): a listing's primary category lives in
-- dbo.listing_categories, so a per-category rule cannot be a constraint on this table at all
-- without denormalising it here. Global uniqueness is simpler, needs no new column, and is strictly
-- stronger -- and "two businesses with the same name get garden-cafe and garden-cafe-2" is ordinary
-- directory behaviour.
--
-- Nothing is dropped. The old per-locality constraint stays: it is implied by this one and removing
-- it would be a destructive change for no gain. ListingWriter.ChooseSlug now asks the same question
-- globally, so the two agree.
--
-- The guard below is the point of this script. CREATE UNIQUE INDEX fails with a bare "duplicate key"
-- if any slug repeats, naming neither the slug nor the listings; this reports them first and stops
-- with something a person can act on. At the time of writing: 3 listings, 0 repeated slugs.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF EXISTS (SELECT 1 FROM dbo.listings GROUP BY slug HAVING COUNT_BIG(*) > 1)
BEGIN
    DECLARE @clashes nvarchar(max) =
        (SELECT STRING_AGG(CAST(x.slug AS nvarchar(max)), ', ')
         FROM (SELECT TOP (20) slug FROM dbo.listings GROUP BY slug HAVING COUNT_BIG(*) > 1) x);

    DECLARE @message nvarchar(2048) =
        N'Cannot make listing slugs unique: these repeat and must be renamed first -> ' + ISNULL(@clashes, N'(none listed)');

    THROW 51016, @message, 1;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'listings_slug_key' AND object_id = OBJECT_ID('dbo.listings'))
BEGIN
    CREATE UNIQUE INDEX listings_slug_key ON dbo.listings (slug);
END
GO

-- Prove it, rather than trusting the statement above.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'listings_slug_key' AND object_id = OBJECT_ID('dbo.listings') AND is_unique = 1)
BEGIN
    THROW 51017, 'S0015 did not leave a unique index on dbo.listings (slug).', 1;
END
GO
