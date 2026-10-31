-- S0019: when a business is open.
--
-- The single most asked question about a local business, and the directory could not answer it.
-- The original Hyderabad Links site stored it; this brings it across.
--
-- Free as well as paid, deliberately. Withholding opening hours would make the directory worse for
-- the visitor, who is not the one paying, and a listing that cannot say when it opens is a listing
-- people stop trusting.
--
-- Additive: one new table. Nothing existing is altered.
--
-- DESIGN NOTES, because the table looks simpler than the problem is.
--
--   * One row per OPEN INTERVAL, not one row per day. A business that closes for lunch has two
--     rows for Monday. A day with no rows is closed. That is why there is no `is_closed` column:
--     absence already means it, and a flag beside the times would let the two disagree.
--
--   * `closes_at` may be EARLIER than `opens_at`, and that is not a mistake. A restaurant open
--     18:00-02:00 crosses midnight. The check constraint therefore cannot require closes > opens;
--     the "is it open now" logic handles the wrap, and a check that forbade it would silently make
--     every late-night business unrepresentable.
--
--   * `time(0)` rather than datetimeoffset: these are wall-clock times in Hyderabad, not instants.
--     09:00 is 09:00 whatever the reader's timezone, and storing an offset would invite a bug
--     where a visitor in another country sees different hours.
--
--   * No holidays. A real holiday calendar needs a source of truth for Indian public holidays and
--     per-business overrides, which is a feature of its own. This is left out on purpose rather
--     than half-built, so nothing here implies the answer accounts for Diwali.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.listing_opening_hours', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.listing_opening_hours (
        id          bigint IDENTITY(1,1) NOT NULL
                        CONSTRAINT listing_opening_hours_pkey PRIMARY KEY,
        listing_id  bigint NOT NULL CONSTRAINT listing_opening_hours_listing_fk
                        REFERENCES dbo.listings (id) ON DELETE CASCADE,
        -- 0 = Monday through 6 = Sunday. Monday-first because that is how an Indian high street
        -- reads a week, and because ISO-8601 agrees.
        day_of_week tinyint NOT NULL,
        opens_at    time(0) NOT NULL,
        closes_at   time(0) NOT NULL,
        created_at  datetimeoffset(3) NOT NULL
                        CONSTRAINT listing_opening_hours_created_default DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT listing_opening_hours_day_check CHECK (day_of_week BETWEEN 0 AND 6),
        /* Equal times would be a zero-length interval, which says nothing and would make a
           business look closed all day while appearing to have hours set. */
        CONSTRAINT listing_opening_hours_not_empty CHECK (opens_at <> closes_at)
    );
END
GO

/* The listing page asks for every interval on a listing, in day order. That is the only query
   this table has. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'listing_opening_hours_listing_idx'
                 AND object_id = OBJECT_ID('dbo.listing_opening_hours'))
BEGIN
    CREATE INDEX listing_opening_hours_listing_idx
        ON dbo.listing_opening_hours (listing_id, day_of_week, opens_at);
END
GO

IF OBJECT_ID('dbo.listing_opening_hours', 'U') IS NULL
BEGIN
    THROW 51025, 'S0019 did not create dbo.listing_opening_hours.', 1;
END
GO
