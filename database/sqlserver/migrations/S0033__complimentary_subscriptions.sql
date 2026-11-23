-- S0033: a subscription can be granted by staff, and it says so.
--
-- Every row in `dbo.subscriptions` until now came from a payment: the Razorpay webhook verifies a
-- signature and extends the period. There is no way for the platform owner to put a listing on the
-- Verified plan without one -- not for a business being compensated for a mistake, not for a launch
-- partner, not for a staff member's own listing used to check something.
--
-- Three columns make that possible and make it visible:
--
--     source                'payment' or 'complimentary'. Existing rows become 'payment', which is
--                           what they are: a webhook wrote every one of them.
--     granted_by_admin_id   who granted it. Required for a complimentary one.
--     grant_reason          why. Required for a complimentary one, and read on the screen beside it.
--
-- The CHECK ties them together in both directions: a complimentary period must name an admin and a
-- reason, and a paid one must name neither. That second half matters more than it looks -- it is
-- what stops a complimentary grant being recorded as a payment, which would make a listing look
-- paid-for in a report that somebody later reconciles against Razorpay.
--
-- ---------------------------------------------------------------------------- what this does NOT do
-- **No payment record is created, changed or deleted by a grant.** `subscription_payments` is the
-- record of money and this feature never touches it. A complimentary period is a subscription with
-- no payment behind it, which is exactly what the `source` column says, and the subscription screen
-- shows the two apart.
--
-- Nothing here touches Razorpay, the checkout, or what the owner's own screens let them buy.
--
-- ---------------------------------------------------------------------------- entitlements
-- There is nothing to keep in step. `dbo.listing_entitlements` already decides what a listing may
-- do from "is there an active subscription whose period covers now", so a granted period grants
-- exactly what a paid one of the same plan grants, from the moment it is written, with no job to
-- run. That is the reason this is three columns rather than a parallel table.
--
-- ---------------------------------------------------------------------------- data
-- One backfill: `source` is NOT NULL with a default of 'payment', so every existing row is marked
-- as what it is. No row is deleted, no period is changed, no amount is touched.
--
-- ---------------------------------------------------------------------------- going back
-- database/sqlserver/manual/S0033_down.sql drops the three columns. Any complimentary period
-- already granted stays in force -- it is a subscription row like any other -- but the record of
-- who granted it and why is lost, which is the one thing worth knowing before running it.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ------------------------------------------------------------------ 1. the columns
IF COL_LENGTH('dbo.subscriptions', 'source') IS NULL
BEGIN
    /* NOT NULL with a default, so every existing row is marked 'payment' as it is added -- a
       webhook wrote all of them. Adding a NOT NULL column with a default is a metadata-only change
       in SQL Server for a constant default, so this does not rewrite the table. */
    ALTER TABLE dbo.subscriptions
        ADD source varchar(20) NOT NULL
            CONSTRAINT subscriptions_source_default DEFAULT 'payment';
END;
GO

IF COL_LENGTH('dbo.subscriptions', 'granted_by_admin_id') IS NULL
BEGIN
    ALTER TABLE dbo.subscriptions
        ADD granted_by_admin_id bigint NULL
            CONSTRAINT subscriptions_granted_by_fk REFERENCES dbo.admin_users (id);
END;
GO

IF COL_LENGTH('dbo.subscriptions', 'grant_reason') IS NULL
BEGIN
    ALTER TABLE dbo.subscriptions ADD grant_reason nvarchar(1000) NULL;
END;
GO

-- ------------------------------------------------------------------ 2. the rules
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.subscriptions') AND name = 'subscriptions_source_check')
BEGIN
    ALTER TABLE dbo.subscriptions WITH CHECK
        ADD CONSTRAINT subscriptions_source_check CHECK (source IN ('payment', 'complimentary'));
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.subscriptions') AND name = 'subscriptions_grant_check')
BEGIN
    /* Both ways round. A complimentary period must say who granted it and why -- those are the two
       questions anybody asks about one, and a nullable column nobody filled in is how they stop
       being answerable. A paid period must say neither, which is what keeps a grant from being
       filed as a payment.

       WITH CHECK, so if any existing row would violate it the script fails here rather than leaving
       a constraint that is not true of the data. Every existing row is ('payment', NULL, NULL). */
    ALTER TABLE dbo.subscriptions WITH CHECK
        ADD CONSTRAINT subscriptions_grant_check CHECK (
            (source = 'complimentary'
             AND granted_by_admin_id IS NOT NULL
             AND grant_reason IS NOT NULL
             AND LEN(LTRIM(RTRIM(grant_reason))) > 0)
            OR (source = 'payment' AND granted_by_admin_id IS NULL AND grant_reason IS NULL)
        );
END;
GO

-- ------------------------------------------------------------------ 3. and it took
IF COL_LENGTH('dbo.subscriptions', 'source') IS NULL
   OR COL_LENGTH('dbo.subscriptions', 'granted_by_admin_id') IS NULL
   OR COL_LENGTH('dbo.subscriptions', 'grant_reason') IS NULL
BEGIN
    THROW 50330, 'S0033: the complimentary-subscription columns were not added.', 1;
END;
GO

IF EXISTS (SELECT 1 FROM dbo.subscriptions WHERE source IS NULL OR source NOT IN ('payment', 'complimentary'))
BEGIN
    THROW 50331, 'S0033: a subscription has no usable source after the backfill.', 1;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.subscriptions') AND name = 'subscriptions_grant_check')
BEGIN
    THROW 50332, 'S0033: the grant CHECK is missing, so a complimentary period could hide who gave it.', 1;
END;
GO

/* Every subscription that existed before this script is a payment, and none of them claims to have
   been granted by anybody. If this fails, something has written to these columns already. */
IF EXISTS (
    SELECT 1 FROM dbo.subscriptions
    WHERE source = 'payment' AND (granted_by_admin_id IS NOT NULL OR grant_reason IS NOT NULL))
BEGIN
    THROW 50333, 'S0033: a paid subscription carries grant details. Inspect dbo.subscriptions.', 1;
END;
GO
