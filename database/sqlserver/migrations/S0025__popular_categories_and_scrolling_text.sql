-- S0025: the two things the original let staff curate on the homepage — which categories lead it,
-- and what the strip across the top says.
--
-- Both existed in the original Hyderabad Links and neither had an equivalent here. The homepage
-- category shelf was ordered by `sort_order`, which is also what orders the category *tree*, so
-- changing what leads the homepage meant reordering the whole directory. The strip was derived from
-- the category tree in code, which made it unchangeable without a deploy.
--
--   categories.is_popular   — the original's `Is Popular` flag. A flag rather than a second table
--                             of ids: there is exactly one homepage, and a join table for a boolean
--                             would be a row nobody can see to delete when a category is retired.
--                             Ordering within the popular set reuses `sort_order`, which staff can
--                             already edit, so this adds one column rather than two.
--
--   dbo.scrolling_texts     — the original's `scrolling_texts`: a line of text, optionally a link,
--                             in an order somebody chose. `url` is nullable because an announcement
--                             with nowhere to go is a legitimate announcement.
--
-- Additive: one new nullable-with-default column and one new table. Nothing existing is altered or
-- removed, and both features fall back to today's behaviour while the tables are empty — no
-- category is popular until somebody marks one, and the strip keeps scrolling the category tree
-- until somebody writes a line.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 1. Which categories lead the homepage.
IF COL_LENGTH('dbo.categories', 'is_popular') IS NULL
BEGIN
    ALTER TABLE dbo.categories ADD is_popular bit NOT NULL
        CONSTRAINT categories_is_popular_default DEFAULT 0;
END
GO

/* Filtered rather than whole-table: the homepage reads only the handful of rows that are flagged,
   and a filtered index keeps that read off the rest of the directory. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'categories_popular_idx' AND object_id = OBJECT_ID('dbo.categories'))
BEGIN
    CREATE INDEX categories_popular_idx ON dbo.categories (sort_order, id)
        WHERE is_popular = 1 AND is_active = 1;
END
GO

-- 2. The strip across the top of the public site.
IF OBJECT_ID('dbo.scrolling_texts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.scrolling_texts (
        id          int IDENTITY(1,1) NOT NULL CONSTRAINT scrolling_texts_pkey PRIMARY KEY,
        -- One line on a moving strip. Long enough for a sentence, short enough that it cannot
        -- become an article nobody can read at that speed.
        message     nvarchar(200) NOT NULL,
        /* Where the line goes, or NULL for a line that is only an announcement. Site-relative on
           purpose: this text is written in an admin panel and rendered on the public site, so
           allowing an arbitrary scheme here would put an open redirect — and `javascript:` — one
           careless paste away. The CHECK is the control; the API validates it again. */
        url         nvarchar(300) NULL,
        sort_order  int NOT NULL CONSTRAINT scrolling_texts_sort_default DEFAULT 0,
        is_active   bit NOT NULL CONSTRAINT scrolling_texts_active_default DEFAULT 1,
        created_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT scrolling_texts_created_default DEFAULT SYSDATETIMEOFFSET(),
        updated_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT scrolling_texts_updated_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT scrolling_texts_message_not_blank CHECK (LEN(LTRIM(RTRIM(message))) > 0),
        CONSTRAINT scrolling_texts_url_site_relative CHECK (
            url IS NULL
            OR (LEFT(url, 1) = '/' AND LEFT(url, 2) <> '//' AND LEN(LTRIM(RTRIM(url))) > 1)
        )
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'scrolling_texts_order_idx' AND object_id = OBJECT_ID('dbo.scrolling_texts'))
BEGIN
    CREATE INDEX scrolling_texts_order_idx ON dbo.scrolling_texts (sort_order, id)
        WHERE is_active = 1;
END
GO

/* The permission that gates both screens. One code, not two: they are the same job — deciding what
   the homepage says — and a second permission would mean a role that can curate half of it. */
IF NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE code = 'homepage.manage')
BEGIN
    INSERT INTO dbo.permissions (code, description)
    VALUES ('homepage.manage', 'Choose the categories that lead the homepage and edit the scrolling strip');
END
GO

/* Granted to the `admin` role, the same way S0021 granted seo.manage and S0023 granted
   blog.manage. Curating the homepage is the admin's job in the original too; leaving it granted to
   nobody would ship a screen that nothing could open. Super admin is unaffected — it is not gated
   on role_permissions. */
INSERT INTO dbo.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM dbo.roles r
JOIN dbo.permissions p ON p.code = 'homepage.manage'
WHERE r.slug = 'admin'
  AND NOT EXISTS (
      SELECT 1 FROM dbo.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
GO

-- Fail loudly rather than journalling a migration that did nothing, as every migration here does.
IF COL_LENGTH('dbo.categories', 'is_popular') IS NULL
   OR OBJECT_ID('dbo.scrolling_texts', 'U') IS NULL
   OR NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE code = 'homepage.manage')
BEGIN
    THROW 51034, 'S0025 did not create categories.is_popular, dbo.scrolling_texts and homepage.manage.', 1;
END
GO
