-- S0023: the blog.
--
-- The original site had one and this one did not. For a directory it is an acquisition channel:
-- "best biryani in Madhapur" is a page people search for and a listing page cannot be.
--
-- Additive: one new table and one new permission. Nothing existing is altered.
--
-- ONE TABLE, NOT TWO. The original split a post into BlogInfos and BlogContents. A post is one
-- thing an author writes and one thing a reader reads, so it is one row here; splitting it would
-- buy a join and nothing else.
--
-- The body is MARKDOWN, stored as written and rendered on the server. Not HTML: a stored HTML
-- body is stored XSS waiting for an author account to be compromised, and this is the one table
-- in the schema whose contents are published verbatim to the public internet. Markdown is
-- rendered through a renderer that escapes raw HTML, so the worst an author can do is make a page
-- ugly.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.blog_posts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.blog_posts (
        id               bigint IDENTITY(1,1) NOT NULL CONSTRAINT blog_posts_pkey PRIMARY KEY,
        slug             nvarchar(160) NOT NULL,
        title            nvarchar(300) NOT NULL,
        /* The card and the meta description. Separate from the body so a listing page of posts
           does not have to load and truncate every body to render a summary. */
        excerpt          nvarchar(500) NULL,
        body_markdown    nvarchar(max) NOT NULL,
        cover_image_url  nvarchar(500) NULL,
        /* 'draft' until somebody publishes it. Only 'published' posts are public, and the public
           query filters on this and on published_at, so a scheduled post cannot leak early. */
        status           varchar(20) NOT NULL CONSTRAINT blog_posts_status_default DEFAULT 'draft',
        published_at     datetimeoffset(3) NULL,
        /* Who wrote it, by name as it was at the time -- the same rule listing_alerts follows, so
           a byline survives the author's account being removed. */
        author_admin_id  bigint NULL CONSTRAINT blog_posts_author_fk
                             REFERENCES dbo.admin_users (id) ON DELETE SET NULL,
        author_name      nvarchar(200) NOT NULL,
        created_at       datetimeoffset(3) NOT NULL
                             CONSTRAINT blog_posts_created_default DEFAULT SYSDATETIMEOFFSET(),
        updated_at       datetimeoffset(3) NOT NULL
                             CONSTRAINT blog_posts_updated_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT blog_posts_status_check CHECK (status IN ('draft', 'published', 'archived')),
        CONSTRAINT blog_posts_title_not_blank CHECK (LEN(LTRIM(RTRIM(title))) > 0),
        CONSTRAINT blog_posts_body_not_blank CHECK (LEN(LTRIM(RTRIM(body_markdown))) > 0),
        CONSTRAINT blog_posts_author_not_blank CHECK (LEN(LTRIM(RTRIM(author_name))) > 0),
        -- Same slug rule as the rest of the schema.
        CONSTRAINT blog_posts_slug_format CHECK (
            slug COLLATE Latin1_General_CS_AS = LOWER(slug) COLLATE Latin1_General_CS_AS
            AND slug NOT LIKE '%[^a-z0-9-]%'
            AND LEN(slug) > 0
        ),
        /* A published post must have a date. Without this a post could be live with no date to
           sort or display it by, and the public list orders on exactly this column. */
        CONSTRAINT blog_posts_published_has_date CHECK (
            status <> 'published' OR published_at IS NOT NULL
        )
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'blog_posts_slug_idx' AND object_id = OBJECT_ID('dbo.blog_posts'))
BEGIN
    -- The slug is the URL, so it is unique across every post whatever its status: a draft must not
    -- be able to take the address of a published post and break it on publish.
    CREATE UNIQUE INDEX blog_posts_slug_idx ON dbo.blog_posts (slug);
END
GO

/* The public list: published posts, newest first. Filtered, so it indexes only what the public
   page reads and not the drafts. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'blog_posts_published_idx' AND object_id = OBJECT_ID('dbo.blog_posts'))
BEGIN
    CREATE INDEX blog_posts_published_idx ON dbo.blog_posts (published_at DESC)
        WHERE status = 'published';
END
GO

-- ---------------------------------------------------------------- the permission
INSERT INTO dbo.permissions (code, description)
SELECT v.code, v.description
FROM (VALUES
    ('blog.manage', 'Write and publish blog posts')
) AS v(code, description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.permissions p WHERE p.code = v.code);
GO

INSERT INTO dbo.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM dbo.roles r
CROSS JOIN dbo.permissions p
WHERE r.slug = 'super_admin'
  AND NOT EXISTS (
      SELECT 1 FROM dbo.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
GO

-- Writing is editorial work, which is what an admin is for.
INSERT INTO dbo.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM dbo.roles r
JOIN dbo.permissions p ON p.code = 'blog.manage'
WHERE r.slug = 'admin'
  AND NOT EXISTS (
      SELECT 1 FROM dbo.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
GO

IF OBJECT_ID('dbo.blog_posts', 'U') IS NULL
   OR NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE code = 'blog.manage')
BEGIN
    THROW 51032, 'S0023 did not create dbo.blog_posts and the blog.manage permission.', 1;
END
GO
