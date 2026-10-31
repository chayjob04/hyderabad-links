-- S0024: the short lists a business is described by — what it offers, what languages it speaks,
-- and what it has on the premises.
--
-- The original Hyderabad Links held these in three tables: BusinessOffering, LanguagesKnown and
-- ListingAmenities. They are the same shape — a label attached to a listing, in an order somebody
-- chose — so here they are one table with a `kind`. Three tables would have meant three sets of
-- endpoints, three screens and three places to fix the same bug.
--
-- Free, not part of the paid plan. These are what a visitor reads to decide whether to call: a
-- plumber who speaks Telugu, a clinic with parking, a salon that does bridal work. Withholding
-- them would make the directory worse for the person who is not paying for it, which is the same
-- reasoning that put opening hours on every plan (S0019).
--
-- Additive: one new table. Nothing existing is altered.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.listing_attributes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.listing_attributes (
        id          bigint IDENTITY(1,1) NOT NULL CONSTRAINT listing_attributes_pkey PRIMARY KEY,
        listing_id  bigint NOT NULL CONSTRAINT listing_attributes_listing_fk
                        REFERENCES dbo.listings (id) ON DELETE CASCADE,
        /* Which list this belongs to. A CHECK rather than a lookup table: the set changes about
           once a year, and a typo in the API should be a failed insert rather than a fourth list
           nothing renders. */
        kind        varchar(20) NOT NULL,
        -- Short by design. These are chips on a page, not sentences.
        label       nvarchar(80) NOT NULL,
        sort_order  int NOT NULL CONSTRAINT listing_attributes_sort_default DEFAULT 0,
        created_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT listing_attributes_created_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT listing_attributes_kind_check CHECK (kind IN ('offering', 'language', 'amenity')),
        CONSTRAINT listing_attributes_label_not_blank CHECK (LEN(LTRIM(RTRIM(label))) > 0)
    );
END
GO

/* The public page asks for one listing's lists in display order, which is the only read there is. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'listing_attributes_listing_idx'
                 AND object_id = OBJECT_ID('dbo.listing_attributes'))
BEGIN
    CREATE INDEX listing_attributes_listing_idx
        ON dbo.listing_attributes (listing_id, kind, sort_order, id);
END
GO

/* One label per kind per listing. "Parking" twice in the amenities is not a second fact, it is a
   double-click, and the database is the right place to refuse it rather than every caller. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'listing_attributes_unique_idx'
                 AND object_id = OBJECT_ID('dbo.listing_attributes'))
BEGIN
    CREATE UNIQUE INDEX listing_attributes_unique_idx
        ON dbo.listing_attributes (listing_id, kind, label);
END
GO

IF OBJECT_ID('dbo.listing_attributes', 'U') IS NULL
BEGIN
    ;THROW 51033, 'S0024 did not create dbo.listing_attributes.', 1;
END
GO
