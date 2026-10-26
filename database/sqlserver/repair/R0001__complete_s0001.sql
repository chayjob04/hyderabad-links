-- Repair 0001: finish S0001 on a database where it was only partly applied.
--
-- Why this file exists. hyderab3_workingmodel is shared with another application, and this
-- project's tables were created there by something other than database/sqlserver/migrations --
-- there is no dbo.SchemaVersions, so DbUp has never run. 26 of S0001-S0007's 27 tables are present.
-- The one missing is category_search_terms, which is why `/api/v1/public/categories` answers 500:
-- the category query joins it.
--
-- One missing table is also what stops `db:baseline` adopting the database: it marks a script
-- applied only when *every* table that script creates is present, and refuses on a partially
-- applied one. That refusal is correct, so the fix is to complete the script rather than to weaken
-- the check.
--
-- Nothing here drops or alters anything. It only creates what is absent, and it is guarded so it
-- can be re-run safely. The DDL below is copied verbatim from
-- S0001__geography_and_taxonomy.sql, which is the point: the table must be exactly what the
-- migration would have made, not an approximation of it.
--
-- After this: `npm run db:baseline --apply` records S0001-S0007, then `npm run db:migrate` applies
-- S0008 (the search machinery) and S0009 (subscriptions and links) and the reference seeds.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* dbo. is spelled out on every object below, and that is not decoration.

   This login's default schema is `hyderab3_workingmodeluser`, not dbo. An unqualified
   CREATE TABLE goes to the *login's* schema, so the first version of this script -- which guarded
   on OBJECT_ID('dbo.category_search_terms') but then said CREATE TABLE category_search_terms --
   found nothing in dbo, created the table in hyderab3_workingmodeluser, and reported success while
   db-baseline went on correctly reporting the table as missing from dbo.

   The other 26 tables are all in dbo, so dbo is the only coherent target. Unqualified *references*
   happen to resolve (SQL Server tries the login's schema, then dbo), which is exactly why this is
   easy to miss: reads work and creates go astray. */
IF OBJECT_ID('dbo.category_search_terms', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.category_search_terms (
        category_id  int NOT NULL CONSTRAINT category_search_terms_category_fk
                         REFERENCES dbo.categories (id) ON DELETE CASCADE,
        term         nvarchar(200) NOT NULL,
        CONSTRAINT category_search_terms_pkey PRIMARY KEY (category_id, term),
        CONSTRAINT category_search_terms_not_blank CHECK (LEN(LTRIM(RTRIM(term))) > 0)
    );

    -- Looking a typed word up across every category.
    CREATE INDEX category_search_terms_term_idx
        ON dbo.category_search_terms (term) INCLUDE (category_id);
END;
GO
