-- Manual smoke test for what suspending a business owner or a customer actually does (audit
-- finding H2). It creates its own owner, customer, business, listing and session rows, asserts the
-- behaviour, then rolls back, so it leaves no data and is safe to re-run.
--
-- The thing being checked is the pair of statements the API runs, written here exactly as it writes
-- them:
--
--   * SessionStore.RevokeAllFor -- ends every live session for one subject, and only that subject's,
--     and leaves an already-revoked session's reason alone (a 'reuse_detected' row is evidence).
--   * ActiveAccount.Realm.Sql   -- the per-request check that refuses a suspended account, which is
--     what closes the up-to-fifteen-minutes an access token had left.
--
-- Suspension used to be `UPDATE users SET status` and nothing else, so the sessions survived and
-- the ownership join never asked about status. Both halves are asserted below.
--
-- Run:
--   npm run db:check -- account_suspension

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @owner bigint, @other bigint, @customer bigint, @business bigint, @listing bigint, @n int;
DECLARE @locality int, @centre geography;
DECLARE @phone varchar(16) = '+919999901101';
DECLARE @otherPhone varchar(16) = '+919999901102';

-- `listings` carries a trigger for the trigram table, and a bare OUTPUT is refused on a table that
-- has one, so the new id comes back through a table variable -- the same pattern as
-- customer_identity_smoke.sql.
DECLARE @inserted TABLE (id bigint);

SELECT @locality = id, @centre = center FROM dbo.localities WHERE slug = 'madhapur';

INSERT INTO dbo.users (phone_e164, phone_verified_at, name) VALUES (@phone, SYSDATETIMEOFFSET(), 'Smoke Suspend Owner');
SET @owner = SCOPE_IDENTITY();

-- A second owner, so the revocation can be shown to be scoped rather than table-wide.
INSERT INTO dbo.users (phone_e164, phone_verified_at, name) VALUES (@otherPhone, SYSDATETIMEOFFSET(), 'Smoke Suspend Bystander');
SET @other = SCOPE_IDENTITY();

INSERT INTO dbo.customers (phone_e164, phone_verified_at, name) VALUES (@phone, SYSDATETIMEOFFSET(), 'Smoke Suspend Customer');
SET @customer = SCOPE_IDENTITY();

INSERT INTO dbo.businesses (name) VALUES ('Smoke Suspend Business');
SET @business = SCOPE_IDENTITY();
INSERT INTO dbo.business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @locality, 'smoke-suspend-listing', 'Smoke Suspend Listing', @centre, @phone, 'active', @owner);
SET @listing = (SELECT TOP (1) id FROM @inserted);

-- Three sessions for the owner: two live, one already revoked for token reuse.
INSERT INTO dbo.user_sessions (user_id, refresh_token_hash, expires_at)
VALUES (@owner, CAST('smoke-suspend-live-1' AS varbinary(64)), DATEADD(day, 30, SYSDATETIMEOFFSET()));
INSERT INTO dbo.user_sessions (user_id, refresh_token_hash, expires_at)
VALUES (@owner, CAST('smoke-suspend-live-2' AS varbinary(64)), DATEADD(day, 30, SYSDATETIMEOFFSET()));
INSERT INTO dbo.user_sessions (user_id, refresh_token_hash, expires_at, revoked_at, revoked_reason)
VALUES (@owner, CAST('smoke-suspend-stolen' AS varbinary(64)), DATEADD(day, 30, SYSDATETIMEOFFSET()),
        SYSDATETIMEOFFSET(), 'reuse_detected');

-- And one for the bystander, which must survive.
INSERT INTO dbo.user_sessions (user_id, refresh_token_hash, expires_at)
VALUES (@other, CAST('smoke-suspend-bystander' AS varbinary(64)), DATEADD(day, 30, SYSDATETIMEOFFSET()));

INSERT INTO dbo.customer_sessions (customer_id, refresh_token_hash, expires_at)
VALUES (@customer, CAST('smoke-suspend-cust' AS varbinary(64)), DATEADD(day, 30, SYSDATETIMEOFFSET()));

-- 1. Before suspension the per-request check finds the account, which is the state every other
--    assertion here is measured against.
SET @n = (SELECT COUNT(*) FROM dbo.users WHERE id = @owner AND status = 'active');
IF @n <> 1
BEGIN SET @failed = @failed + 1; PRINT 'FAIL: an active owner was not found by the active-account check'; END
ELSE PRINT 'ok: an active owner passes the per-request check';

-- 2. Suspend, exactly as SetAccountStatus does: the status change and the revocation together.
UPDATE dbo.users SET status = 'suspended', updated_at = SYSDATETIMEOFFSET()
WHERE id = @owner AND status <> 'deleted';

UPDATE dbo.user_sessions
   SET revoked_at = SYSDATETIMEOFFSET(), revoked_reason = 'suspended'
 WHERE user_id = @owner AND revoked_at IS NULL;

SET @n = @@ROWCOUNT;
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: suspending revoked ' + CAST(@n AS varchar(10)) + ' sessions, expected the 2 live ones';
END
ELSE PRINT 'ok: suspending revokes every live session and no more';

-- 3. The already-revoked row keeps the reason it was revoked for. Overwriting 'reuse_detected'
--    would erase the record of a stolen token.
SET @n = (SELECT COUNT(*) FROM dbo.user_sessions
          WHERE user_id = @owner AND revoked_reason = 'reuse_detected');
IF @n <> 1
BEGIN SET @failed = @failed + 1; PRINT 'FAIL: the reuse_detected reason was overwritten'; END
ELSE PRINT 'ok: an already-revoked session keeps its original reason';

-- 4. Nothing live is left to rotate.
SET @n = (SELECT COUNT(*) FROM dbo.user_sessions WHERE user_id = @owner AND revoked_at IS NULL);
IF @n <> 0
BEGIN SET @failed = @failed + 1; PRINT 'FAIL: a live session survived the suspension'; END
ELSE PRINT 'ok: no live session survives the suspension';

-- 5. Another owner's session is untouched: the statement is scoped to one subject.
SET @n = (SELECT COUNT(*) FROM dbo.user_sessions WHERE user_id = @other AND revoked_at IS NULL);
IF @n <> 1
BEGIN SET @failed = @failed + 1; PRINT 'FAIL: another owner lost their session'; END
ELSE PRINT 'ok: only the suspended account loses its sessions';

-- 6. The per-request check now refuses the suspended owner. This is the half that closes the
--    access token's remaining minutes: without it, the token kept working until it expired.
SET @n = (SELECT COUNT(*) FROM dbo.users WHERE id = @owner AND status = 'active');
IF @n <> 0
BEGIN SET @failed = @failed + 1; PRINT 'FAIL: a suspended owner still passes the active-account check'; END
ELSE PRINT 'ok: a suspended owner is refused on every request';

-- 7. The listing is deliberately still there. Suspending an account stops the person acting; it is
--    not a takedown, and the super-admin screen says so. Asserted so nobody "fixes" it quietly.
SET @n = (SELECT COUNT(*) FROM dbo.listings WHERE id = @listing AND status = 'active');
IF @n <> 1
BEGIN SET @failed = @failed + 1; PRINT 'FAIL: suspending the owner changed the listing'; END
ELSE PRINT 'ok: suspending an owner leaves their listings alone';

-- 8. Ownership on its own is not permission to act. This is the join every owner route uses; with
--    the status test added it finds nothing for a suspended owner, which is the belt to the
--    filter's braces.
SET @n = (SELECT COUNT(*)
          FROM dbo.listings li
          JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @owner
          JOIN dbo.users u ON u.id = bm.user_id AND u.status = 'active'
          WHERE li.id = @listing);
IF @n <> 0
BEGIN SET @failed = @failed + 1; PRINT 'FAIL: a suspended owner still resolves their own listing'; END
ELSE PRINT 'ok: a suspended owner resolves none of their listings';

-- 9. Reinstating restores the account but not the sessions: the person signs in again.
UPDATE dbo.users SET status = 'active', updated_at = SYSDATETIMEOFFSET() WHERE id = @owner;

SET @n = (SELECT COUNT(*) FROM dbo.users WHERE id = @owner AND status = 'active');
IF @n <> 1
BEGIN SET @failed = @failed + 1; PRINT 'FAIL: reinstating did not restore the account'; END
ELSE PRINT 'ok: reinstating restores the account';

SET @n = (SELECT COUNT(*) FROM dbo.user_sessions WHERE user_id = @owner AND revoked_at IS NULL);
IF @n <> 0
BEGIN SET @failed = @failed + 1; PRINT 'FAIL: reinstating brought a revoked session back to life'; END
ELSE PRINT 'ok: reinstating does not resurrect a session';

-- 10. The same statement, on the customer realm's own table and column.
UPDATE dbo.customers SET status = 'suspended', updated_at = SYSDATETIMEOFFSET() WHERE id = @customer;

UPDATE dbo.customer_sessions
   SET revoked_at = SYSDATETIMEOFFSET(), revoked_reason = 'suspended'
 WHERE customer_id = @customer AND revoked_at IS NULL;

SET @n = @@ROWCOUNT;
IF @n <> 1
BEGIN SET @failed = @failed + 1; PRINT 'FAIL: the customer session was not revoked'; END
ELSE PRINT 'ok: a suspended customer loses their sessions too';

SET @n = (SELECT COUNT(*) FROM dbo.customers WHERE id = @customer AND status = 'active');
IF @n <> 0
BEGIN SET @failed = @failed + 1; PRINT 'FAIL: a suspended customer still passes the active-account check'; END
ELSE PRINT 'ok: a suspended customer is refused on every request';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'suspension ended the sessions and closed the account, and left everything else alone';
GO

ROLLBACK TRANSACTION;
GO
