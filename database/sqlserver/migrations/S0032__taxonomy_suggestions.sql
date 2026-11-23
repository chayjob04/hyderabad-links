-- S0032: an owner's request for an area or a category that does not exist yet.
--
-- The sign-up form lets an owner say "my area is not listed" and type the name. Nothing was kept:
-- the name was shown back to them with a prefilled email to support, and if nobody sent that email
-- the request was gone. Every request is now a row, which is the difference between a backlog and
-- a hope.
--
-- ---------------------------------------------------------------------------- what it does not do
-- **An approved suggestion is still created by a person.** Approving one inserts the area or the
-- category through the same validation the admin screens use, with the admin supplying what only a
-- person can: where an area is on the map, and which category a new subcategory belongs under.
-- Nothing in this schema lets a typed name become a public page on its own, because an area decides
-- a listing's web address and a category decides where it is filed. That was the reason the original
-- feature created nothing, and it still holds.
--
-- ---------------------------------------------------------------------------- the four states
--     pending         somebody asked. It is in the admin's queue.
--     approved        it exists now. resolved_locality_id or resolved_category_id says what it became.
--     rejected        it will not be added, with a note saying why.
--     already_exists  it is already there under another name, and the note names it. Not a rejection:
--                     the owner was right to ask, and the answer is "use this one".
--
-- ---------------------------------------------------------------------------- duplicates
-- `normalised` is the suggested name folded to lower case with its spaces collapsed, written by the
-- API. The unique index on (kind, normalised) is **filtered to pending rows**, so:
--   * two owners asking for the same area produce one queue item rather than two;
--   * the same name can be asked for again after a rejection, because circumstances change and a
--     refusal is not a permanent ban on a word.
--
-- ---------------------------------------------------------------------------- data
-- Nothing is inserted, updated or deleted. This creates one table and two indexes, and on the day
-- it is applied there are no suggestions because nothing could record one.
--
-- ---------------------------------------------------------------------------- going back
-- database/sqlserver/manual/S0032_down.sql drops the table. It loses the queue of requests; no
-- area, category or listing is affected, because an approved suggestion's result is a row in
-- `localities` or `categories` that stands on its own.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.taxonomy_suggestions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.taxonomy_suggestions (
        id                   bigint IDENTITY(1,1) NOT NULL
                                 CONSTRAINT taxonomy_suggestions_pkey PRIMARY KEY,
        /* 'locality' rather than 'area': the form says area, the schema says locality, and the
           schema's word is the one that has to match a table name. */
        kind                 varchar(20) NOT NULL,
        suggested_name       nvarchar(200) NOT NULL,
        /* Lower case, spaces collapsed. Written by the API so that the duplicate rule is the same
           rule everywhere, and indexed rather than computed so the filtered unique index below can
           use it. */
        normalised           nvarchar(200) NOT NULL,
        status               varchar(20) NOT NULL
                                 CONSTRAINT taxonomy_suggestions_status_default DEFAULT 'pending',

        /* Who asked. Null is allowed because an account can be removed and the request is still a
           fact about the directory; it is not cascaded for the same reason. */
        user_id              bigint NULL
                                 CONSTRAINT taxonomy_suggestions_user_fk REFERENCES dbo.users (id),
        /* The listing it was asked for, when there is one. A sign-up request has none: the account
           does not have a listing until it finishes, which is the moment this is usually written.
           SET NULL rather than CASCADE -- a deleted listing does not make the request untrue. */
        listing_id           bigint NULL
                                 CONSTRAINT taxonomy_suggestions_listing_fk
                                 REFERENCES dbo.listings (id) ON DELETE SET NULL,

        /* What it became, for an approved one. Exactly one of the two, and only when approved: the
           CHECK below holds that, so "what happened to my request?" has one answer. */
        resolved_locality_id int NULL
                                 CONSTRAINT taxonomy_suggestions_locality_fk REFERENCES dbo.localities (id),
        resolved_category_id int NULL
                                 CONSTRAINT taxonomy_suggestions_category_fk REFERENCES dbo.categories (id),

        /* The admin's words: why it was refused, or which existing area to use instead. Required for
           those two outcomes, because both are answers somebody has to act on. */
        note                 nvarchar(1000) NULL,
        reviewed_at          datetimeoffset(3) NULL,
        reviewed_by_admin_id bigint NULL
                                 CONSTRAINT taxonomy_suggestions_admin_fk REFERENCES dbo.admin_users (id),
        created_at           datetimeoffset(3) NOT NULL
                                 CONSTRAINT taxonomy_suggestions_created_default DEFAULT SYSDATETIMEOFFSET(),
        updated_at           datetimeoffset(3) NOT NULL
                                 CONSTRAINT taxonomy_suggestions_updated_default DEFAULT SYSDATETIMEOFFSET(),

        CONSTRAINT taxonomy_suggestions_kind_check CHECK (kind IN ('locality', 'category')),
        CONSTRAINT taxonomy_suggestions_status_check
            CHECK (status IN ('pending', 'approved', 'rejected', 'already_exists')),
        CONSTRAINT taxonomy_suggestions_name_not_blank
            CHECK (LEN(LTRIM(RTRIM(suggested_name))) > 1 AND LEN(LTRIM(RTRIM(normalised))) > 1),
        /* An approved suggestion points at what it became, and the kind decides which column. A
           pending one points at nothing. This is what stops "approved" meaning "somebody pressed a
           button" rather than "this exists now". */
        CONSTRAINT taxonomy_suggestions_resolution_check CHECK (
            (status = 'approved' AND (
                (kind = 'locality' AND resolved_locality_id IS NOT NULL AND resolved_category_id IS NULL)
                OR (kind = 'category' AND resolved_category_id IS NOT NULL AND resolved_locality_id IS NULL)))
            OR (status <> 'approved' AND resolved_locality_id IS NULL AND resolved_category_id IS NULL)
        ),
        /* A refusal and an "it already exists" both have to say something. The owner asked a
           question; a status on its own is not an answer. */
        CONSTRAINT taxonomy_suggestions_note_check CHECK (
            status NOT IN ('rejected', 'already_exists')
            OR (note IS NOT NULL AND LEN(LTRIM(RTRIM(note))) > 0)
        )
    );
END;
GO

/* One pending request per name per kind. Filtered, so the same name may be asked for again once a
   decision has been made -- a rejection is not a permanent ban on a word. */
IF OBJECT_ID('dbo.taxonomy_suggestions', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'taxonomy_suggestions_pending_key'
                     AND object_id = OBJECT_ID('dbo.taxonomy_suggestions'))
BEGIN
    CREATE UNIQUE INDEX taxonomy_suggestions_pending_key
        ON dbo.taxonomy_suggestions (kind, normalised)
        WHERE status = 'pending';
END;
GO

-- The admin's queue: oldest first within a status, which is the order they are worked in.
IF OBJECT_ID('dbo.taxonomy_suggestions', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'taxonomy_suggestions_queue_idx'
                     AND object_id = OBJECT_ID('dbo.taxonomy_suggestions'))
BEGIN
    CREATE INDEX taxonomy_suggestions_queue_idx
        ON dbo.taxonomy_suggestions (status, created_at)
        INCLUDE (kind, suggested_name);
END;
GO

IF OBJECT_ID('dbo.taxonomy_suggestions', 'U') IS NULL
BEGIN
    THROW 50320, 'S0032: dbo.taxonomy_suggestions was not created.', 1;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'taxonomy_suggestions_pending_key'
      AND object_id = OBJECT_ID('dbo.taxonomy_suggestions')
      AND is_unique = 1 AND has_filter = 1)
BEGIN
    THROW 50321, 'S0032: the pending-duplicate index is missing or is not a filtered unique index.', 1;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.taxonomy_suggestions')
      AND name = 'taxonomy_suggestions_resolution_check')
BEGIN
    THROW 50322, 'S0032: the resolution CHECK is missing, so "approved" could mean nothing was created.', 1;
END;
GO
