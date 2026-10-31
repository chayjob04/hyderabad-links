-- S0021: page titles and descriptions that staff can edit.
--
-- Organic search is how a directory is found, and until now not one page title could be changed
-- without a deploy. The original site had six admin screens for this; one table serves the same
-- purpose here.
--
-- Additive: one new table. Nothing existing is altered.
--
-- AN OVERRIDE, NEVER A REQUIREMENT. Every page keeps the metadata the application derives today.
-- A row here replaces it; no row means nothing changes. That is what makes this safe to ship
-- before anyone has written a single override, and it means a page can never end up with an empty
-- title because somebody deleted a row.
--
-- `entity_type` + `entity_id` rather than a column per kind, because the set of page kinds grows
-- (segments, tags, whatever comes next) and a new kind should not need a migration. The CHECK
-- keeps the column honest: a typo cannot invent a page type nothing renders.
--
-- Static pages (home, terms, privacy, help) use entity_type 'static' with entity_id 0 and a
-- `page_key` instead, because they have no row anywhere to point at.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.page_meta', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.page_meta (
        id               bigint IDENTITY(1,1) NOT NULL CONSTRAINT page_meta_pkey PRIMARY KEY,
        entity_type      varchar(20) NOT NULL,
        /* 0 for a static page, whose identity is `page_key`. Not nullable, because a nullable
           column in a unique key behaves differently across databases and this one must be exact. */
        entity_id        bigint NOT NULL CONSTRAINT page_meta_entity_id_default DEFAULT 0,
        page_key         varchar(60) NULL,
        meta_title       nvarchar(200) NULL,
        meta_description nvarchar(400) NULL,
        /* Kept because the original stored them and some staff still write them. Google ignores
           the keywords meta tag; this is recorded so nobody expects otherwise. */
        meta_keywords    nvarchar(400) NULL,
        /* An image for the link preview, overriding the one the page would choose for itself. */
        og_image_url     nvarchar(500) NULL,
        /* Withhold a thin page from search without deleting it. The sitemap and the page's robots
           tag both read this, so the two cannot disagree. */
        noindex          bit NOT NULL CONSTRAINT page_meta_noindex_default DEFAULT 0,
        updated_by_admin_id bigint NULL CONSTRAINT page_meta_admin_fk
                                REFERENCES dbo.admin_users (id) ON DELETE SET NULL,
        created_at       datetimeoffset(3) NOT NULL
                             CONSTRAINT page_meta_created_default DEFAULT SYSDATETIMEOFFSET(),
        updated_at       datetimeoffset(3) NOT NULL
                             CONSTRAINT page_meta_updated_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT page_meta_entity_type_check CHECK (entity_type IN (
            'listing',
            'category',
            'locality',
            'static'
        )),
        /* A static page is identified by its key and nothing else; everything else is identified
           by its id and must not carry a key. Enforced here so the two addressing schemes cannot
           be mixed in one row. */
        CONSTRAINT page_meta_static_has_key CHECK (
            (entity_type = 'static' AND page_key IS NOT NULL AND entity_id = 0)
            OR (entity_type <> 'static' AND page_key IS NULL AND entity_id > 0)
        ),
        /* An override that sets nothing is a row that does nothing but shadow the derived value.
           At least one field has to be present. */
        CONSTRAINT page_meta_not_empty CHECK (
            meta_title IS NOT NULL OR meta_description IS NOT NULL
            OR meta_keywords IS NOT NULL OR og_image_url IS NOT NULL OR noindex = 1
        )
    );
END
GO

/* One override per page. The lookup is always "this exact page", so the unique index is also the
   index the read uses. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'page_meta_entity_idx' AND object_id = OBJECT_ID('dbo.page_meta'))
BEGIN
    CREATE UNIQUE INDEX page_meta_entity_idx
        ON dbo.page_meta (entity_type, entity_id, page_key);
END
GO

-- ---------------------------------------------------------------- the permission to edit it
-- Format rule from S0010: lower-case letters, underscores and dots, at least one dot.
INSERT INTO dbo.permissions (code, description)
SELECT v.code, v.description
FROM (VALUES
    ('seo.manage', 'Edit page titles, descriptions and indexing')
) AS v(code, description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.permissions p WHERE p.code = v.code);
GO

-- The super admin holds everything there is. Same CROSS JOIN as R003.
INSERT INTO dbo.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM dbo.roles r
CROSS JOIN dbo.permissions p
WHERE r.slug = 'super_admin'
  AND NOT EXISTS (
      SELECT 1 FROM dbo.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
GO

/* The ordinary admin gains it too. Writing a page title is editorial work of exactly the kind an
   admin already does on categories and localities, and withholding it would mean every title
   change waited on a super admin. */
INSERT INTO dbo.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM dbo.roles r
JOIN dbo.permissions p ON p.code = 'seo.manage'
WHERE r.slug = 'admin'
  AND NOT EXISTS (
      SELECT 1 FROM dbo.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
GO

IF OBJECT_ID('dbo.page_meta', 'U') IS NULL
   OR NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE code = 'seo.manage')
BEGIN
    THROW 51029, 'S0021 did not create dbo.page_meta and the seo.manage permission.', 1;
END
GO
