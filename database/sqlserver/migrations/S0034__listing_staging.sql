-- S0034: stage a whole listing, not one section of it.
--
-- S0031 staged the Business details form in a table of its own: eight columns mirroring eight
-- columns of `listings`. That worked for those eight, and it does not extend. Staging the other four
-- sections of the editor the same way means a parallel copy of five more tables -- media, opening
-- hours, questions, content, amenities, links -- and a branch in every owner endpoint that writes
-- one, so that each reads staged rows for a published listing and live rows for a draft. Five
-- tables, five endpoints, two code paths each, and media on top of that, where a staged upload also
-- has to be stored, served to its owner, and kept away from the public page.
--
-- This replaces it with the thing the data model already has: **a listing**.
--
-- ---------------------------------------------------------------------------- the shape
-- A staged edit is a row in `listings` whose `staged_for_listing_id` names the published listing it
-- is a proposal for. It is a complete listing: it has its own media, hours, questions, content,
-- amenities, links and primary category, copied from the published one when editing begins. The
-- owner's editor is pointed at it, and from there everything works unchanged -- every section's
-- endpoint, every validation, every ownership check, because ownership is `business_members` and
-- the shadow belongs to the same business.
--
-- Approving one copies it onto the published listing, children and all, in one transaction, and
-- deletes it. Rejecting one leaves the published listing untouched and keeps the shadow with the
-- note, so its owner carries on from their own work.
--
-- Three columns' worth of state already mean the right thing on a listing row and are reused rather
-- than duplicated: `status` ('draft' unsent, 'pending_review' in the queue, 'rejected' sent back),
-- `review_note`, `reviewed_at` and `reviewed_by_admin_id`.
--
-- ---------------------------------------------------------------------------- why this is safe
-- **A staged row can never be public.** Every public query requires `status = 'active'`, and the
-- CHECK below refuses to let a staged row hold that status at all. That is one constraint doing the
-- work that "prevent staged media from appearing publicly" would otherwise need in six queries.
--
-- **It cannot be mistaken for a business.** Every list, count and queue that shows listings is
-- changed in the same commit to skip rows with a `staged_for_listing_id`, and `scripts/` has a test
-- that fails if a new one forgets.
--
-- **It inherits the plan.** `listing_entitlements` is altered below so a staged row reads its
-- parent's subscription. Without that a shadow of a Verified listing would read as Free and its
-- owner would be told to pay for the photos they already have.
--
-- ---------------------------------------------------------------------------- placeholders
-- The same mechanism answers the other half of this change: an owner adding a business can fill all
-- five sections before saving anything, because "Add a business" gives them a real draft listing
-- immediately. `is_placeholder` marks one that has been started and never saved, so it can be
-- reused when they click Add again (rather than making a second), left out of the five-listing
-- limit, labelled honestly in their list, and cleaned up. The first save clears the flag.
--
-- ---------------------------------------------------------------------------- data
-- Two columns, two indexes, two CHECKs, one view altered, and `dbo.listing_pending_changes` dropped.
-- **No listing, media row, subscription, payment or audit row is touched.** The dropped table holds
-- nothing: it is created by S0031, which is on this same unmerged branch and has never been applied
-- to any database. If you are applying this to a database where S0031 did run and rows exist, stop
-- and read the note in `manual/S0034_down.sql` first.
--
-- approved-destructive: drops dbo.listing_pending_changes, which S0031 creates on this same branch
-- and which has never been applied anywhere. The guard below refuses to run if it contains any row,
-- so this cannot silently discard staged edits. Nothing else is dropped or deleted.
--
-- ---------------------------------------------------------------------------- going back
-- database/sqlserver/manual/S0034_down.sql.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ------------------------------------------------------------------ 0. refuse to discard real data
/* If S0031's table has rows, somebody has been using it and this script would throw their staged
   edits away. It has never been applied anywhere, so this is a guard against a future surprise
   rather than a known case -- which is exactly when a guard is worth having. */
IF OBJECT_ID('dbo.listing_pending_changes', 'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM dbo.listing_pending_changes)
BEGIN
    THROW 50340, 'S0034: dbo.listing_pending_changes holds rows. Migrate them to staged listings by hand before running this, or they will be lost.', 1;
END;
GO

-- ------------------------------------------------------------------ 1. the staging column
IF COL_LENGTH('dbo.listings', 'staged_for_listing_id') IS NULL
BEGIN
    /* No foreign key, on purpose, and the same purpose as `subscription_payments.listing_id`: this
       points at another row in the *same* table, and SQL Server cannot cascade a self-reference. A
       plain foreign key would instead refuse to delete a published listing that had an edit waiting
       -- a delete that fails in production is worse than a row the cleanup script removes -- so the
       relationship is maintained in code (the super-admin delete removes the shadow first) and the
       orphan case is a draft nothing points at. */
    ALTER TABLE dbo.listings ADD staged_for_listing_id bigint NULL;
END;
GO

IF COL_LENGTH('dbo.listings', 'is_placeholder') IS NULL
BEGIN
    /* Started and never saved. Reused when the owner clicks Add again, left out of the listing
       limit, and cleared by the first save. */
    ALTER TABLE dbo.listings ADD is_placeholder bit NOT NULL
        CONSTRAINT listings_is_placeholder_default DEFAULT 0;
END;
GO

-- ------------------------------------------------------------------ 2. what a staged row may be
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.listings') AND name = 'listings_staged_not_active')
BEGIN
    /* The one constraint that keeps every staged section off the public site. Every public query
       requires `status = 'active'`; this makes that status unreachable for a staged row, so a staged
       photo, a staged price or a staged phone number cannot be served by any of them -- including
       one written later by somebody who has never heard of this column.

       WITH CHECK: if any existing row would violate it the script fails here rather than leaving a
       constraint that is not true of the data. No row has this column set yet. */
    ALTER TABLE dbo.listings WITH CHECK
        ADD CONSTRAINT listings_staged_not_active CHECK (
            staged_for_listing_id IS NULL OR status <> 'active'
        );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.listings') AND name = 'listings_placeholder_is_a_draft')
BEGIN
    /* A placeholder is an unsaved new listing: it is a draft, and it is not a proposal for anything.
       Both halves matter -- a placeholder that was also a shadow would be two different ideas in one
       row, and a published placeholder would be a business nobody ever filled in. */
    ALTER TABLE dbo.listings WITH CHECK
        ADD CONSTRAINT listings_placeholder_is_a_draft CHECK (
            is_placeholder = 0
            OR (status = 'draft' AND staged_for_listing_id IS NULL)
        );
END;
GO

-- ------------------------------------------------------------------ 3. one edit per listing
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'listings_staged_for_key' AND object_id = OBJECT_ID('dbo.listings'))
BEGIN
    /* Filtered, so it constrains only the staged rows: a published listing has at most one edit
       waiting, which is what the editor means -- it is the same form, saved again. Everything else
       in the table has a NULL here and is not constrained at all. */
    CREATE UNIQUE INDEX listings_staged_for_key
        ON dbo.listings (staged_for_listing_id)
        WHERE staged_for_listing_id IS NOT NULL;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'listings_placeholder_per_owner_key' AND object_id = OBJECT_ID('dbo.listings'))
BEGIN
    /* One unsaved new listing per owner. Clicking "Add a business" twice returns the same draft
       rather than leaving a trail of empty ones, and this is what makes that impossible to get
       wrong under a double submit. */
    CREATE UNIQUE INDEX listings_placeholder_per_owner_key
        ON dbo.listings (created_by_user_id)
        WHERE is_placeholder = 1;
END;
GO

-- ------------------------------------------------------------------ 4. a shadow inherits the plan
/* The same view as S0009, with one change: the subscription is looked up against the listing a
   staged row is standing in for.

   Without it, a shadow of a Verified listing would read as Free -- the entitlement comes from a
   subscription, and the subscription belongs to the published row. Its owner would open the editor
   to be told the photos they already have are a paid feature, and the media allowance would hide
   the copies. COALESCE is the whole fix, and it is also why staging a listing in a listing works at
   all: entitlement is the one thing a shadow cannot have of its own.

   No subscription row is created, moved or counted twice by this: it reads the parent's period. */
CREATE OR ALTER VIEW dbo.listing_entitlements
AS
SELECT
    li.id                                        AS listing_id,
    COALESCE(sub.plan_slug, 'free')              AS effective_plan_slug,
    p.name                                       AS effective_plan_name,
    p.photo_limit,
    p.video_limit,
    p.logo_limit,
    p.media_limits_confirmed,
    p.grants_verified_badge                      AS is_verified,
    CASE WHEN p.grants_verified_badge = 1 THEN 5 ELSE 0 END AS link_limit,
    sub.expires_at                               AS paid_until,
    li.plan_slug                                 AS subscribed_plan_slug
FROM listings li
OUTER APPLY (
    SELECT TOP (1) s.plan_slug, s.expires_at
    FROM subscriptions s
    WHERE s.listing_id = COALESCE(li.staged_for_listing_id, li.id)
      AND s.status = 'active'
      AND s.starts_at <= SYSDATETIMEOFFSET()
      AND s.expires_at > SYSDATETIMEOFFSET()
    ORDER BY s.expires_at DESC
) sub
JOIN plans p ON p.slug = COALESCE(sub.plan_slug, 'free');
GO

-- ------------------------------------------------------------------ 5. S0031's table goes
IF OBJECT_ID('dbo.listing_pending_changes', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.listing_pending_changes;
END;
GO

-- ------------------------------------------------------------------ 6. and it all took
IF COL_LENGTH('dbo.listings', 'staged_for_listing_id') IS NULL
   OR COL_LENGTH('dbo.listings', 'is_placeholder') IS NULL
BEGIN
    THROW 50341, 'S0034: the staging columns were not added.', 1;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.listings') AND name = 'listings_staged_not_active')
BEGIN
    THROW 50342, 'S0034: the CHECK that keeps staged listings off the public site is missing.', 1;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'listings_staged_for_key' AND object_id = OBJECT_ID('dbo.listings')
                 AND is_unique = 1 AND has_filter = 1)
BEGIN
    THROW 50343, 'S0034: the one-edit-per-listing index is missing or is not a filtered unique index.', 1;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'listings_placeholder_per_owner_key' AND object_id = OBJECT_ID('dbo.listings')
                 AND is_unique = 1 AND has_filter = 1)
BEGIN
    THROW 50344, 'S0034: the one-placeholder-per-owner index is missing.', 1;
END;
GO

/* The view still answers for every listing, and still reads 'free' where there is no period. A
   mistake in section 4 would otherwise show up as every listing losing its plan at once. */
IF NOT EXISTS (SELECT 1 FROM sys.views WHERE object_id = OBJECT_ID('dbo.listing_entitlements'))
BEGIN
    THROW 50345, 'S0034: dbo.listing_entitlements is missing after being altered.', 1;
END;
GO

IF EXISTS (
    SELECT 1 FROM dbo.listings li
    WHERE NOT EXISTS (SELECT 1 FROM dbo.listing_entitlements e WHERE e.listing_id = li.id))
BEGIN
    THROW 50346, 'S0034: a listing has no row in dbo.listing_entitlements after the view was altered.', 1;
END;
GO

IF OBJECT_ID('dbo.listing_pending_changes', 'U') IS NOT NULL
BEGIN
    THROW 50347, 'S0034: dbo.listing_pending_changes is still there.', 1;
END;
GO
