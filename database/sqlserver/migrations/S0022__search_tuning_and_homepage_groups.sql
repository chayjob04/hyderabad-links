-- S0022: search synonyms, search placeholders, and named homepage groups.
--
-- Three small things the original site let staff change and this one did not. All three share a
-- shape: a list of rows an admin edits, read at request time, with the application falling back to
-- what it does today when the list is empty.
--
-- Additive: three new tables and one nullable column on `listings`. Nothing existing is altered.
--
-- WHY FALLING BACK MATTERS. Each of these replaces a hardcoded value. If the table is empty — on
-- the day the migration runs, or because somebody deactivated every row — the site must behave
-- exactly as it does now rather than showing an empty search box or a shelf with no name. Every
-- read below is written so that no rows means no change.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ---------------------------------------------------------------- 1. search synonyms
/* What people type, mapped to what the catalogue calls it. "medical shop" -> "pharmacies",
   "petrol bunk" -> "petrol-pumps". The existing trigram and full-text machinery is untouched: the
   term is expanded before the query reaches it, so typo tolerance still applies to the mapped
   word. */
IF OBJECT_ID('dbo.search_synonyms', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.search_synonyms (
        id          int IDENTITY(1,1) NOT NULL CONSTRAINT search_synonyms_pkey PRIMARY KEY,
        -- Stored lower-case; the API lower-cases what it looks up, so the comparison is exact.
        term        nvarchar(100) NOT NULL,
        maps_to     nvarchar(100) NOT NULL,
        is_active   bit NOT NULL CONSTRAINT search_synonyms_active_default DEFAULT 1,
        created_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT search_synonyms_created_default DEFAULT SYSDATETIMEOFFSET(),
        updated_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT search_synonyms_updated_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT search_synonyms_term_not_blank CHECK (LEN(LTRIM(RTRIM(term))) > 0),
        CONSTRAINT search_synonyms_target_not_blank CHECK (LEN(LTRIM(RTRIM(maps_to))) > 0),
        /* A term that maps to itself is a loop with extra steps, and a term equal to its target
           differing only in case would be one too. */
        CONSTRAINT search_synonyms_not_circular CHECK (term <> maps_to)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'search_synonyms_term_idx' AND object_id = OBJECT_ID('dbo.search_synonyms'))
BEGIN
    -- Unique: one meaning per term. Two rows for "chemist" would make the result depend on row order.
    CREATE UNIQUE INDEX search_synonyms_term_idx ON dbo.search_synonyms (term);
END
GO

-- ---------------------------------------------------------------- 2. search placeholders
/* The grey text in the search box. One row is the current behaviour; several let it rotate and
   suggest what the directory actually covers. Empty table means the frontend keeps its own
   default, which is why there is no seed here. */
IF OBJECT_ID('dbo.search_placeholders', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.search_placeholders (
        id          int IDENTITY(1,1) NOT NULL CONSTRAINT search_placeholders_pkey PRIMARY KEY,
        text        nvarchar(120) NOT NULL,
        sort_order  int NOT NULL CONSTRAINT search_placeholders_sort_default DEFAULT 0,
        is_active   bit NOT NULL CONSTRAINT search_placeholders_active_default DEFAULT 1,
        created_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT search_placeholders_created_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT search_placeholders_text_not_blank CHECK (LEN(LTRIM(RTRIM(text))) > 0)
    );
END
GO

-- ---------------------------------------------------------------- 3. homepage groups
/* The original did not have one Featured shelf, it had named ones: "Best Cafes in Madhapur" and
   so on. A group is editorial, so it is a row with a title somebody wrote.

   S0017's single shelf stays exactly as it is. A listing with featured_at set and no group lands
   in the default shelf, which is what every currently-featured listing does. Nothing moves. */
IF OBJECT_ID('dbo.homepage_groups', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.homepage_groups (
        id          int IDENTITY(1,1) NOT NULL CONSTRAINT homepage_groups_pkey PRIMARY KEY,
        slug        nvarchar(80) NOT NULL,
        title       nvarchar(160) NOT NULL,
        subtitle    nvarchar(300) NULL,
        sort_order  int NOT NULL CONSTRAINT homepage_groups_sort_default DEFAULT 0,
        is_active   bit NOT NULL CONSTRAINT homepage_groups_active_default DEFAULT 1,
        created_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT homepage_groups_created_default DEFAULT SYSDATETIMEOFFSET(),
        updated_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT homepage_groups_updated_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT homepage_groups_title_not_blank CHECK (LEN(LTRIM(RTRIM(title))) > 0),
        -- Same slug rule the rest of the schema uses: lower-case, digits and hyphens.
        CONSTRAINT homepage_groups_slug_format CHECK (
            slug COLLATE Latin1_General_CS_AS = LOWER(slug) COLLATE Latin1_General_CS_AS
            AND slug NOT LIKE '%[^a-z0-9-]%'
            AND LEN(slug) > 0
        )
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'homepage_groups_slug_idx' AND object_id = OBJECT_ID('dbo.homepage_groups'))
BEGIN
    CREATE UNIQUE INDEX homepage_groups_slug_idx ON dbo.homepage_groups (slug);
END
GO

/* Nullable, and null means the default shelf. ON DELETE SET NULL so removing a group returns its
   listings to that shelf rather than un-featuring businesses somebody chose. */
IF COL_LENGTH('dbo.listings', 'homepage_group_id') IS NULL
BEGIN
    ALTER TABLE dbo.listings ADD homepage_group_id int NULL
        CONSTRAINT listings_homepage_group_fk
            REFERENCES dbo.homepage_groups (id) ON DELETE SET NULL;
END
GO

IF OBJECT_ID('dbo.search_synonyms', 'U') IS NULL
   OR OBJECT_ID('dbo.search_placeholders', 'U') IS NULL
   OR OBJECT_ID('dbo.homepage_groups', 'U') IS NULL
   OR COL_LENGTH('dbo.listings', 'homepage_group_id') IS NULL
BEGIN
    THROW 51030, 'S0022 did not create the search tuning and homepage group objects.', 1;
END
GO

/* Nothing currently featured may have been disturbed. Every listing that was on the shelf before
   this ran is still on it, in the default group. */
IF EXISTS (SELECT 1 FROM dbo.listings WHERE featured_at IS NOT NULL AND homepage_group_id IS NOT NULL)
BEGIN
    THROW 51031, 'S0022 moved an already-featured listing into a group. It should have left it alone.', 1;
END
GO
