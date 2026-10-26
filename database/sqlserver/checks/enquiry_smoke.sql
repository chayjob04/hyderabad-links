-- Manual smoke test for the enquiry rules in S0004.
-- It creates its own owners, listings and enquiries, asserts the isolation and constraint rules,
-- then rolls back, so it leaves no data and is safe to re-run.
--
-- The PostgreSQL original is database/checks/enquiry_smoke.sql, kept as history. The one real
-- difference is the ownership-scoped UPDATE. PostgreSQL writes `UPDATE enquiries e ... FROM
-- listings li JOIN business_members bm`; SQL Server puts the target table in the FROM clause and
-- aliases it in the SET, so the same statement reads `UPDATE e SET ... FROM enquiries e JOIN ...`.
-- Getting that wrong is how an ownership filter silently stops filtering, so both directions are
-- asserted below: the wrong owner must match nothing, the right owner must match both rows.
--
-- Run:
--   npm run db:check -- enquiry_smoke

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @one bigint, @two bigint, @b1 bigint, @b2 bigint, @l1 bigint, @l2 bigint, @n int, @rows int;
DECLARE @locality int, @centre geography, @category int;

SELECT @locality = id, @centre = center FROM localities WHERE slug = 'madhapur';
SELECT @category = id FROM categories WHERE slug = 'plumbers';

INSERT INTO users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900101', SYSDATETIMEOFFSET(), 'Smoke Owner One', 'one@example.com');
SET @one = SCOPE_IDENTITY();
INSERT INTO users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900102', SYSDATETIMEOFFSET(), 'Smoke Owner Two', 'two@example.com');
SET @two = SCOPE_IDENTITY();

DECLARE @inserted TABLE (id bigint);

INSERT INTO businesses (name) VALUES ('Smoke Enquiry One');
SET @b1 = SCOPE_IDENTITY();
INSERT INTO business_members (business_id, user_id, role) VALUES (@b1, @one, 'owner');
INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
OUTPUT inserted.id INTO @inserted
VALUES (@b1, @locality, 'smoke-enq-one', 'Smoke Enq One', @centre, '+919999900101', 'active', @one);
SET @l1 = (SELECT TOP (1) id FROM @inserted);
DELETE FROM @inserted;
INSERT INTO listing_categories (listing_id, category_id, category_level, is_primary) VALUES (@l1, @category, 2, 1);

INSERT INTO businesses (name) VALUES ('Smoke Enquiry Two');
SET @b2 = SCOPE_IDENTITY();
INSERT INTO business_members (business_id, user_id, role) VALUES (@b2, @two, 'owner');
INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
OUTPUT inserted.id INTO @inserted
VALUES (@b2, @locality, 'smoke-enq-two', 'Smoke Enq Two', @centre, '+919999900102', 'active', @two);
SET @l2 = (SELECT TOP (1) id FROM @inserted);
INSERT INTO listing_categories (listing_id, category_id, category_level, is_primary) VALUES (@l2, @category, 2, 1);

INSERT INTO enquiries (listing_id, name, phone_e164, message)
VALUES (@l1, 'Customer A', '+919876500001', 'Please call me about a leaking tap today.'),
       (@l1, 'Customer B', '+919876500002', 'Do you work on Sundays at all? Need a quote.'),
       (@l2, 'Customer C', '+919876500003', 'Looking for a quote on bathroom fitting.');

-- 1. An enquiry arrives unread.
SET @n = (SELECT COUNT(*) FROM enquiries WHERE listing_id = @l1 AND status = 'new');
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: expected 2 new enquiries for owner one, found ' + CAST(@n AS varchar(10));
END
ELSE PRINT 'ok: an enquiry arrives unread';

-- 2. Isolation: each owner sees only their own, through business_members.
SET @n = (SELECT COUNT(*) FROM enquiries e
          JOIN listings li ON li.id = e.listing_id
          JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @one);
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: owner one saw ' + CAST(@n AS varchar(10)) + ' enquiries, expected 2';
END
ELSE PRINT 'ok: owner one sees their two enquiries';

SET @n = (SELECT COUNT(*) FROM enquiries e
          JOIN listings li ON li.id = e.listing_id
          JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @two);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: owner two saw ' + CAST(@n AS varchar(10)) + ' enquiries, expected 1';
END
ELSE PRINT 'ok: owner two sees only their own';

-- 3. The ownership-scoped UPDATE the endpoint runs matches nothing for the wrong owner.
UPDATE e SET status = 'read', updated_at = SYSDATETIMEOFFSET()
FROM enquiries e
JOIN listings li ON li.id = e.listing_id
JOIN business_members bm ON bm.business_id = li.business_id
WHERE e.listing_id = @l1 AND bm.user_id = @two;
SET @rows = @@ROWCOUNT;
IF @rows <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: owner two changed ' + CAST(@rows AS varchar(10)) + ' of owner one''s enquiries';
END
ELSE PRINT 'ok: the wrong owner changes nothing';

-- 4. And it does match for the right one.
UPDATE e SET status = 'replied', updated_at = SYSDATETIMEOFFSET()
FROM enquiries e
JOIN listings li ON li.id = e.listing_id
JOIN business_members bm ON bm.business_id = li.business_id
WHERE e.listing_id = @l1 AND bm.user_id = @one;
SET @rows = @@ROWCOUNT;
IF @rows <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: owner one changed ' + CAST(@rows AS varchar(10)) + ' of their own enquiries, expected 2';
END
ELSE PRINT 'ok: the right owner changes both of their own';

-- 5. The constraints refuse rubbish, so a bug in the API cannot store it.
BEGIN TRY
    INSERT INTO enquiries (listing_id, name, phone_e164, message)
    VALUES (@l1, 'Too Short', '+919876500004', 'hi');
    SET @failed = @failed + 1; PRINT 'FAIL: a too-short message was accepted';
END TRY BEGIN CATCH PRINT 'ok: short message rejected'; END CATCH;

BEGIN TRY
    INSERT INTO enquiries (listing_id, name, phone_e164, message)
    VALUES (@l1, 'Bad Phone', '98765', 'This message is long enough to pass.');
    SET @failed = @failed + 1; PRINT 'FAIL: a non-E.164 phone number was accepted';
END TRY BEGIN CATCH PRINT 'ok: bad phone rejected'; END CATCH;

BEGIN TRY
    INSERT INTO enquiries (listing_id, name, phone_e164, email, message)
    VALUES (@l1, 'Upper Email', '+919876500005', 'Mixed@Example.com', 'This message is long enough.');
    SET @failed = @failed + 1; PRINT 'FAIL: a mixed-case email was accepted';
END TRY BEGIN CATCH PRINT 'ok: mixed-case email rejected'; END CATCH;

BEGIN TRY
    INSERT INTO enquiries (listing_id, name, phone_e164, message, status)
    VALUES (@l1, 'Bad Status', '+919876500006', 'This message is long enough.', 'archived');
    SET @failed = @failed + 1; PRINT 'FAIL: an unknown status was accepted';
END TRY BEGIN CATCH PRINT 'ok: unknown status rejected'; END CATCH;

-- 6. Deleting a listing takes its enquiries with it, so no orphaned customer data is left.
DELETE FROM listing_categories WHERE listing_id = @l2;
DELETE FROM listings WHERE id = @l2;
SET @n = (SELECT COUNT(*) FROM enquiries WHERE listing_id = @l2);
IF @n <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: ' + CAST(@n AS varchar(10)) + ' enquiries outlived their listing';
END
ELSE PRINT 'ok: enquiries do not outlive their listing';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'enquiry rules behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
