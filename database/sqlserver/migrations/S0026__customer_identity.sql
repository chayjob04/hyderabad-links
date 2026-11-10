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
-- deployment. S0027 removes `user_id` once the new API is verified; until it runs, S0026 can be
-- undone with database/sqlserver/rollback/S0026_down.sql.
--
-- Nothing is deleted here. Every existing favourite and review keeps its row and gains a
-- customer_id pointing at a customer created from the user it already belonged to.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ------------------------------------------------------------------ customers
-- Deliberately the same shape as `users`, including the three check constraints, because a customer
-- is the same kind of thing: a person identified by a verified phone number. What differs is what
-- may point at it.
CREATE TABLE customers (
    id                 bigint IDENTITY(1,1) NOT NULL CONSTRAINT customers_pkey PRIMARY KEY,
    phone_e164         varchar(16) NOT NULL,
    phone_verified_at  datetimeoffset(3) NULL,
    name               nvarchar(200) NULL,
    email              nvarchar(254) NULL,
    email_verified_at  datetimeoffset(3) NULL,
    status             varchar(20) NOT NULL CONSTRAINT customers_status_default DEFAULT 'active',
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
-- stolen customer token can never be rotated into an owner session.
CREATE TABLE customer_sessions (
    id                  bigint IDENTITY(1,1) NOT NULL CONSTRAINT customer_sessions_pkey PRIMARY KEY,
    customer_id         bigint NOT NULL CONSTRAINT customer_sessions_customer_fk REFERENCES customers (id),
    family_id           uniqueidentifier NOT NULL CONSTRAINT customer_sessions_family_default DEFAULT NEWID(),
    refresh_token_hash  varbinary(64) NOT NULL,
    created_at          datetimeoffset(3) NOT NULL CONSTRAINT customer_sessions_created_default DEFAULT SYSDATETIMEOFFSET(),
    expires_at          datetimeoffset(3) NOT NULL,
    rotated_at          datetimeoffset(3) NULL,
    revoked_at          datetimeoffset(3) NULL,
    revoked_reason      nvarchar(200) NULL,
    ip                  varchar(45) NULL,
    user_agent          nvarchar(400) NULL,
    CONSTRAINT customer_sessions_token_key UNIQUE (refresh_token_hash)
);
GO
CREATE INDEX customer_sessions_customer_idx ON customer_sessions (customer_id);
CREATE INDEX customer_sessions_family_idx ON customer_sessions (family_id);
GO

-- ------------------------------------------------------------ otp_challenges
-- One table, two purposes. Keeping both flows here is deliberate: the per-phone and per-IP rate
-- limits are counted from these rows, so a second table would hand an attacker a second independent
-- allowance against the same number. `purpose` is part of the lookup, so a code minted for one flow
-- cannot be redeemed in the other.
ALTER TABLE otp_challenges DROP CONSTRAINT otp_challenges_purpose_check;
GO
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check
    CHECK (purpose IN ('owner_login', 'customer_login'));
GO

-- ---------------------------------------------------------------- favourites
ALTER TABLE favourites ADD customer_id bigint NULL CONSTRAINT favourites_customer_fk REFERENCES customers (id);
GO

-- ------------------------------------------------------------------- reviews
ALTER TABLE reviews ADD customer_id bigint NULL CONSTRAINT reviews_customer_fk REFERENCES customers (id);
GO

-- ------------------------------------------------------------------ backfill
-- A customer twin for every user who has actually behaved as a customer. An owner who never saved
-- or reviewed anything gets no row: they can create one by signing in on the user tab, like anyone
-- else. status and phone_verified_at are copied so a suspended account stays suspended.
INSERT INTO customers (phone_e164, phone_verified_at, name, email, email_verified_at, status, created_at)
SELECT u.phone_e164, u.phone_verified_at, u.name, u.email, u.email_verified_at, u.status, u.created_at
FROM users u
WHERE EXISTS (SELECT 1 FROM favourites f WHERE f.user_id = u.id)
   OR EXISTS (SELECT 1 FROM reviews r WHERE r.user_id = u.id);
GO

UPDATE f
SET customer_id = c.id
FROM favourites f
JOIN users u ON u.id = f.user_id
JOIN customers c ON c.phone_e164 = u.phone_e164
WHERE f.customer_id IS NULL;
GO

UPDATE r
SET customer_id = c.id
FROM reviews r
JOIN users u ON u.id = r.user_id
JOIN customers c ON c.phone_e164 = u.phone_e164
WHERE r.customer_id IS NULL;
GO

-- Stop rather than journal a half-applied identity split.
IF EXISTS (SELECT 1 FROM favourites WHERE customer_id IS NULL)
   OR EXISTS (SELECT 1 FROM reviews WHERE customer_id IS NULL)
BEGIN
    THROW 51035, 'S0026 backfill left a favourite or review without a customer_id.', 1;
END
GO

-- ------------------------------------------------- constraints: both columns nullable, one required
-- A primary key cannot hold NULL and SQL Server's UNIQUE treats two NULLs as equal, so the moment
-- the new API writes a row with user_id NULL the original constraints break. Both are replaced with
-- filtered unique indexes, which ignore the NULL side entirely. This is what lets the old and new
-- API write to these tables at the same time during a deployment.
ALTER TABLE favourites DROP CONSTRAINT favourites_pkey;
GO
ALTER TABLE favourites ALTER COLUMN user_id bigint NULL;
GO
CREATE UNIQUE INDEX favourites_user_listing_uq ON favourites (user_id, listing_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX favourites_customer_listing_uq ON favourites (customer_id, listing_id) WHERE customer_id IS NOT NULL;
CREATE INDEX favourites_customer_idx ON favourites (customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
GO
ALTER TABLE favourites ADD CONSTRAINT favourites_one_owner
    CHECK (user_id IS NOT NULL OR customer_id IS NOT NULL);
GO

ALTER TABLE reviews DROP CONSTRAINT reviews_one_per_person;
GO
ALTER TABLE reviews ALTER COLUMN user_id bigint NULL;
GO
CREATE UNIQUE INDEX reviews_user_listing_uq ON reviews (listing_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX reviews_customer_listing_uq ON reviews (listing_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX reviews_customer_idx ON reviews (customer_id) WHERE customer_id IS NOT NULL;
GO
ALTER TABLE reviews ADD CONSTRAINT reviews_one_author
    CHECK (user_id IS NOT NULL OR customer_id IS NOT NULL);
GO

-- ---------------------------------------------------------------- audit_logs
-- A customer editing their own profile is an actor like any other. `actor_id` is a customers id
-- when actor_type is 'customer', which is why the type is recorded alongside it.
ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_actor_type_check;
GO
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_type_check
    CHECK (actor_type IN ('owner', 'customer', 'admin', 'system'));
GO

-- --------------------------------------------------------------------- reports
-- A report is made from a public page by whoever happens to be signed in, so it now has a customer
-- to attribute as well. Both stay nullable: an anonymous report has neither, and that is allowed.
ALTER TABLE reports ADD reported_by_customer_id bigint NULL
    CONSTRAINT reports_reported_by_customer_fk REFERENCES customers (id);
GO

-- Fail loudly rather than journalling a migration that did nothing, as every migration here does.
IF OBJECT_ID('dbo.customers', 'U') IS NULL
   OR OBJECT_ID('dbo.customer_sessions', 'U') IS NULL
   OR COL_LENGTH('dbo.favourites', 'customer_id') IS NULL
   OR COL_LENGTH('dbo.reviews', 'customer_id') IS NULL
   OR COL_LENGTH('dbo.reports', 'reported_by_customer_id') IS NULL
BEGIN
    THROW 51036, 'S0026 did not create dbo.customers, dbo.customer_sessions and the customer_id columns.', 1;
END
GO
