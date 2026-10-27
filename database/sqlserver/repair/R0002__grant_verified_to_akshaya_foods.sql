-- Repair 0002: give AKSHAYA FOODS a Verified period, so the owner can exercise the paid features.
--
-- Asked for by the owner on 2026-10-27: they want to see the badge, the 10-photo / 2-video
-- allowance and the website and social links working before a real payment has ever been taken.
--
-- **No payment is recorded, and that is deliberate.** A real activation writes a row to
-- `subscription_payments` as well, because a customer paid. Nobody paid here, so writing one would
-- put a transaction in the books that never happened and would show up in every revenue figure
-- taken from that table. This grants the entitlement and leaves the ledger honest; the row below
-- is a comped period, which is what it actually is.
--
-- Only an INSERT. `listing_entitlements` (S0009) derives the whole allowance from `subscriptions`
-- against the clock, so this one row is enough to make the listing Verified on the next request,
-- with nothing to run and no cache to clear.
--
-- `listings.plan_slug` is deliberately NOT touched. The repair folder forbids UPDATE, and that
-- column grants nothing: it only lets the dashboard say "your Verified plan ended on the 3rd"
-- after a period lapses. The one visible consequence is that the subscription screen will show
-- this listing as having bought nothing, which, for a comped period, is true.
--
-- Guarded three ways and safe to re-run: it refuses if the listing is missing or ambiguous, and
-- does nothing at all if an active period already exists (subscriptions_one_active_idx allows only
-- one, so a second insert would be refused by the index anyway).
--
-- TO UNDO, when the test is over:
--   DELETE FROM dbo.subscriptions
--   WHERE listing_id = (SELECT id FROM dbo.listings WHERE name = 'AKSHAYA FOODS')
--     AND plan_slug = 'verified';
-- The listing drops back to Free on the very next request. Media over the Free allowance is kept
-- and hidden, never deleted (D10), so nothing uploaded during the test is lost.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

DECLARE @listing bigint;
DECLARE @matches int;

SELECT @matches = COUNT(*) FROM dbo.listings WHERE name = 'AKSHAYA FOODS';

IF @matches = 0
BEGIN
    THROW 52001, 'No listing is named AKSHAYA FOODS. Nothing was changed.', 1;
END

IF @matches > 1
BEGIN
    -- Refused rather than guessed: granting a paid period to the wrong business is not something
    -- to discover later.
    THROW 52002, 'More than one listing is named AKSHAYA FOODS. Name the id instead.', 1;
END

SELECT TOP (1) @listing = id FROM dbo.listings WHERE name = 'AKSHAYA FOODS';

IF EXISTS (
    SELECT 1 FROM dbo.subscriptions
    WHERE listing_id = @listing
      AND status = 'active'
      AND starts_at <= SYSDATETIMEOFFSET()
      AND expires_at > SYSDATETIMEOFFSET())
BEGIN
    PRINT 'R0002: AKSHAYA FOODS already has an active period. Nothing to do.';
END
ELSE
BEGIN
    /* starts_at one millisecond in the past, for the reason Subscriptions.cs gives: the column is
       datetimeoffset(3) and rounds up, and the view requires starts_at <= now, so a value taken at
       exactly now can read as "not yet started" for up to half a millisecond. */
    INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
    VALUES (@listing, 'verified', 'active',
            DATEADD(millisecond, -1, SYSDATETIMEOFFSET()),
            DATEADD(month, 12, SYSDATETIMEOFFSET()));

    PRINT 'R0002: AKSHAYA FOODS is Verified for 12 months. No payment was recorded.';
END
GO

-- What must be true afterwards, read back through the view the application actually uses.
IF NOT EXISTS (
    SELECT 1
    FROM dbo.listings li
    JOIN dbo.listing_entitlements e ON e.listing_id = li.id
    WHERE li.name = 'AKSHAYA FOODS'
      AND e.is_verified = 1
      AND e.effective_plan_slug = 'verified'
      AND e.photo_limit = 10
      AND e.video_limit = 2)
BEGIN
    THROW 52003, 'AKSHAYA FOODS did not come out Verified with 10 photos and 2 videos.', 1;
END
GO
