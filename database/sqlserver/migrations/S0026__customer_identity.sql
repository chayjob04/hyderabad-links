-- S0026: a separate identity for customers.
--
-- Until now one `users` row was both "somebody who saves a business" and "somebody who owns one",
-- because verifying an OTP upserted that row whichever tab you came from. A customer therefore
-- became a business account by accident of signing in. This splits the two apart:
--
--     users      business owners      -> business_members, listings, user_sessions   (unchanged)
--     customers  everybody else       -> favourites, reviews, customer_sessions      (new)
--
-- The same mobile number may exist in BOTH tables. That is the point, not a conflict: a shop owner
-- who also saves other businesses has two accounts and signs in to each separately.
--
-- This migration is additive and is safe to run while the OLD API is still serving. `favourites`
-- and `reviews` end up with both `user_id` and `customer_id` nullable and exactly one of them set,
-- so an old instance writing user_id and a new instance writing customer_id can overlap during a
-- deployment. S0027 (in database/sqlserver/manual/) removes `user_id` once the new API is verified;
-- until it runs, S0026 can be undone with manual/S0026_down.sql.
--
-- Nothing is deleted here. Every existing favourite and review keeps its row and gains a
-- customer_id pointing at a customer created from the user it already belonged to.
--
-- ---------------------------------------------------------------------------------------------
-- WHY SO MUCH OF THIS IS DYNAMIC SQL
--
-- The live database's object names are not the ones these scripts declare. Its schema was applied
-- by hand and adopted into the DbUp journal by `npm run db:baseline`, so across that database 56
-- primary keys, 31 foreign keys and 129 defaults carry server-generated names like
-- `PK__favourit__E123B678E7D5A97B`, while CHECK constraints and indexes happen to be named
-- correctly. `ALTER TABLE dbo.favourites DROP CONSTRAINT favourites_pkey` therefore fails there and
-- succeeds on a database built from these migrations.
--
-- So every constraint this migration drops is found in `sys` by what it *is* -- the primary key of
-- this table, the check on this column, the foreign key on this column -- and never by the name it
-- is assumed to have. That makes the script correct on both. S0013 and S0017 already did this for
-- one constraint each; this does it throughout.
--
-- While it is in there, it also renames the two foreign keys it has to touch to the canonical
-- `favourites_user_fk` and `reviews_user_fk`, so S0027 can find them deterministically afterwards.
--
-- ---------------------------------------------------------------------------------------------
-- AND WHY EVERY NAME IS PREFIXED dbo.
--
-- The production login's default schema is **not dbo**. It is `hyderab3_workingmodeluser`, while
-- all 103 existing tables are in `dbo`. Reading and altering an existing table unqualified still
-- works, because SQL Server falls back to dbo when the name is not in the default schema -- but
-- CREATE does no such thing. `CREATE TABLE customers` puts the table in the *login's* schema, and
-- the first run of this migration did exactly that: everything else succeeded, `dbo.customers` did
-- not exist, and the assertion at the bottom threw 51036 and rolled the whole thing back.
--
-- That is the assertion earning its place. Every object here is therefore schema-qualified, which
-- is also why the earlier migrations got away without it: they were never executed by this login.
-- The schema was built by hand and adopted into the journal by `db:baseline`, so S0026 is the first
-- script this login has actually run.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ------------------------------------------------------------------ customers
-- Deliberately the same shape as `users`, including the three check constraints, because a customer
-- is the same kind of thing: a person identified by a verified phone number. What differs is what
-- may point at it.
--
-- The types match the LIVE `users` table (nvarchar), not what S0002 declares (varchar). The live
-- schema is the one these two tables will be joined against -- `customers.phone_e164` is compared
-- with `users.phone_e164` every time somebody is checked for owning the business they are reviewing
-- -- and a cross-type comparison on every one of those is worth avoiding. On a database built from
-- S0002 this makes `customers` the nvarchar one and `users` the varchar one; the comparison still
-- works, and the live database is the one that matters.
CREATE TABLE dbo.customers (
    id                 bigint IDENTITY(1,1) NOT NULL CONSTRAINT customers_pkey PRIMARY KEY,
    phone_e164         nvarchar(20) NOT NULL,
    phone_verified_at  datetimeoffset(3) NULL,
    name               nvarchar(200) NULL,
    email              nvarchar(254) NULL,
    email_verified_at  datetimeoffset(3) NULL,
    status             nvarchar(20) NOT NULL CONSTRAINT customers_status_default DEFAULT 'active',
    created_at         datetimeoffset(3) NOT NULL CONSTRAINT customers_created_default DEFAULT SYSDATETIMEOFFSET(),
    updated_at         datetimeoffset(3) NOT NULL CONSTRAINT customers_updated_default DEFAULT SYSDATETIMEOFFSET(),
    -- Unique within customers only. The same number existing in `users` as well is intended.
    CONSTRAINT customers_phone_key UNIQUE (phone_e164),
    CONSTRAINT customers_phone_format CHECK (
        phone_e164 LIKE '+[1-9]%'
        AND LEN(phone_e164) BETWEEN 9 AND 16
        AND SUBSTRING(phone_e164, 2, LEN(phone_e164)) NOT LIKE '%[^0-9]%'
    ),
    CONSTRAINT customers_status_check CHECK (status IN ('active', 'suspended', 'deleted'))
);
GO

-- ---------------------------------------------------------- customer_sessions
-- The mirror of user_sessions, with the same rotating-family rule: each use rotates the token, and
-- presenting an already-rotated one revokes the whole family as theft. A separate table so that a
-- stolen customer token can never be rotated into an owner session. Lengths match the live
-- `user_sessions` (user_agent nvarchar(500)).
CREATE TABLE dbo.customer_sessions (
    id                  bigint IDENTITY(1,1) NOT NULL CONSTRAINT customer_sessions_pkey PRIMARY KEY,
    customer_id         bigint NOT NULL CONSTRAINT customer_sessions_customer_fk REFERENCES dbo.customers (id),
    family_id           uniqueidentifier NOT NULL CONSTRAINT customer_sessions_family_default DEFAULT NEWID(),
    refresh_token_hash  varbinary(64) NOT NULL,
    created_at          datetimeoffset(3) NOT NULL CONSTRAINT customer_sessions_created_default DEFAULT SYSDATETIMEOFFSET(),
    expires_at          datetimeoffset(3) NOT NULL,
    rotated_at          datetimeoffset(3) NULL,
    revoked_at          datetimeoffset(3) NULL,
    revoked_reason      nvarchar(200) NULL,
    ip                  varchar(45) NULL,
    user_agent          nvarchar(500) NULL,
    CONSTRAINT customer_sessions_token_key UNIQUE (refresh_token_hash)
);
GO
CREATE INDEX customer_sessions_customer_idx ON dbo.customer_sessions (customer_id);
CREATE INDEX customer_sessions_family_idx ON dbo.customer_sessions (family_id);
GO

-- ------------------------------------------------------------ otp_challenges
-- One table, two purposes. Keeping both flows here is deliberate: the per-phone and per-IP rate
-- limits are counted from these rows, so a second table would hand an attacker a second allowance
-- against the same number. `purpose` is part of the lookup, so a code minted for one flow cannot be
-- redeemed in the other.
--
-- The old constraint is found by the column it guards, not by its name.
DECLARE @purposeCheck sysname = (
    SELECT TOP (1) cc.name
    FROM sys.check_constraints cc
    JOIN sys.columns col ON col.object_id = cc.parent_object_id AND col.column_id = cc.parent_column_id
    WHERE cc.parent_object_id = OBJECT_ID('dbo.otp_challenges') AND col.name = 'purpose');

IF @purposeCheck IS NULL
    PRINT 'S0026 note: no existing purpose constraint found on otp_challenges; adding the new one only.';
ELSE
BEGIN
    DECLARE @dropPurpose nvarchar(400) =
        N'ALTER TABLE dbo.otp_challenges DROP CONSTRAINT ' + QUOTENAME(@purposeCheck) + N';';
    EXEC sp_executesql @dropPurpose;
END;
GO

ALTER TABLE dbo.otp_challenges WITH CHECK ADD CONSTRAINT otp_challenges_purpose_check
    CHECK (purpose IN ('owner_login', 'customer_login'));
GO

-- ---------------------------------------------------------------- audit_logs
-- A customer editing their own profile is an actor like any other. `actor_id` is a customers id
-- when actor_type is 'customer', which is why the type is recorded alongside it.
DECLARE @actorCheck sysname = (
    SELECT TOP (1) cc.name
    FROM sys.check_constraints cc
    JOIN sys.columns col ON col.object_id = cc.parent_object_id AND col.column_id = cc.parent_column_id
    WHERE cc.parent_object_id = OBJECT_ID('dbo.audit_logs') AND col.name = 'actor_type');

IF @actorCheck IS NULL
    PRINT 'S0026 note: no existing actor_type constraint found on audit_logs; adding the new one only.';
ELSE
BEGIN
    DECLARE @dropActor nvarchar(400) =
        N'ALTER TABLE dbo.audit_logs DROP CONSTRAINT ' + QUOTENAME(@actorCheck) + N';';
    EXEC sp_executesql @dropActor;
END;
GO

ALTER TABLE dbo.audit_logs WITH CHECK ADD CONSTRAINT audit_logs_actor_type_check
    CHECK (actor_type IN ('owner', 'customer', 'admin', 'system'));
GO

-- ------------------------------------------------- the new columns
ALTER TABLE dbo.favourites ADD customer_id bigint NULL CONSTRAINT favourites_customer_fk REFERENCES dbo.customers (id);
GO
ALTER TABLE dbo.reviews ADD customer_id bigint NULL CONSTRAINT reviews_customer_fk REFERENCES dbo.customers (id);
GO
-- A report is made from a public page by whoever happens to be signed in, so it now has a customer
-- to attribute as well. Both stay nullable: an anonymous report has neither, and that is allowed.
ALTER TABLE dbo.reports ADD reported_by_customer_id bigint NULL
    CONSTRAINT reports_reported_by_customer_fk REFERENCES dbo.customers (id);
GO

-- ------------------------------------------------------------------ backfill
-- A customer twin for every user who has actually behaved as a customer. An owner who never saved
-- or reviewed anything gets no row: they can create one by signing in on the user tab, like anyone
-- else. status and phone_verified_at are copied so a suspended account stays suspended.
INSERT INTO dbo.customers (phone_e164, phone_verified_at, name, email, email_verified_at, status, created_at)
SELECT u.phone_e164, u.phone_verified_at, u.name, u.email, u.email_verified_at, u.status, u.created_at
FROM dbo.users u
WHERE EXISTS (SELECT 1 FROM dbo.favourites f WHERE f.user_id = u.id)
   OR EXISTS (SELECT 1 FROM dbo.reviews r WHERE r.user_id = u.id);
GO

UPDATE f
SET customer_id = c.id
FROM dbo.favourites f
JOIN dbo.users u ON u.id = f.user_id
JOIN dbo.customers c ON c.phone_e164 = u.phone_e164
WHERE f.customer_id IS NULL;
GO

UPDATE r
SET customer_id = c.id
FROM dbo.reviews r
JOIN dbo.users u ON u.id = r.user_id
JOIN dbo.customers c ON c.phone_e164 = u.phone_e164
WHERE r.customer_id IS NULL;
GO

-- Stop rather than journal a half-applied identity split.
IF EXISTS (SELECT 1 FROM dbo.favourites WHERE customer_id IS NULL)
   OR EXISTS (SELECT 1 FROM dbo.reviews WHERE customer_id IS NULL)
BEGIN
    THROW 51035, 'S0026 backfill left a favourite or review without a customer_id.', 1;
END
GO

-- ------------------------------------------------- constraints: both columns nullable, one required
-- A primary key cannot hold NULL and SQL Server's UNIQUE treats two NULLs as equal, so the moment
-- the new API writes a row with user_id NULL the original constraints break. Both are replaced with
-- filtered unique indexes, which ignore the NULL side entirely. This is what lets the old and new
-- API write to these tables at the same time during a deployment.
--
-- The index on user_id is dropped first and rebuilt filtered afterwards. SQL Server refuses
-- ALTER COLUMN while an index depends on the column, and rebuilding it filtered is what it should
-- have been anyway once the column became nullable.
DROP INDEX IF EXISTS favourites_user_idx ON dbo.favourites;
GO

-- The primary key, by what it is rather than what it is called.
DECLARE @favPk sysname = (
    SELECT TOP (1) kc.name
    FROM sys.key_constraints kc
    WHERE kc.parent_object_id = OBJECT_ID('dbo.favourites') AND kc.type = 'PK');

IF @favPk IS NULL
    PRINT 'S0026 note: favourites has no primary key to drop.';
ELSE
BEGIN
    DECLARE @dropFavPk nvarchar(400) =
        N'ALTER TABLE dbo.favourites DROP CONSTRAINT ' + QUOTENAME(@favPk) + N';';
    EXEC sp_executesql @dropFavPk;
END;
GO

/* The foreign key on favourites.user_id, found by its column, dropped, and put back under the
   canonical name after the column is altered.

   Dropping it is not optional: SQL Server refuses ALTER COLUMN while a constraint depends on the
   column. Putting it back under a known name is what lets S0027 drop it deterministically -- on the
   live database this key is called FK__favourite__user___50C5FA01. */
DECLARE @favFk sysname = (
    SELECT TOP (1) fk.name
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
    WHERE fk.parent_object_id = OBJECT_ID('dbo.favourites') AND c.name = 'user_id');

IF @favFk IS NULL
    PRINT 'S0026 note: favourites has no foreign key on user_id.';
ELSE
BEGIN
    DECLARE @dropFavFk nvarchar(400) =
        N'ALTER TABLE dbo.favourites DROP CONSTRAINT ' + QUOTENAME(@favFk) + N';';
    EXEC sp_executesql @dropFavFk;
END;
GO

ALTER TABLE dbo.favourites ALTER COLUMN user_id bigint NULL;
GO

-- Back, named, and validated against the rows that are there.
ALTER TABLE dbo.favourites WITH CHECK ADD CONSTRAINT favourites_user_fk
    FOREIGN KEY (user_id) REFERENCES dbo.users (id);
GO

CREATE UNIQUE INDEX favourites_user_listing_uq ON dbo.favourites (user_id, listing_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX favourites_customer_listing_uq ON dbo.favourites (customer_id, listing_id) WHERE customer_id IS NOT NULL;
CREATE INDEX favourites_user_idx ON dbo.favourites (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX favourites_customer_idx ON dbo.favourites (customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
GO
ALTER TABLE dbo.favourites WITH CHECK ADD CONSTRAINT favourites_one_owner
    CHECK (user_id IS NOT NULL OR customer_id IS NOT NULL);
GO

DROP INDEX IF EXISTS reviews_user_idx ON dbo.reviews;
GO

/* The "one review per person per listing" unique key, found by its columns. On a database built
   from S0004 it is called reviews_one_per_person; the live one happens to be too, but the PK and
   foreign keys beside it are not, so nothing here trusts a name. */
DECLARE @reviewUq sysname = (
    SELECT TOP (1) kc.name
    FROM sys.key_constraints kc
    WHERE kc.parent_object_id = OBJECT_ID('dbo.reviews')
      AND kc.type = 'UQ'
      AND (SELECT COUNT(*) FROM sys.index_columns ic
           WHERE ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id) = 2
      AND NOT EXISTS (
          SELECT 1
          FROM sys.index_columns ic
          JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
          WHERE ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
            AND c.name NOT IN ('listing_id', 'user_id')));

IF @reviewUq IS NULL
    PRINT 'S0026 note: reviews has no (listing_id, user_id) unique key to drop.';
ELSE
BEGIN
    DECLARE @dropReviewUq nvarchar(400) =
        N'ALTER TABLE dbo.reviews DROP CONSTRAINT ' + QUOTENAME(@reviewUq) + N';';
    EXEC sp_executesql @dropReviewUq;
END;
GO

-- The same treatment as on favourites, for the same two reasons: ALTER COLUMN will not run while
-- the key depends on the column, and S0027 has to be able to name it afterwards.
DECLARE @reviewFk sysname = (
    SELECT TOP (1) fk.name
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
    WHERE fk.parent_object_id = OBJECT_ID('dbo.reviews') AND c.name = 'user_id');

IF @reviewFk IS NULL
    PRINT 'S0026 note: reviews has no foreign key on user_id.';
ELSE
BEGIN
    DECLARE @dropReviewFk nvarchar(400) =
        N'ALTER TABLE dbo.reviews DROP CONSTRAINT ' + QUOTENAME(@reviewFk) + N';';
    EXEC sp_executesql @dropReviewFk;
END;
GO

ALTER TABLE dbo.reviews ALTER COLUMN user_id bigint NULL;
GO

ALTER TABLE dbo.reviews WITH CHECK ADD CONSTRAINT reviews_user_fk
    FOREIGN KEY (user_id) REFERENCES dbo.users (id);
GO

CREATE UNIQUE INDEX reviews_user_listing_uq ON dbo.reviews (listing_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX reviews_customer_listing_uq ON dbo.reviews (listing_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX reviews_user_idx ON dbo.reviews (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX reviews_customer_idx ON dbo.reviews (customer_id) WHERE customer_id IS NOT NULL;
GO
ALTER TABLE dbo.reviews WITH CHECK ADD CONSTRAINT reviews_one_author
    CHECK (user_id IS NOT NULL OR customer_id IS NOT NULL);
GO

-- Fail loudly rather than journalling a migration that did nothing, as every migration here does.
-- The foreign key names are asserted too: S0027 drops them by name, and discovering here that the
-- rename did not happen is far better than discovering it halfway through S0027.
IF OBJECT_ID('dbo.customers', 'U') IS NULL
   OR OBJECT_ID('dbo.customer_sessions', 'U') IS NULL
   OR COL_LENGTH('dbo.favourites', 'customer_id') IS NULL
   OR COL_LENGTH('dbo.reviews', 'customer_id') IS NULL
   OR COL_LENGTH('dbo.reports', 'reported_by_customer_id') IS NULL
   OR NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'favourites_user_fk')
   OR NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'reviews_user_fk')
   OR NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'favourites_customer_listing_uq')
   OR NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'reviews_customer_listing_uq')
BEGIN
    THROW 51036, 'S0026 did not leave the customer identity split in the state it describes.', 1;
END
GO
