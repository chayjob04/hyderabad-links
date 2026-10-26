-- S0011: the three old paid tiers are gone for good.
--
-- The subscription structure is settled: Free (a basic listing) and Verified (Rs 399 a year), and
-- nothing else. S0009 deactivated Basic (Rs 699), Advanced (Rs 6,999) and Premium (Rs 36,999)
-- rather than deleting them, because `listings.plan_slug` and `subscriptions.plan_slug` are foreign
-- keys to `plans.slug` and a row something still points at has to keep existing. The owner has now
-- asked for them to be removed completely.
--
-- approved-destructive: the owner confirmed on 2026-10-25 that Basic, Advanced and Premium are to
-- be removed completely; this deletes only those three plan rows, and only when nothing references
-- them.
--
-- **It refuses rather than orphaning anything.** The two checks below count every row in the two
-- tables that reference `plans.slug`; if any of them is on one of these tiers, this migration
-- throws and changes nothing. That matters because a migration runs against whatever database it is
-- pointed at: on the company database both counts are zero today, but on a copy with real
-- subscriptions on an old tier, deleting the plan row would either be refused by the foreign key
-- half way through or, worse, succeed against a database whose constraints had been loosened.
--
-- Deleting the plan row is safe for *history* here because no payment record references a plan: the
-- period that was bought lives in `subscriptions` (none exist on these tiers) and the money record
-- in `subscription_payments`, which has no plan column at all — it carries the amount that was
-- actually charged. So nothing about a past transaction is lost by this.
--
-- The slugs are named one by one rather than written as `NOT IN ('free', 'verified')`. A migration
-- should remove exactly what it says it removes; a negative match would also silently delete any
-- tier someone adds later between this file being written and being run.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- DbUp runs this file in one transaction (WithTransactionPerScript), so a THROW below rolls back
-- anything that came before it in the same file.

DECLARE @legacy TABLE (slug nvarchar(50) PRIMARY KEY);
INSERT INTO @legacy (slug) VALUES ('basic'), ('advanced'), ('premium');

DECLARE @listings bigint = (
    SELECT COUNT_BIG(*) FROM dbo.listings WHERE plan_slug IN (SELECT slug FROM @legacy));

IF @listings > 0
BEGIN
    DECLARE @listingMessage nvarchar(400) =
        CONCAT(N'S0011 refused: ', @listings,
               N' listing(s) are still on Basic, Advanced or Premium. Move them to ''free'' or ',
               N'''verified'' first — deleting the plan row would orphan them.');
    THROW 51011, @listingMessage, 1;
END;

DECLARE @subs bigint = (
    SELECT COUNT_BIG(*) FROM dbo.subscriptions WHERE plan_slug IN (SELECT slug FROM @legacy));

IF @subs > 0
BEGIN
    DECLARE @subMessage nvarchar(400) =
        CONCAT(N'S0011 refused: ', @subs,
               N' subscription(s) were bought on Basic, Advanced or Premium. Those are paid periods ',
               N'and must not lose the plan they name. Decide how to migrate them before running this.');
    THROW 51012, @subMessage, 1;
END;

DELETE FROM dbo.plans WHERE slug IN (SELECT slug FROM @legacy);
GO

/* Anything else outside the two live plans is left alone and reported. This migration is not a
   licence to tidy up plans it was not told about: a tier added after this file was written is
   somebody's deliberate decision, and it should be looked at by a person rather than deleted by a
   script that has been waiting in the queue. */
IF EXISTS (SELECT 1 FROM dbo.plans WHERE slug NOT IN ('free', 'verified'))
BEGIN
    DECLARE @others nvarchar(max) = N'';
    SELECT @others = @others + slug + N' ' FROM dbo.plans WHERE slug NOT IN ('free', 'verified');
    PRINT N'S0011 note: plans other than free and verified are still present and were left alone: '
          + @others;
END;
GO
