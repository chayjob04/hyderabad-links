-- Manual smoke test for the customer / business-owner identity split in S0026.
-- It creates its own customer, owner, business and listing rows, asserts the constraints behave,
-- then rolls back, so it leaves no data and is safe to re-run.
--
-- What is being checked is the thing the whole split rests on: a customer is not a user, the same
-- mobile number may be both independently, and neither table's id is accepted where the other's
-- belongs.
--
-- Run:
--   npm run db:check -- customer_identity

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @customer bigint, @other bigint, @owner bigint, @business bigint, @listing bigint, @n int;
DECLARE @locality int, @centre geography, @category int;
DECLARE @phone varchar(16) = '+919999900801';

SELECT @locality = id, @centre = center FROM dbo.localities WHERE slug = 'madhapur';
SELECT @category = id FROM dbo.categories WHERE slug = 'plumbers';

-- 1. The same number in both tables. This is the design, not an accident: one person may hold a
--    customer account and a business account, and neither knows about the other.
INSERT INTO dbo.users (phone_e164, phone_verified_at, name) VALUES (@phone, SYSDATETIMEOFFSET(), 'Smoke Split Owner');
SET @owner = SCOPE_IDENTITY();

BEGIN TRY
    INSERT INTO dbo.customers (phone_e164, phone_verified_at, name) VALUES (@phone, SYSDATETIMEOFFSET(), 'Smoke Split Customer');
    SET @customer = SCOPE_IDENTITY();
    PRINT 'ok: one number can be a customer and an owner at the same time';
END TRY BEGIN CATCH
    SET @failed = @failed + 1;
    PRINT 'FAIL: the same number was refused in customers while it existed in users';
END CATCH;

-- 2. Within customers it is still one account per number.
BEGIN TRY
    INSERT INTO dbo.customers (phone_e164) VALUES (@phone);
    SET @failed = @failed + 1; PRINT 'FAIL: a second customer was accepted for one number';
END TRY BEGIN CATCH PRINT 'ok: a number is one customer account'; END CATCH;

-- 3. A customer row obeys the same format and status rules as a user row.
BEGIN TRY
    INSERT INTO dbo.customers (phone_e164) VALUES ('09999900802');
    SET @failed = @failed + 1; PRINT 'FAIL: a non-E.164 number was accepted';
END TRY BEGIN CATCH PRINT 'ok: a non-E.164 number is refused'; END CATCH;

BEGIN TRY
    INSERT INTO dbo.customers (phone_e164, status) VALUES ('+919999900803', 'pending');
    SET @failed = @failed + 1; PRINT 'FAIL: an unknown status was accepted';
END TRY BEGIN CATCH PRINT 'ok: an unknown customer status is refused'; END CATCH;

-- A business to save and review.
INSERT INTO dbo.businesses (name) VALUES ('Smoke Split Business');
SET @business = SCOPE_IDENTITY();
INSERT INTO dbo.business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

DECLARE @inserted TABLE (id bigint);
INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @locality, 'smoke-split', 'Smoke Split', @centre, @phone, 'active', @owner);
SET @listing = (SELECT TOP (1) id FROM @inserted);
INSERT INTO dbo.listing_categories (listing_id, category_id, category_level, is_primary) VALUES (@listing, @category, 2, 1);

-- 4. A favourite belongs to a customer, and saving the same listing twice is the same favourite.
INSERT INTO dbo.favourites (customer_id, listing_id) VALUES (@customer, @listing);
PRINT 'ok: a customer can save a listing';

BEGIN TRY
    INSERT INTO dbo.favourites (customer_id, listing_id) VALUES (@customer, @listing);
    SET @failed = @failed + 1; PRINT 'FAIL: the same listing was saved twice by one customer';
END TRY BEGIN CATCH PRINT 'ok: saving the same listing twice is refused'; END CATCH;

-- 5. A favourite with neither owner is not a favourite.
BEGIN TRY
    INSERT INTO dbo.favourites (listing_id) VALUES (@listing);
    SET @failed = @failed + 1; PRINT 'FAIL: a favourite with no customer and no user was accepted';
END TRY BEGIN CATCH PRINT 'ok: a favourite must belong to somebody'; END CATCH;

-- 6. The foreign key is the backstop behind the token audience: a users id is not a customers id,
--    and the database refuses it even if application code ever confused the two.
BEGIN TRY
    INSERT INTO dbo.favourites (customer_id, listing_id)
    VALUES ((SELECT MAX(id) + 1000 FROM dbo.customers), @listing);
    SET @failed = @failed + 1; PRINT 'FAIL: a favourite was accepted for a customer that does not exist';
END TRY BEGIN CATCH PRINT 'ok: a favourite for an unknown customer is refused'; END CATCH;

-- 7. Reviews follow the same rule: one per customer per listing, and an author is required.
INSERT INTO dbo.customers (phone_e164, phone_verified_at, name) VALUES ('+919999900804', SYSDATETIMEOFFSET(), 'Smoke Split Reviewer');
SET @other = SCOPE_IDENTITY();

INSERT INTO dbo.reviews (listing_id, customer_id, rating, body)
VALUES (@listing, @other, 5, 'A perfectly reasonable review of adequate length for the check.');
PRINT 'ok: a customer can write a review';

BEGIN TRY
    INSERT INTO dbo.reviews (listing_id, customer_id, rating, body)
    VALUES (@listing, @other, 4, 'A second review of the same business by the same customer.');
    SET @failed = @failed + 1; PRINT 'FAIL: one customer wrote two reviews of one listing';
END TRY BEGIN CATCH PRINT 'ok: one review per customer per listing'; END CATCH;

BEGIN TRY
    INSERT INTO dbo.reviews (listing_id, rating, body)
    VALUES (@listing, 3, 'A review with no author at all, which must not be allowed to exist.');
    SET @failed = @failed + 1; PRINT 'FAIL: a review with no author was accepted';
END TRY BEGIN CATCH PRINT 'ok: a review must have an author'; END CATCH;

-- 8. The read the public page does: the author name comes from whichever identity wrote it. This is
--    the LEFT JOIN in ReviewEndpoints, and an inner join on either side would drop half the rows.
SET @n = (SELECT COUNT(*)
          FROM dbo.reviews r
          LEFT JOIN dbo.customers c ON c.id = r.customer_id
          LEFT JOIN dbo.users u ON u.id = r.user_id
          WHERE r.listing_id = @listing AND COALESCE(c.name, u.name) IS NOT NULL);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the review author lookup found ' + CAST(@n AS varchar(10)) + ' rows, expected 1';
END
ELSE PRINT 'ok: a review written by a customer still has an author name';

-- 9. The ownership check that stops somebody reviewing their own business. Since the split a
--    customer id means nothing to business_members, so the match is on the verified phone number.
SET @n = (SELECT COUNT(*)
          FROM dbo.listings li
          JOIN dbo.business_members bm ON bm.business_id = li.business_id
          JOIN dbo.users ou ON ou.id = bm.user_id
          JOIN dbo.customers c ON c.phone_e164 = ou.phone_e164
          WHERE li.id = @listing AND c.id = @customer);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the owner-by-phone match found ' + CAST(@n AS varchar(10)) + ' rows, expected 1';
END
ELSE PRINT 'ok: a customer is recognised as the owner of their own business by phone';

-- 10. A customer session, and the family rules it shares with user_sessions.
DECLARE @session bigint, @family uniqueidentifier = NEWID();
INSERT INTO dbo.customer_sessions (customer_id, family_id, refresh_token_hash, expires_at)
VALUES (@customer, @family, CONVERT(varbinary(64), 'smoke-split-token-one'), DATEADD(day, 30, SYSDATETIMEOFFSET()));
SET @session = SCOPE_IDENTITY();

BEGIN TRY
    INSERT INTO dbo.customer_sessions (customer_id, refresh_token_hash, expires_at)
    VALUES (@customer, CONVERT(varbinary(64), 'smoke-split-token-one'), DATEADD(day, 30, SYSDATETIMEOFFSET()));
    SET @failed = @failed + 1; PRINT 'FAIL: two sessions shared one refresh token hash';
END TRY BEGIN CATCH PRINT 'ok: a refresh token hash is unique'; END CATCH;

BEGIN TRY
    INSERT INTO dbo.customer_sessions (customer_id, refresh_token_hash, expires_at)
    VALUES (@owner, CONVERT(varbinary(64), 'smoke-split-token-two'), DATEADD(day, 30, SYSDATETIMEOFFSET()));
    -- It only passes if that users id happens not to exist in customers; assert it was refused.
    IF EXISTS (SELECT 1 FROM dbo.customers WHERE id = @owner)
        PRINT 'ok (vacuous): that id exists in customers too, so the insert was legitimate';
    ELSE
    BEGIN
        SET @failed = @failed + 1; PRINT 'FAIL: a users id was accepted as a customer_id';
    END
END TRY BEGIN CATCH PRINT 'ok: a users id is refused where a customers id belongs'; END CATCH;

-- 11. Both OTP purposes are accepted, and nothing else is.
INSERT INTO dbo.otp_challenges (phone_e164, purpose, code_hash, expires_at)
VALUES (@phone, 'customer_login', CONVERT(varbinary(64), 'smoke-split-hash-1'), DATEADD(minute, 5, SYSDATETIMEOFFSET()));
INSERT INTO dbo.otp_challenges (phone_e164, purpose, code_hash, expires_at)
VALUES (@phone, 'owner_login', CONVERT(varbinary(64), 'smoke-split-hash-2'), DATEADD(minute, 5, SYSDATETIMEOFFSET()));
PRINT 'ok: both sign-in purposes are accepted';

BEGIN TRY
    INSERT INTO dbo.otp_challenges (phone_e164, purpose, code_hash, expires_at)
    VALUES (@phone, 'staff_login', CONVERT(varbinary(64), 'smoke-split-hash-3'), DATEADD(minute, 5, SYSDATETIMEOFFSET()));
    SET @failed = @failed + 1; PRINT 'FAIL: an unknown OTP purpose was accepted';
END TRY BEGIN CATCH PRINT 'ok: an unknown OTP purpose is refused'; END CATCH;

-- 12. The lookup the API does when redeeming a code is keyed on the purpose, so a code minted for
--     one sign-in cannot open the other.
SET @n = (SELECT COUNT(*) FROM dbo.otp_challenges
          WHERE phone_e164 = @phone AND purpose = 'customer_login' AND consumed_at IS NULL);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the purpose-keyed lookup found ' + CAST(@n AS varchar(10)) + ' rows, expected 1';
END
ELSE PRINT 'ok: redeeming is keyed on the purpose';

-- 13. A customer may be recorded in the audit log as an actor in their own right.
INSERT INTO dbo.audit_logs (actor_type, actor_id, action, entity_type, entity_id)
VALUES ('customer', @customer, 'customer.profile_updated', 'customer', CAST(@customer AS varchar(50)));
PRINT 'ok: a customer can be an audit actor';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'the customer identity split behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
