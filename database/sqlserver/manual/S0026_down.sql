-- Undo S0026__customer_identity.sql. Run by hand; see README.md in this folder.
--
-- Safe only while S0027 has not run. It rebuilds the original constraints from `user_id`, which
-- S0027 drops, and it refuses outright if the new API has already written rows that have no
-- `user_id` to rebuild from -- deleting those would be deleting somebody's favourites and reviews.
--
-- Like S0026 itself, nothing here trusts a constraint name it did not create. The live database's
-- primary keys and foreign keys carry server-generated names, so anything S0026 did not add is
-- found in `sys` by what it is.
--
-- One thing this does not restore: the primary key on `favourites` comes back as
-- `favourites_pkey`, not under whatever generated name it had before. The columns and the
-- behaviour are identical; only the label differs.
--
-- approved-destructive: D56 -- the rollback for S0026. It drops the customer tables and columns it
-- created, after refusing if any row depends on them.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF EXISTS (SELECT 1 FROM dbo.favourites WHERE user_id IS NULL)
   OR EXISTS (SELECT 1 FROM dbo.reviews WHERE user_id IS NULL)
BEGIN
    THROW 51037, 'Rows written by the new API have no user_id. Fix forward, or restore from an export.', 1;
END
GO

-- ---------------------------------------------------------------- favourites
DROP INDEX IF EXISTS favourites_user_listing_uq ON dbo.favourites;
DROP INDEX IF EXISTS favourites_customer_listing_uq ON dbo.favourites;
DROP INDEX IF EXISTS favourites_customer_idx ON dbo.favourites;
DROP INDEX IF EXISTS favourites_user_idx ON dbo.favourites;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'favourites_one_owner')
    ALTER TABLE dbo.favourites DROP CONSTRAINT favourites_one_owner;
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'favourites_customer_fk')
    ALTER TABLE dbo.favourites DROP CONSTRAINT favourites_customer_fk;
GO
ALTER TABLE dbo.favourites DROP COLUMN customer_id;
GO
ALTER TABLE dbo.favourites ALTER COLUMN user_id bigint NOT NULL;
GO
ALTER TABLE dbo.favourites ADD CONSTRAINT favourites_pkey PRIMARY KEY (user_id, listing_id);
CREATE INDEX favourites_user_idx ON dbo.favourites (user_id, created_at DESC);
GO

-- ------------------------------------------------------------------- reviews
DROP INDEX IF EXISTS reviews_user_listing_uq ON dbo.reviews;
DROP INDEX IF EXISTS reviews_customer_listing_uq ON dbo.reviews;
DROP INDEX IF EXISTS reviews_customer_idx ON dbo.reviews;
DROP INDEX IF EXISTS reviews_user_idx ON dbo.reviews;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'reviews_one_author')
    ALTER TABLE dbo.reviews DROP CONSTRAINT reviews_one_author;
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'reviews_customer_fk')
    ALTER TABLE dbo.reviews DROP CONSTRAINT reviews_customer_fk;
GO
ALTER TABLE dbo.reviews DROP COLUMN customer_id;
GO
ALTER TABLE dbo.reviews ALTER COLUMN user_id bigint NOT NULL;
GO
ALTER TABLE dbo.reviews ADD CONSTRAINT reviews_one_per_person UNIQUE (listing_id, user_id);
CREATE INDEX reviews_user_idx ON dbo.reviews (user_id);
GO

-- ------------------------------------------------------------------- reports
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'reports_reported_by_customer_fk')
    ALTER TABLE dbo.reports DROP CONSTRAINT reports_reported_by_customer_fk;
GO
ALTER TABLE dbo.reports DROP COLUMN reported_by_customer_id;
GO

-- ---------------------------------------------------------------- audit_logs
-- Customer rows become unrepresentable, so they are relabelled rather than deleted: an audit trail
-- that loses entries on a rollback is not an audit trail.
UPDATE dbo.audit_logs SET actor_type = 'system' WHERE actor_type = 'customer';
GO
DECLARE @actorCheck sysname = (
    SELECT TOP (1) cc.name
    FROM sys.check_constraints cc
    JOIN sys.columns col ON col.object_id = cc.parent_object_id AND col.column_id = cc.parent_column_id
    WHERE cc.parent_object_id = OBJECT_ID('dbo.audit_logs') AND col.name = 'actor_type');
IF @actorCheck IS NOT NULL
BEGIN
    DECLARE @dropActor nvarchar(400) =
        N'ALTER TABLE dbo.audit_logs DROP CONSTRAINT ' + QUOTENAME(@actorCheck) + N';';
    EXEC sp_executesql @dropActor;
END;
GO
ALTER TABLE dbo.audit_logs WITH CHECK ADD CONSTRAINT audit_logs_actor_type_check
    CHECK (actor_type IN ('owner', 'admin', 'system'));
GO

-- ------------------------------------------------------------- otp_challenges
-- Any customer_login rows are historic challenges, not accounts; they are deleted so the old
-- check constraint can be restored. No session and no identity depends on them.
DELETE FROM dbo.otp_challenges WHERE purpose = 'customer_login';
GO
DECLARE @purposeCheck sysname = (
    SELECT TOP (1) cc.name
    FROM sys.check_constraints cc
    JOIN sys.columns col ON col.object_id = cc.parent_object_id AND col.column_id = cc.parent_column_id
    WHERE cc.parent_object_id = OBJECT_ID('dbo.otp_challenges') AND col.name = 'purpose');
IF @purposeCheck IS NOT NULL
BEGIN
    DECLARE @dropPurpose nvarchar(400) =
        N'ALTER TABLE dbo.otp_challenges DROP CONSTRAINT ' + QUOTENAME(@purposeCheck) + N';';
    EXEC sp_executesql @dropPurpose;
END;
GO
ALTER TABLE dbo.otp_challenges WITH CHECK ADD CONSTRAINT otp_challenges_purpose_check
    CHECK (purpose IN ('owner_login'));
GO

-- ------------------------------------------------------------------ identity
DROP TABLE dbo.customer_sessions;
GO
DROP TABLE dbo.customers;
GO
