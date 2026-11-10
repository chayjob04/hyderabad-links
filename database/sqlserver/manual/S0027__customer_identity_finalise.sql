-- Close the customer identity split. Run by hand, after the new API is verified in production;
-- see README.md in this folder. Running this ends the rollback window.
--
-- Every favourite and review now belongs to a customer, so `user_id` has nothing left to say.
-- Dropping it restores a plain primary key and unique constraint in place of the filtered indexes
-- S0026 used to let the old and new API write side by side.
--
-- S0026 renamed the two foreign keys this drops to `favourites_user_fk` and `reviews_user_fk`,
-- because the live database had them under server-generated names. They are still looked up by
-- their column rather than by that name, so this script is correct even if S0026's rename did not
-- happen for some reason.
--
-- approved-destructive: D56 -- drops favourites.user_id and reviews.user_id after the identity
-- split is verified in production. Every row has a customer_id by then (asserted below) and the
-- data it held is preserved in that column.

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
DROP INDEX IF EXISTS favourites_user_listing_uq ON favourites;
DROP INDEX IF EXISTS favourites_customer_listing_uq ON favourites;
DROP INDEX IF EXISTS favourites_customer_idx ON favourites;
DROP INDEX IF EXISTS favourites_user_idx ON favourites;
GO

DECLARE @favOwner sysname = (
    SELECT TOP (1) cc.name
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id = OBJECT_ID('dbo.favourites') AND cc.name = 'favourites_one_owner');
IF @favOwner IS NOT NULL
    ALTER TABLE dbo.favourites DROP CONSTRAINT favourites_one_owner;

-- By column, not by name, so a database where S0026's rename did not take is still handled.
DECLARE @favFk sysname = (
    SELECT TOP (1) fk.name
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
    WHERE fk.parent_object_id = OBJECT_ID('dbo.favourites') AND c.name = 'user_id');
IF @favFk IS NOT NULL
BEGIN
    DECLARE @dropFavFk nvarchar(400) =
        N'ALTER TABLE dbo.favourites DROP CONSTRAINT ' + QUOTENAME(@favFk) + N';';
    EXEC sp_executesql @dropFavFk;
END;
GO

ALTER TABLE favourites DROP COLUMN user_id;
GO
ALTER TABLE favourites ALTER COLUMN customer_id bigint NOT NULL;
GO
ALTER TABLE favourites ADD CONSTRAINT favourites_pkey PRIMARY KEY (customer_id, listing_id);
CREATE INDEX favourites_customer_idx ON favourites (customer_id, created_at DESC);
GO

-- ------------------------------------------------------------------- reviews
DROP INDEX IF EXISTS reviews_user_listing_uq ON reviews;
DROP INDEX IF EXISTS reviews_customer_listing_uq ON reviews;
DROP INDEX IF EXISTS reviews_customer_idx ON reviews;
DROP INDEX IF EXISTS reviews_user_idx ON reviews;
GO

DECLARE @reviewAuthor sysname = (
    SELECT TOP (1) cc.name
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id = OBJECT_ID('dbo.reviews') AND cc.name = 'reviews_one_author');
IF @reviewAuthor IS NOT NULL
    ALTER TABLE dbo.reviews DROP CONSTRAINT reviews_one_author;

DECLARE @reviewFk sysname = (
    SELECT TOP (1) fk.name
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
    WHERE fk.parent_object_id = OBJECT_ID('dbo.reviews') AND c.name = 'user_id');
IF @reviewFk IS NOT NULL
BEGIN
    DECLARE @dropReviewFk nvarchar(400) =
        N'ALTER TABLE dbo.reviews DROP CONSTRAINT ' + QUOTENAME(@reviewFk) + N';';
    EXEC sp_executesql @dropReviewFk;
END;
GO

ALTER TABLE reviews DROP COLUMN user_id;
GO
ALTER TABLE reviews ALTER COLUMN customer_id bigint NOT NULL;
GO
ALTER TABLE reviews ADD CONSTRAINT reviews_one_per_person UNIQUE (listing_id, customer_id);
CREATE INDEX reviews_customer_idx ON reviews (customer_id);
GO

IF COL_LENGTH('dbo.favourites', 'user_id') IS NOT NULL
   OR COL_LENGTH('dbo.reviews', 'user_id') IS NOT NULL
BEGIN
    THROW 51039, 'S0027 did not remove user_id from favourites and reviews.', 1;
END
GO
