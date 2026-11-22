-- Manual smoke test for the guards that stop the platform being stranded (S0003, S0028).
--
-- Two super-admin operations can leave nobody able to undo them: taking the super_admin role away,
-- and disabling the account that holds it. `SuperAdminEndpoints.SetRoles` and `SetStatus` both
-- refuse when no *other* active super admin would remain, asked inside the transaction against the
-- rows as they are about to be. That counting query is the whole guard, so this asserts the query
-- rather than the C# around it.
--
-- The query matters more than it looks. An earlier version fired only when you were editing
-- yourself, which missed the case that actually strands a platform: a super admin removing the role
-- from the *other* super admin and then losing their own account. The question asked now is simply
-- "would any active super admin remain?", so whose account is being edited no longer matters -- and
-- the `au.status = 'active'` half is what stops a disabled super admin being counted as cover.
--
-- Also covered: session revocation, which is what stops a token already issued from being
-- refreshable after an account is disabled.
--
-- It creates its own admin accounts and sessions, asserts, then rolls back, so it leaves no data
-- and is safe to re-run. Every email is prefixed `smoke-lock-`. **No existing account is read,
-- changed or counted** -- every assertion is scoped to the rows this script created, so the real
-- super admin is neither relied upon nor affected.
--
-- Run:
--   npm run db:check -- admin_lockout

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @superRole int, @adminRole int;
DECLARE @soleSuper bigint, @secondSuper bigint, @ordinary bigint;
DECLARE @others bigint, @n int;

SELECT @superRole = id FROM dbo.roles WHERE slug = 'super_admin';
SELECT @adminRole = id FROM dbo.roles WHERE slug = 'admin';

IF @superRole IS NULL OR @adminRole IS NULL
BEGIN
    PRINT 'FAIL: the admin and/or super_admin role is missing. Run the reference seeds: npm run db:migrate';
    SET @failed = @failed + 1;
END
ELSE PRINT 'ok: both system roles exist';

-- ------------------------------------------------------------------ 1. fixtures
INSERT INTO dbo.admin_users (email, display_name, password_hash, status)
VALUES ('smoke-lock-sole@example.com', 'Smoke Lock Sole', 'not-a-real-hash', 'active');
SET @soleSuper = SCOPE_IDENTITY();

INSERT INTO dbo.admin_users (email, display_name, password_hash, status)
VALUES ('smoke-lock-second@example.com', 'Smoke Lock Second', 'not-a-real-hash', 'disabled');
SET @secondSuper = SCOPE_IDENTITY();

INSERT INTO dbo.admin_users (email, display_name, password_hash, status)
VALUES ('smoke-lock-ordinary@example.com', 'Smoke Lock Ordinary', 'not-a-real-hash', 'active');
SET @ordinary = SCOPE_IDENTITY();

-- Both "supers" hold the role; the second one is disabled, so it must not count as cover.
INSERT INTO dbo.admin_user_roles (admin_user_id, role_id)
VALUES (@soleSuper, @superRole), (@secondSuper, @superRole), (@ordinary, @adminRole);

-- ------------------------------------------------------------------ 2. a disabled super admin is not cover
/* The guard's query, scoped to this script's rows. Counting only active holders is the point: a
   disabled account cannot sign in, so leaving it as the only super admin stands nobody up. */
SELECT @others = COUNT_BIG(*)
FROM dbo.admin_user_roles aur
JOIN dbo.roles r ON r.id = aur.role_id
JOIN dbo.admin_users au ON au.id = aur.admin_user_id
WHERE r.slug = 'super_admin'
  AND au.status = 'active'
  AND au.id <> @soleSuper
  AND au.email LIKE 'smoke-lock-%';

IF @others <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a disabled super admin was counted as cover (' + CAST(@others AS varchar(20)) + ' others found)';
END
ELSE PRINT 'ok: a disabled super admin does not count, so the guard would refuse';

-- ------------------------------------------------------------------ 3. an active second super admin is cover
UPDATE dbo.admin_users SET status = 'active' WHERE id = @secondSuper;

SELECT @others = COUNT_BIG(*)
FROM dbo.admin_user_roles aur
JOIN dbo.roles r ON r.id = aur.role_id
JOIN dbo.admin_users au ON au.id = aur.admin_user_id
WHERE r.slug = 'super_admin'
  AND au.status = 'active'
  AND au.id <> @soleSuper
  AND au.email LIKE 'smoke-lock-%';

IF @others <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: an active second super admin was not counted as cover (' + CAST(@others AS varchar(20)) + ')';
END
ELSE PRINT 'ok: an active second super admin is cover, so the guard would allow the change';

-- ------------------------------------------------------------------ 4. an ordinary admin is not cover
/* Editing somebody who does not hold the role cannot trip the guard, and holding a different role
   is not cover for the one being removed. Both halves of that are the same query asked twice. */
SELECT @others = COUNT_BIG(*)
FROM dbo.admin_user_roles aur
JOIN dbo.roles r ON r.id = aur.role_id
JOIN dbo.admin_users au ON au.id = aur.admin_user_id
WHERE r.slug = 'super_admin'
  AND au.status = 'active'
  AND au.id <> @ordinary
  AND au.email LIKE 'smoke-lock-%';

IF @others <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: editing an ordinary admin miscounted the super admins (' + CAST(@others AS varchar(20)) + ', expected 2)';
END
ELSE PRINT 'ok: editing an account without the role leaves the count of others unchanged';

-- ------------------------------------------------------------------ 5. sessions are revoked on disable
/* `status = 'active'` in AdminAccess.LoadSql already makes a disabled account unloadable, so its
   access token stops being worth anything on the next request. This revocation is the other half:
   it stops the *refresh* token minting a new one, which would otherwise keep working until the
   session expired on its own. */
INSERT INTO dbo.admin_sessions (admin_user_id, refresh_token_hash, expires_at)
VALUES (@soleSuper,   CAST(NEWID() AS varbinary(64)), DATEADD(day, 30, SYSDATETIMEOFFSET())),
       (@soleSuper,   CAST(NEWID() AS varbinary(64)), DATEADD(day, 30, SYSDATETIMEOFFSET())),
       (@ordinary,    CAST(NEWID() AS varbinary(64)), DATEADD(day, 30, SYSDATETIMEOFFSET()));

-- One session of the target is already revoked, so the UPDATE must leave it alone rather than
-- re-stamping it with a later time and losing when it actually ended.
UPDATE dbo.admin_sessions
SET revoked_at = DATEADD(day, -1, SYSDATETIMEOFFSET())
WHERE id = (SELECT MIN(id) FROM dbo.admin_sessions WHERE admin_user_id = @soleSuper);

UPDATE dbo.admin_sessions
SET revoked_at = SYSDATETIMEOFFSET()
WHERE admin_user_id = @soleSuper AND revoked_at IS NULL;

SET @n = (SELECT COUNT(*) FROM dbo.admin_sessions WHERE admin_user_id = @soleSuper AND revoked_at IS NULL);
IF @n <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: ' + CAST(@n AS varchar(10)) + ' session(s) of the disabled account are still live';
END
ELSE PRINT 'ok: every live session of the disabled account is revoked';

-- And nobody else's.
SET @n = (SELECT COUNT(*) FROM dbo.admin_sessions WHERE admin_user_id = @ordinary AND revoked_at IS NULL);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: revoking one account''s sessions touched another account''s (' + CAST(@n AS varchar(10)) + ' left live, expected 1)';
END
ELSE PRINT 'ok: another account''s sessions are untouched';

-- ------------------------------------------------------------------ 6. the status words the schema allows
/* SetStatus accepts only 'active' and 'disabled', because those are the words
   admin_users_status_check allows -- inventing a synonym would mean a status the database refuses.
   'invited' is the third, and is what a row defaults to before a password is ever set. */
BEGIN TRY
    UPDATE dbo.admin_users SET status = 'suspended' WHERE id = @ordinary;
    SET @failed = @failed + 1;
    PRINT 'FAIL: a status outside the allowed set was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a status the schema does not allow is refused';
END CATCH

-- ------------------------------------------------------------------ summary
IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'the last-super-admin guard counts only active holders, and disabling an account ends its sessions';
GO

ROLLBACK TRANSACTION;
GO
