-- Verifies the most recent real Razorpay payment, end to end.
--
-- Unlike the other checks in this folder, this one creates nothing. It reads the rows a live
-- payment left behind and asserts they agree with each other — which is the one thing no unit test
-- can establish, because it needs a payment that actually happened.
--
-- It still runs inside a transaction that is rolled back, so it writes nothing and is safe to
-- re-run after any future payment.
--
-- What it is really checking is that the two paths into Subscriptions.RecordVerifiedPaymentAsync —
-- the browser coming back from the checkout, and the webhook arriving independently — converged on
-- one period and one payment rather than each creating their own. That is what the unique indexes
-- on (provider, provider_payment_id) and (provider, webhook_event_id) are for, and a double period
-- or a double payment row is exactly the failure a customer would notice first.
--
-- Run:
--   npm run db:check -- razorpay

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @payment bigint, @listing bigint, @subscription bigint;
DECLARE @amount bigint, @status varchar(20), @provider varchar(30);
DECLARE @paymentId nvarchar(100), @orderId nvarchar(100), @webhookId nvarchar(150);
DECLARE @n int;
DECLARE @name nvarchar(200), @expires datetimeoffset(3);

SELECT TOP (1)
    @payment = p.id, @listing = p.listing_id, @subscription = p.subscription_id,
    @amount = p.amount_paise, @status = p.status, @provider = p.provider,
    @paymentId = p.provider_payment_id, @orderId = p.provider_order_id,
    @webhookId = p.webhook_event_id
FROM dbo.subscription_payments p
ORDER BY p.id DESC;

IF @payment IS NULL
BEGIN
    PRINT 'SKIP: no payment has ever been recorded, so there is nothing to verify.';
END
ELSE
BEGIN
    SELECT @name = li.name FROM dbo.listings li WHERE li.id = @listing;

    PRINT 'Most recent payment: ' + ISNULL(@name, '(listing missing)')
          + ' | ' + @provider + ' | ' + @status
          + ' | ' + CAST(@amount AS varchar(20)) + ' paise';

    -- 1. The amount charged is the plan's price, read from the plans table rather than assumed.
    IF @amount <> (SELECT price_paise FROM dbo.plans WHERE slug = 'verified')
    BEGIN
        SET @failed = @failed + 1;
        PRINT 'FAIL: the amount charged is not the Verified plan price';
    END
    ELSE PRINT 'ok: the amount charged is the Verified plan price';

    -- 2. A captured payment, not one left at 'created'.
    IF @status <> 'paid'
    BEGIN
        SET @failed = @failed + 1; PRINT 'FAIL: the payment status is ' + @status + ', not paid';
    END
    ELSE PRINT 'ok: the payment is recorded as paid';

    /* 3. The provider's own identifiers are kept. Without the payment id there is nothing to
       reconcile a dispute or a refund against in Razorpay's dashboard. */
    IF @paymentId IS NULL OR @orderId IS NULL
    BEGIN
        SET @failed = @failed + 1; PRINT 'FAIL: the provider order id and/or payment id was not stored';
    END
    ELSE PRINT 'ok: the provider order id and payment id are both stored';

    -- 4. The payment is attached to a subscription, not orphaned.
    IF @subscription IS NULL
    BEGIN
        SET @failed = @failed + 1; PRINT 'FAIL: the payment is not linked to a subscription';
    END
    ELSE PRINT 'ok: the payment is linked to a subscription';

    /* 5. One payment row per provider payment id. Both the browser return and the webhook call the
       same recording path, so a second row here would mean the idempotency index is not holding and
       a customer could be counted as paying twice. */
    SET @n = (SELECT COUNT(*) FROM dbo.subscription_payments
              WHERE provider = @provider AND provider_payment_id = @paymentId);
    IF @n <> 1
    BEGIN
        SET @failed = @failed + 1;
        PRINT 'FAIL: ' + CAST(@n AS varchar(10)) + ' rows share this provider payment id';
    END
    ELSE PRINT 'ok: the payment was recorded exactly once';

    /* 6. One active period for the listing. subscriptions_one_active_idx enforces it, so a failure
       here would mean the index is missing rather than that something merely went wrong. */
    SET @n = (SELECT COUNT(*) FROM dbo.subscriptions
              WHERE listing_id = @listing AND status = 'active');
    IF @n <> 1
    BEGIN
        SET @failed = @failed + 1;
        PRINT 'FAIL: the listing has ' + CAST(@n AS varchar(10)) + ' active subscriptions';
    END
    ELSE PRINT 'ok: the listing has exactly one active period';

    -- 7. Roughly a year, read from the row rather than assumed.
    SELECT @expires = expires_at FROM dbo.subscriptions WHERE id = @subscription;
    IF @expires IS NULL OR DATEDIFF(day, SYSDATETIMEOFFSET(), @expires) NOT BETWEEN 360 AND 370
    BEGIN
        SET @failed = @failed + 1; PRINT 'FAIL: the period is not about twelve months long';
    END
    ELSE PRINT 'ok: the period runs about twelve months, to ' + CONVERT(varchar(10), @expires, 23);

    /* 8. The entitlement, read through the view the application actually uses. This is the one that
       matters to the customer: they paid, so the badge and the allowances must be real. */
    IF NOT EXISTS (
        SELECT 1 FROM dbo.listing_entitlements e
        WHERE e.listing_id = @listing
          AND e.is_verified = 1
          AND e.effective_plan_slug = 'verified'
          AND e.photo_limit = 10
          AND e.video_limit = 2
          AND e.link_limit = 5)
    BEGIN
        SET @failed = @failed + 1;
        PRINT 'FAIL: the listing is not Verified with 10 photos, 2 videos and 5 links';
    END
    ELSE PRINT 'ok: the listing is Verified with 10 photos, 2 videos and 5 links';

    /* 9. Whether the webhook arrived. Not a failure if it has not: the browser return already
       applied the payment, and the webhook is the backstop for a customer who closes the tab. It is
       reported because a webhook that never arrives is invisible until the day it is needed. */
    IF @webhookId IS NULL
    BEGIN
        PRINT 'note: no webhook event is recorded against this payment. The browser return applied';
        PRINT '      it. Check the webhook delivery log in Razorpay if this is always empty.';
    END
    ELSE PRINT 'ok: a webhook event was also recorded, and did not create a second period';
END

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'the most recent payment, its subscription and its entitlement all agree';
GO

ROLLBACK TRANSACTION;
GO
