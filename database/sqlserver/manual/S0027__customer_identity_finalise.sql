-- Close the customer identity split. Run by hand, after the new API is verified in production;
-- see README.md in this folder. Running this ends the rollback window.
--
-- Every favourite and review now belongs to a customer, so `user_id` has nothing left to say.
-- Dropping it restores a plain primary key and unique constraint in place of the filtered indexes
-- S0026 used to let the old and new API write side by side.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- Refuse if any row is still owned by a user. That would mean an old instance is still writing,
-- and dropping the column would take those favourites and reviews with it.
IF EXISTS (SELECT 1 FROM favourites WHERE customer_id IS NULL)
   OR EXISTS (SELECT 1 FROM reviews WHERE customer_id IS NULL)
BEGIN
    THROW 51038, 'A favourite or review still has no customer_id. The old API is still writing.', 1;
END
GO

-- ---------------------------------------------------------------- favourites
DROP INDEX favourites_user_listing_uq ON favourites;
DROP INDEX favourites_customer_listing_uq ON favourites;
DROP INDEX favourites_customer_idx ON favourites;
DROP INDEX favourites_user_idx ON favourites;
GO
ALTER TABLE favourites DROP CONSTRAINT favourites_one_owner;
ALTER TABLE favourites DROP CONSTRAINT favourites_user_fk;
GO
ALTER TABLE favourites DROP COLUMN user_id;
GO
ALTER TABLE favourites ALTER COLUMN customer_id bigint NOT NULL;
GO
ALTER TABLE favourites ADD CONSTRAINT favourites_pkey PRIMARY KEY (customer_id, listing_id);
CREATE INDEX favourites_customer_idx ON favourites (customer_id, created_at DESC);
GO

-- ------------------------------------------------------------------- reviews
DROP INDEX reviews_user_listing_uq ON reviews;
DROP INDEX reviews_customer_listing_uq ON reviews;
DROP INDEX reviews_customer_idx ON reviews;
DROP INDEX reviews_user_idx ON reviews;
GO
ALTER TABLE reviews DROP CONSTRAINT reviews_one_author;
ALTER TABLE reviews DROP CONSTRAINT reviews_user_fk;
GO
ALTER TABLE reviews DROP COLUMN user_id;
GO
ALTER TABLE reviews ALTER COLUMN customer_id bigint NOT NULL;
GO
ALTER TABLE reviews ADD CONSTRAINT reviews_one_per_person UNIQUE (listing_id, customer_id);
CREATE INDEX reviews_customer_idx ON reviews (customer_id);
GO
