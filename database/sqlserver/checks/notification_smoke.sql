-- Manual smoke test for the notification rules in S0007.
-- It creates its own owner, listing, enquiry and notification rows, asserts the constraints behave,
-- then rolls back, so it leaves no data and is safe to re-run.
--
-- The PostgreSQL original is database/checks/notification_smoke.sql, kept as history. What changed:
-- the escape-string literal E'...\n...' became an explicit CHAR(10) concatenation, since T-SQL has
-- no backslash escapes in string literals -- which matters, because 'a\nb' in SQL Server is the
-- six literal characters and would have tested nothing at all.
--
-- Run:
--   npm run db:check -- notification_smoke

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @owner bigint, @business bigint, @listing bigint, @enquiry bigint, @note bigint, @n int;
DECLARE @locality int, @centre geography, @category int;

SELECT @locality = id, @centre = center FROM localities WHERE slug = 'madhapur';
SELECT @category = id FROM categories WHERE slug = 'plumbers';

INSERT INTO users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900301', SYSDATETIMEOFFSET(), 'Smoke Notify Owner', 'notify.owner@example.com');
SET @owner = SCOPE_IDENTITY();

INSERT INTO businesses (name) VALUES ('Smoke Notify Business');
SET @business = SCOPE_IDENTITY();
INSERT INTO business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

DECLARE @inserted TABLE (id bigint);
INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @locality, 'smoke-notify', 'Smoke Notify', @centre, '+919999900301', 'active', @owner);
SET @listing = (SELECT TOP (1) id FROM @inserted);
INSERT INTO listing_categories (listing_id, category_id, category_level, is_primary) VALUES (@listing, @category, 2, 1);

INSERT INTO enquiries (listing_id, name, phone_e164, message)
VALUES (@listing, 'Customer N', '+919876500301', 'Please call me about a blocked drain today.');
SET @enquiry = SCOPE_IDENTITY();

-- 1. A notification arrives the way the API writes it: pending, never attempted.
INSERT INTO notifications (kind, channel, recipient, user_id, subject_type, subject_id)
VALUES ('enquiry_received', 'email', 'notify.owner@example.com', @owner, 'enquiry', @enquiry);
SET @note = SCOPE_IDENTITY();

IF NOT EXISTS (SELECT 1 FROM notifications
               WHERE id = @note AND status = 'pending' AND attempts = 0
                 AND sent_at IS NULL AND error IS NULL)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a new notification was not pending and untouched';
END
ELSE PRINT 'ok: a new notification is pending and untouched';

-- 2. The query the owner-lookup relies on: the listing's owner, with an address to send to.
SET @n = (SELECT COUNT(*) FROM listings li
          JOIN business_members bm ON bm.business_id = li.business_id AND bm.role = 'owner'
          JOIN users u ON u.id = bm.user_id
          WHERE li.id = @listing AND u.email IS NOT NULL);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the listing owner with an email was not found, got ' + CAST(@n AS varchar(10)) + ' rows';
END
ELSE PRINT 'ok: the owner lookup finds exactly one address';

-- 3. Marking it sent, the way the API does after the provider accepts it.
UPDATE notifications
SET status = 'sent', attempts = attempts + 1, sent_at = SYSDATETIMEOFFSET(),
    error = NULL, updated_at = SYSDATETIMEOFFSET()
WHERE id = @note;
IF (SELECT sent_at FROM notifications WHERE id = @note) IS NULL
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a sent notification has no sent_at';
END
ELSE PRINT 'ok: a sent notification records when it went out';

-- 4. A sent row may not also carry a failure reason: the two states cannot both be true.
BEGIN TRY
    UPDATE notifications SET error = 'something went wrong' WHERE id = @note;
    SET @failed = @failed + 1; PRINT 'FAIL: a sent notification accepted an error';
END TRY BEGIN CATCH PRINT 'ok: sent plus error rejected'; END CATCH;

-- 5. A failure must say why, and must not look like it went out.
INSERT INTO notifications (kind, channel, recipient, user_id, subject_type, subject_id)
VALUES ('listing_rejected', 'email', 'notify.owner@example.com', @owner, 'listing', @listing);
SET @note = SCOPE_IDENTITY();

BEGIN TRY
    UPDATE notifications SET status = 'failed', attempts = 1, updated_at = SYSDATETIMEOFFSET()
    WHERE id = @note;
    SET @failed = @failed + 1; PRINT 'FAIL: a failed notification was accepted with no reason';
END TRY BEGIN CATCH PRINT 'ok: failed without a reason rejected'; END CATCH;

UPDATE notifications
SET status = 'failed', attempts = attempts + 1,
    error = 'InvalidOperationException: No email provider is configured (Email:Provider).',
    updated_at = SYSDATETIMEOFFSET()
WHERE id = @note;

BEGIN TRY
    UPDATE notifications SET sent_at = SYSDATETIMEOFFSET() WHERE id = @note;
    SET @failed = @failed + 1; PRINT 'FAIL: a failed notification accepted a sent_at';
END TRY BEGIN CATCH PRINT 'ok: failed plus sent_at rejected'; END CATCH;

-- 6. A pending row may not pretend to have been attempted.
BEGIN TRY
    INSERT INTO notifications (kind, channel, recipient, user_id, subject_type, subject_id, attempts)
    VALUES ('listing_approved', 'email', 'notify.owner@example.com', @owner, 'listing', @listing, 2);
    SET @failed = @failed + 1; PRINT 'FAIL: a pending notification was accepted with attempts';
END TRY BEGIN CATCH PRINT 'ok: pending with attempts rejected'; END CATCH;

-- 7. The enumerations refuse anything the API does not handle.
BEGIN TRY
    INSERT INTO notifications (kind, channel, recipient, subject_type, subject_id)
    VALUES ('owner_birthday', 'email', 'notify.owner@example.com', 'listing', @listing);
    SET @failed = @failed + 1; PRINT 'FAIL: an unknown kind was accepted';
END TRY BEGIN CATCH PRINT 'ok: unknown kind rejected'; END CATCH;

-- ...and accept every kind the API does send. 'subscription_activated' is the receipt for a paid
-- period, added by S0013: before that migration the kind constraint allowed only three values, so
-- the row could not be recorded and a paying customer would have had no confirmation at all.
BEGIN TRY
    INSERT INTO notifications (kind, channel, recipient, subject_type, subject_id)
    VALUES ('subscription_activated', 'email', 'notify.owner@example.com', 'listing', @listing);
    PRINT 'ok: a subscription receipt can be recorded';
    -- Removed again: the assertions further down count this listing's notifications, and an extra
    -- row left here makes them describe something the check did not set up. (It did, first time
    -- round: "expected 2 unsent notifications, found 3".)
    DELETE FROM notifications WHERE kind = 'subscription_activated' AND subject_id = @listing;
END TRY
BEGIN CATCH
    SET @failed = @failed + 1;
    PRINT 'FAIL: the subscription receipt kind was refused - ' + ERROR_MESSAGE();
END CATCH;

BEGIN TRY
    INSERT INTO notifications (kind, channel, recipient, subject_type, subject_id)
    VALUES ('listing_approved', 'pigeon', 'notify.owner@example.com', 'listing', @listing);
    SET @failed = @failed + 1; PRINT 'FAIL: an unknown channel was accepted';
END TRY BEGIN CATCH PRINT 'ok: unknown channel rejected'; END CATCH;

BEGIN TRY
    INSERT INTO notifications (kind, channel, recipient, subject_type, subject_id)
    VALUES ('listing_approved', 'email', 'notify.owner@example.com', 'invoice', @listing);
    SET @failed = @failed + 1; PRINT 'FAIL: an unknown subject type was accepted';
END TRY BEGIN CATCH PRINT 'ok: unknown subject type rejected'; END CATCH;

BEGIN TRY
    INSERT INTO notifications (kind, channel, recipient, subject_type, subject_id, status)
    VALUES ('listing_approved', 'email', 'notify.owner@example.com', 'listing', @listing, 'queued');
    SET @failed = @failed + 1; PRINT 'FAIL: an unknown status was accepted';
END TRY BEGIN CATCH PRINT 'ok: unknown status rejected'; END CATCH;

-- 8. The email address rules: no blank, no mixed case, and no whitespace. A newline in an address
--    is how a header injection would reach a provider.
BEGIN TRY
    INSERT INTO notifications (kind, channel, recipient, subject_type, subject_id)
    VALUES ('listing_approved', 'email', '   ', 'listing', @listing);
    SET @failed = @failed + 1; PRINT 'FAIL: a blank recipient was accepted';
END TRY BEGIN CATCH PRINT 'ok: blank recipient rejected'; END CATCH;

BEGIN TRY
    INSERT INTO notifications (kind, channel, recipient, subject_type, subject_id)
    VALUES ('listing_approved', 'email', 'Mixed@Example.com', 'listing', @listing);
    SET @failed = @failed + 1; PRINT 'FAIL: a mixed-case recipient was accepted';
END TRY BEGIN CATCH PRINT 'ok: mixed-case recipient rejected'; END CATCH;

BEGIN TRY
    INSERT INTO notifications (kind, channel, recipient, subject_type, subject_id)
    VALUES ('listing_approved', 'email',
            'owner@example.com' + CHAR(10) + 'bcc: someone@else.com', 'listing', @listing);
    SET @failed = @failed + 1; PRINT 'FAIL: a recipient containing a newline was accepted';
END TRY BEGIN CATCH PRINT 'ok: newline in a recipient rejected'; END CATCH;

BEGIN TRY
    INSERT INTO notifications (kind, channel, recipient, subject_type, subject_id)
    VALUES ('listing_approved', 'email', 'not-an-address', 'listing', @listing);
    SET @failed = @failed + 1; PRINT 'FAIL: a recipient with no @ was accepted';
END TRY BEGIN CATCH PRINT 'ok: recipient with no @ rejected'; END CATCH;

-- A number is a valid recipient on the sms channel, where the email rule does not apply.
INSERT INTO notifications (kind, channel, recipient, subject_type, subject_id)
VALUES ('listing_approved', 'sms', '+919999900301', 'listing', @listing);
PRINT 'ok: a phone number is accepted on the sms channel';

-- 9. Everything that has not gone out, which is what the filtered index is for.
SET @n = (SELECT COUNT(*) FROM notifications WHERE status <> 'sent' AND subject_id = @listing);
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: expected 2 unsent notifications for the listing, found ' + CAST(@n AS varchar(10));
END
ELSE PRINT 'ok: the unsent queue holds the two expected rows';

-- 10. Losing the owner's account keeps the delivery record: it still says where we sent.
DELETE FROM notifications WHERE user_id = @owner AND subject_type = 'enquiry';
DELETE FROM enquiries WHERE listing_id = @listing;
DELETE FROM listing_categories WHERE listing_id = @listing;
DELETE FROM listings WHERE id = @listing;
DELETE FROM business_members WHERE user_id = @owner;
DELETE FROM users WHERE id = @owner;

SET @n = (SELECT COUNT(*) FROM notifications
          WHERE subject_id = @listing AND user_id IS NULL
            AND recipient = 'notify.owner@example.com');
IF @n < 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the delivery record did not outlive the account';
END
ELSE PRINT 'ok: the delivery record outlives the account';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'notification rules behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
