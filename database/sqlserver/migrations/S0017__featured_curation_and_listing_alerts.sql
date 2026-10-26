-- S0017: a curated Featured shelf, and a way to tell an owner their listing needs fixing.
--
-- Two things the owner asked for on 2026-10-27, in one migration because both are additive and
-- neither touches existing data:
--
--   1. Featured becomes a *choice*. It was "every listing with a paid Verified period running",
--      which made the homepage shelf a list of whoever had paid -- useful, but not something anyone
--      could curate, and it put the same eight businesses there until one lapsed. A nullable
--      `featured_at` on `listings` makes it a decision a super admin records. Trending is
--      unchanged: it is still counted from real events at read time, which is the half of the
--      homepage that must never be hand-picked.
--
--   2. `listing_alerts`: a message from staff to an owner asking them to correct something. The
--      `notifications` table is a log of *delivery attempts* and cannot serve as this -- a failed
--      email would lose the message itself. The alert is stored here and is visible in the owner's
--      dashboard whether or not the email ever arrives, which is the point.
--
-- Additive only. One new table, two new columns, two new permission rows, one widened CHECK. No row
-- is updated or deleted, so nothing featured, published, paid for or sent changes.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ---------------------------------------------------------------- 1. Featured, as a decision
/* Null means "not featured", which is every existing listing: the shelf starts empty rather than
   inheriting the old automatic membership. That is deliberate. Silently promoting whoever happened
   to be paying would present an automatic list as a curated one, and nobody would know which
   businesses the platform had chosen to recommend.

   The timestamp doubles as the ordering (newest choice first) and as the record of when the choice
   was made, so no separate position column has to be reshuffled every time the shelf changes. */
IF COL_LENGTH('dbo.listings', 'featured_at') IS NULL
BEGIN
    ALTER TABLE dbo.listings ADD featured_at datetimeoffset(3) NULL;
END
GO

/* Who chose it. ON DELETE SET NULL, because an admin account being removed must not un-feature a
   business or block that account from being deleted -- the same rule the audit log follows. */
IF COL_LENGTH('dbo.listings', 'featured_by_admin_id') IS NULL
BEGIN
    ALTER TABLE dbo.listings ADD featured_by_admin_id bigint NULL
        CONSTRAINT listings_featured_by_fk REFERENCES dbo.admin_users (id) ON DELETE SET NULL;
END
GO

/* Filtered, so it indexes the handful of featured rows and not the thousands that are not. This is
   the homepage's own query, so it is the one that has to stay fast as the directory grows. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'listings_featured_idx' AND object_id = OBJECT_ID('dbo.listings'))
BEGIN
    CREATE INDEX listings_featured_idx ON dbo.listings (featured_at DESC)
        WHERE featured_at IS NOT NULL;
END
GO

-- ---------------------------------------------------------------- 2. Alerts to owners
IF OBJECT_ID('dbo.listing_alerts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.listing_alerts (
        id              bigint IDENTITY(1,1) NOT NULL CONSTRAINT listing_alerts_pkey PRIMARY KEY,
        /* The listing the alert is about. Cascades: an alert about a deleted listing is noise, and
           the listing is the only thing that makes the message mean anything. */
        listing_id      bigint NOT NULL CONSTRAINT listing_alerts_listing_fk
                            REFERENCES dbo.listings (id) ON DELETE CASCADE,
        /* Who sent it. Kept when the admin account goes away, like the audit log: who said what to
           an owner is history, and history does not leave with a staff account. */
        admin_user_id   bigint NULL CONSTRAINT listing_alerts_admin_fk
                            REFERENCES dbo.admin_users (id) ON DELETE SET NULL,
        /* The admin's name as it was when they wrote, so the owner still sees who wrote to them
           after that account is renamed or removed. */
        sent_by_name    nvarchar(200) NOT NULL,
        /* What needs fixing, in the admin's own words. Long enough for a real explanation, and
           capped so the column cannot be used to store a file. */
        message         nvarchar(2000) NOT NULL,
        /* Why they are being written to. The CHECK is the list the UI offers, so a typo in the API
           cannot invent a reason nobody has words for. */
        reason          varchar(30) NOT NULL CONSTRAINT listing_alerts_reason_default DEFAULT 'other',
        /* Set when the owner marks it read. Null is an open alert, which is what the dashboard
           counts and what the listing card shows a flag for. */
        acknowledged_at datetimeoffset(3) NULL,
        created_at      datetimeoffset(3) NOT NULL
                            CONSTRAINT listing_alerts_created_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT listing_alerts_message_not_blank CHECK (LEN(LTRIM(RTRIM(message))) > 0),
        CONSTRAINT listing_alerts_sent_by_not_blank CHECK (LEN(LTRIM(RTRIM(sent_by_name))) > 0),
        CONSTRAINT listing_alerts_reason_check CHECK (reason IN (
            'incorrect_details',
            'missing_information',
            'wrong_category',
            'photo_problem',
            'policy',
            'other'
        ))
    );
END
GO

/* The owner's dashboard asks "what is open on this listing", so that is the index. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'listing_alerts_listing_idx' AND object_id = OBJECT_ID('dbo.listing_alerts'))
BEGIN
    CREATE INDEX listing_alerts_listing_idx ON dbo.listing_alerts (listing_id, created_at DESC);
END
GO

-- ---------------------------------------------------------------- 3. The permissions
-- Format rule from S0010: lower-case letters, underscores and dots only, and at least one dot.
INSERT INTO dbo.permissions (code, description)
SELECT v.code, v.description
FROM (VALUES
    ('listings.alert',   'Send a correction request to a business owner'),
    ('listings.feature', 'Choose which listings appear on the homepage Featured shelf')
) AS v(code, description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.permissions p WHERE p.code = v.code);
GO

-- The super admin holds everything there is, including both codes above. Same CROSS JOIN as R003.
INSERT INTO dbo.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM dbo.roles r
CROSS JOIN dbo.permissions p
WHERE r.slug = 'super_admin'
  AND NOT EXISTS (
      SELECT 1 FROM dbo.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
GO

/* The ordinary admin gains listings.alert and nothing else. Writing to an owner is exactly the work
   an admin is for -- they are the ones reading the queue who find the wrong phone number -- while
   choosing who the platform recommends on its own homepage is not moderation, so listings.feature
   stays super-admin only. */
INSERT INTO dbo.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM dbo.roles r
JOIN dbo.permissions p ON p.code = 'listings.alert'
WHERE r.slug = 'admin'
  AND NOT EXISTS (
      SELECT 1 FROM dbo.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
GO

-- ---------------------------------------------------------------- 4. The email that carries it
-- Same approach as S0013: the constraint is found by its definition, not its name, because this
-- database's constraints carry system-generated names rather than the ones S0007 wrote.
DECLARE @name sysname = (
    SELECT TOP (1) cc.name
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id = OBJECT_ID('dbo.notifications')
      AND cc.definition LIKE '%enquiry_received%');

IF @name IS NULL
BEGIN
    PRINT 'S0017 note: no existing kind constraint matched; adding the new one only.';
END
ELSE
BEGIN
    DECLARE @drop nvarchar(400) =
        N'ALTER TABLE dbo.notifications DROP CONSTRAINT ' + QUOTENAME(@name) + N';';
    EXEC sp_executesql @drop;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.notifications') AND name = 'notifications_kind_check')
BEGIN
    ALTER TABLE dbo.notifications WITH CHECK ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
        'enquiry_received',
        'listing_approved',
        'listing_rejected',
        'subscription_activated',
        'listing_alert'
    ));
END;
GO

-- ---------------------------------------------------------------- what must be true afterwards
IF NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE code = 'listings.alert')
   OR NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE code = 'listings.feature')
BEGIN
    THROW 51020, 'S0017 did not create the listings.alert and listings.feature permissions.', 1;
END
GO

/* The one grant that would be a hole if it went the wrong way: an ordinary admin must be able to
   write to an owner, and must not be able to choose the homepage. */
IF NOT EXISTS (
    SELECT 1 FROM dbo.roles r
    JOIN dbo.role_permissions rp ON rp.role_id = r.id
    JOIN dbo.permissions p ON p.id = rp.permission_id
    WHERE r.slug = 'admin' AND p.code = 'listings.alert')
BEGIN
    THROW 51021, 'S0017 did not grant listings.alert to the admin role.', 1;
END
GO

IF EXISTS (
    SELECT 1 FROM dbo.roles r
    JOIN dbo.role_permissions rp ON rp.role_id = r.id
    JOIN dbo.permissions p ON p.id = rp.permission_id
    WHERE r.slug = 'admin' AND p.code = 'listings.feature')
BEGIN
    THROW 51022, 'The admin role holds listings.feature. Choosing the homepage is super-admin work.', 1;
END
GO
