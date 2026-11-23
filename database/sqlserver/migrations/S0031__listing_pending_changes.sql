-- S0031: somewhere to keep an edit to a listing that is already published.
--
-- Until now, saving a live listing sent it straight back into the review queue: `status` went from
-- 'active' to 'pending_review' and the business came off the site until a moderator looked at it.
-- That was deliberate -- the alternative was an approved listing whose text could be rewritten
-- afterwards without anyone seeing it -- but it means an owner fixing a phone number takes their
-- own page down to do it, and `ListingReadiness.StatusAfterOwnerSave` has carried a comment saying
-- the real answer needs somewhere to put the edit. This is that somewhere.
--
-- ---------------------------------------------------------------------------- the shape
-- One row per listing, holding the fields the owner's "Business details" form writes and nothing
-- else. `listing_id` is unique, so an owner has one edit in progress rather than a pile of them --
-- which is what the form means: it is the same form, saved again.
--
-- The staged row carries its own status, and the *listing's* status stays 'active' throughout. That
-- is the whole point: the public page is served from `listings`, so as long as nothing writes there
-- the visitor keeps seeing the approved version.
--
--     draft           saved by the owner, not sent to anybody. Private to them.
--     pending_review  submitted. It is in the moderator's queue.
--     rejected        a moderator said no, with a note. The owner keeps editing the same row.
--
-- Approval copies the row onto the listing and deletes it; what happened is in `audit_logs`, which
-- is where every other moderation decision is recorded. There is no 'approved' status for the same
-- reason there is no 'applied' flag: a row that has been applied is not pending anything.
--
-- ---------------------------------------------------------------------------- what it does NOT stage
-- Photos, opening hours, questions, amenities and links are not here. They are separate tables with
-- their own endpoints, and they already publish immediately: adding a photo to a live listing has
-- never put it back in the queue. Staging them would mean a parallel copy of five more tables, and
-- it would change behaviour nobody has asked to change. So the boundary is exactly the boundary that
-- exists today -- the details form -- and that is worth knowing rather than discovering.
--
-- ---------------------------------------------------------------------------- data
-- Nothing is inserted, updated or deleted. This script creates one table and its indexes. Every
-- existing listing, review decision and audit row is untouched, and on the day it is applied there
-- are no pending changes because the feature did not exist.
--
-- ---------------------------------------------------------------------------- going back
-- database/sqlserver/manual/S0031_down.sql drops the table. It loses any edit an owner has saved
-- and not yet had approved, which is why it says so at the top and why nothing else is lost.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.listing_pending_changes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.listing_pending_changes (
        id                   bigint IDENTITY(1,1) NOT NULL
                                 CONSTRAINT listing_pending_changes_pkey PRIMARY KEY,
        /* One in progress per listing. Deleting the listing takes its staged edit with it: there is
           nothing to publish onto a listing that no longer exists. */
        listing_id           bigint NOT NULL
                                 CONSTRAINT listing_pending_changes_listing_fk
                                 REFERENCES dbo.listings (id) ON DELETE CASCADE,
        status               varchar(20) NOT NULL
                                 CONSTRAINT listing_pending_changes_status_default DEFAULT 'draft',

        /* The staged values. Every column matches its counterpart on `listings` exactly -- same type,
           same length -- so a value that fits here fits there and approval cannot fail on a length
           it was never checked against. They are all nullable because a staged edit is a whole
           replacement of the form: a cleared optional field has to be storable as cleared. */
        name                 nvarchar(300) NULL,
        description          nvarchar(max) NULL,
        address_line         nvarchar(400) NULL,
        pincode              nvarchar(10) NULL,
        phone_primary        varchar(16) NULL,
        phone_whatsapp       varchar(16) NULL,
        website_url          nvarchar(500) NULL,
        /* The proposed primary category. Not a slug: a slug can be retired between saving and
           approving, and an id that no longer exists is refused by this foreign key rather than
           silently filing the listing nowhere. */
        category_id          int NULL
                                 CONSTRAINT listing_pending_changes_category_fk
                                 REFERENCES dbo.categories (id),

        /* Who and when, on both sides of the decision. */
        created_by_user_id   bigint NULL
                                 CONSTRAINT listing_pending_changes_user_fk REFERENCES dbo.users (id),
        submitted_at         datetimeoffset(3) NULL,
        review_note          nvarchar(1000) NULL,
        reviewed_at          datetimeoffset(3) NULL,
        reviewed_by_admin_id bigint NULL
                                 CONSTRAINT listing_pending_changes_admin_fk
                                 REFERENCES dbo.admin_users (id),
        created_at           datetimeoffset(3) NOT NULL
                                 CONSTRAINT listing_pending_changes_created_default DEFAULT SYSDATETIMEOFFSET(),
        updated_at           datetimeoffset(3) NOT NULL
                                 CONSTRAINT listing_pending_changes_updated_default DEFAULT SYSDATETIMEOFFSET(),

        CONSTRAINT listing_pending_changes_listing_key UNIQUE (listing_id),
        CONSTRAINT listing_pending_changes_status_check
            CHECK (status IN ('draft', 'pending_review', 'rejected')),
        /* A submitted edit has a time on it and an unsubmitted one does not. Without this, "is this
           in the queue?" would have two answers that could disagree -- the status and the date --
           and the queue reads the status. */
        CONSTRAINT listing_pending_changes_submitted_check
            CHECK ((status = 'draft' AND submitted_at IS NULL)
                   OR (status <> 'draft' AND submitted_at IS NOT NULL)),
        /* A rejection has to say why. The owner is going to read it and decide what to change. */
        CONSTRAINT listing_pending_changes_rejection_check
            CHECK (status <> 'rejected'
                   OR (review_note IS NOT NULL AND LEN(LTRIM(RTRIM(review_note))) > 0))
    );
END;
GO

/* The moderator's queue: submitted edits, oldest first, which is the order they are worked in.
   Filtered, because the queue never wants the drafts -- those are private to their owners. */
IF OBJECT_ID('dbo.listing_pending_changes', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'listing_pending_changes_queue_idx'
                     AND object_id = OBJECT_ID('dbo.listing_pending_changes'))
BEGIN
    CREATE INDEX listing_pending_changes_queue_idx
        ON dbo.listing_pending_changes (status, submitted_at)
        INCLUDE (listing_id);
END;
GO

-- The table exists and refuses the two states that would make the queue ambiguous.
IF OBJECT_ID('dbo.listing_pending_changes', 'U') IS NULL
BEGIN
    THROW 50310, 'S0031: dbo.listing_pending_changes was not created.', 1;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.listing_pending_changes')
      AND name = 'listing_pending_changes_submitted_check')
BEGIN
    THROW 50311, 'S0031: the submitted-at CHECK is missing, so a submitted edit could have no date.', 1;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.listing_pending_changes')
      AND name = 'listing_pending_changes_listing_key')
BEGIN
    THROW 50312, 'S0031: the one-per-listing uniqueness is missing.', 1;
END;
GO
