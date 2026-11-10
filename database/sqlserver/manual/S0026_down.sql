-- Undo S0026__customer_identity.sql. Run by hand; see README.md in this folder.
--
-- Safe only while S0027 has not run. It rebuilds the original constraints from `user_id`, which
-- S0027 drops, and it refuses outright if the new API has already written rows that have no
-- `user_id` to rebuild from -- deleting those would be deleting somebody's favourites and reviews.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF EXISTS (SELECT 1 FROM favourites WHERE user_id IS NULL)
   OR EXISTS (SELECT 1 FROM reviews WHERE user_id IS NULL)
BEGIN
    THROW 51037, 'Rows written by the new API have no user_id. Fix forward, or restore from an export.', 1;
END
GO

-- ---------------------------------------------------------------- favourites
DROP INDEX favourites_user_listing_uq ON favourites;
DROP INDEX favourites_customer_listing_uq ON favourites;
DROP INDEX favourites_customer_idx ON favourites;
GO
ALTER TABLE favourites DROP CONSTRAINT favourites_one_owner;
ALTER TABLE favourites DROP CONSTRAINT favourites_customer_fk;
GO
ALTER TABLE favourites DROP COLUMN customer_id;
GO
ALTER TABLE favourites ALTER COLUMN user_id bigint NOT NULL;
GO
ALTER TABLE favourites ADD CONSTRAINT favourites_pkey PRIMARY KEY (user_id, listing_id);
GO

-- ------------------------------------------------------------------- reviews
DROP INDEX reviews_user_listing_uq ON reviews;
DROP INDEX reviews_customer_listing_uq ON reviews;
DROP INDEX reviews_customer_idx ON reviews;
GO
ALTER TABLE reviews DROP CONSTRAINT reviews_one_author;
ALTER TABLE reviews DROP CONSTRAINT reviews_customer_fk;
GO
ALTER TABLE reviews DROP COLUMN customer_id;
GO
ALTER TABLE reviews ALTER COLUMN user_id bigint NOT NULL;
GO
ALTER TABLE reviews ADD CONSTRAINT reviews_one_per_person UNIQUE (listing_id, user_id);
GO

-- ---------------------------------------------------------------- audit_logs
-- Customer rows become unrepresentable, so they are relabelled rather than deleted: an audit trail
-- that loses entries on a rollback is not an audit trail.
UPDATE audit_logs SET actor_type = 'system' WHERE actor_type = 'customer';
GO
ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_actor_type_check;
GO
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_type_check
    CHECK (actor_type IN ('owner', 'admin', 'system'));
GO

-- ------------------------------------------------------------------- reports
ALTER TABLE reports DROP CONSTRAINT reports_reported_by_customer_fk;
GO
ALTER TABLE reports DROP COLUMN reported_by_customer_id;
GO

-- ------------------------------------------------------------- otp_challenges
-- Any customer_login rows are historic challenges, not accounts; they are deleted so the old
-- check constraint can be restored. No session and no identity depends on them.
DELETE FROM otp_challenges WHERE purpose = 'customer_login';
GO
ALTER TABLE otp_challenges DROP CONSTRAINT otp_challenges_purpose_check;
GO
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check CHECK (purpose IN ('owner_login'));
GO

-- ------------------------------------------------------------------ identity
DROP TABLE customer_sessions;
GO
DROP TABLE customers;
GO
