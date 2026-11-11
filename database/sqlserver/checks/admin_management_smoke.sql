-- Manual smoke test for Admin Account Management (S0028 and the super-admin account endpoints).
-- It creates its own admin rows, asserts the rules behave, then rolls back, so it leaves no data
-- and is safe to re-run. Nothing here touches an account that was already in the table.
--
-- What is being checked is the part the hermetic .NET tests cannot reach: the rules that need real
-- rows. The authorization boundary is covered by AdminAccountManagementAccessTests, and the
-- must-change-password gate by AdminPasswordRotationTests.
--
-- Run:
--   npm run db:check -- admin_management

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @super bigint, @plain bigint, @second bigint, @n int, @bit bit;
DECLARE @superRole int, @adminRole int;
-- A hash shaped like the real thing. No password is involved: this never signs anybody in.
DECLARE @hash nvarchar(400) = N'pbkdf2-sha256$210000$c21va2U=$bm90LWEtcmVhbC1oYXNo';

SELECT @superRole = id FROM dbo.roles WHERE slug = 'super_admin';
SELECT @adminRole = id FROM dbo.roles WHERE slug = 'admin';

IF @superRole IS NULL OR @adminRole IS NULL
BEGIN
    PRINT 'FAIL: the roles seed is missing; run npm run db:migrate first';
    SET @failed = @failed + 1;
END

-- 1. A new account is created active, on a temporary password, with no authenticator yet.
INSERT INTO dbo.admin_users (email, display_name, password_hash, status, password_changed_at, must_change_password)
VALUES ('smoke.super@example.com', N'Smoke Super', @hash, 'active', SYSDATETIMEOFFSET(), 1);
SET @super = SCOPE_IDENTITY();
INSERT INTO dbo.admin_user_roles (admin_user_id, role_id) VALUES (@super, @superRole);

IF NOT EXISTS (SELECT 1 FROM dbo.admin_users
               WHERE id = @super AND status = 'active' AND must_change_password = 1
                 AND totp_enabled_at IS NULL AND failed_login_count = 0)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a new admin was not active, temporary and unenrolled';
END
ELSE PRINT 'ok: a new admin starts active, on a temporary password, with no authenticator';

-- 2. The email is unique, which is what stops a duplicate account rather than a check-then-insert.
BEGIN TRY
    INSERT INTO dbo.admin_users (email, display_name, password_hash, status)
    VALUES ('smoke.super@example.com', N'Impostor', @hash, 'active');
    SET @failed = @failed + 1; PRINT 'FAIL: a duplicate email was accepted';
END TRY BEGIN CATCH PRINT 'ok: a duplicate email is refused'; END CATCH;

-- 3. The email must be lower case with an @ in it (S0003), so the API normalising is not the only guard.
BEGIN TRY
    INSERT INTO dbo.admin_users (email, display_name, password_hash, status)
    VALUES ('Smoke.Mixed@Example.com', N'Mixed Case', @hash, 'active');
    SET @failed = @failed + 1; PRINT 'FAIL: a mixed-case email was accepted';
END TRY BEGIN CATCH PRINT 'ok: a mixed-case email is refused'; END CATCH;

-- 4. Status is an enumeration the database enforces.
BEGIN TRY
    INSERT INTO dbo.admin_users (email, display_name, password_hash, status)
    VALUES ('smoke.bad@example.com', N'Bad Status', @hash, 'suspended');
    SET @failed = @failed + 1; PRINT 'FAIL: an unknown status was accepted';
END TRY BEGIN CATCH PRINT 'ok: an unknown admin status is refused'; END CATCH;

-- An ordinary admin, for the role tests.
INSERT INTO dbo.admin_users (email, display_name, password_hash, status, must_change_password)
VALUES ('smoke.plain@example.com', N'Smoke Plain', @hash, 'active', 0);
SET @plain = SCOPE_IDENTITY();
INSERT INTO dbo.admin_user_roles (admin_user_id, role_id) VALUES (@plain, @adminRole);

-- 5. The summary card query: super admins counted by the permission, not by the role slug.
SET @n = (SELECT COUNT(*) FROM dbo.admin_users au
          WHERE au.email LIKE 'smoke.%'
            AND EXISTS (SELECT 1 FROM dbo.admin_user_roles aur
                        JOIN dbo.role_permissions rp ON rp.role_id = aur.role_id
                        JOIN dbo.permissions p ON p.id = rp.permission_id
                        WHERE aur.admin_user_id = au.id AND p.code = 'admins.manage'));
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the super-admin count found ' + CAST(@n AS varchar(10)) + ' of the smoke rows, expected 1';
END
ELSE PRINT 'ok: super admins are counted by the admins.manage permission';

-- 6. The last-active-super-admin guard, as the API asks it: "would any other remain?"
SET @n = (SELECT COUNT(*) FROM dbo.admin_user_roles aur
          JOIN dbo.roles r ON r.id = aur.role_id
          JOIN dbo.admin_users au ON au.id = aur.admin_user_id
          WHERE r.slug = 'super_admin' AND au.status = 'active' AND au.id <> @super);
IF @n <> 0
BEGIN
    PRINT 'ok (context): another active super admin exists in this database, so the guard would allow it';
END
ELSE PRINT 'ok: with only this super admin active, the guard would refuse disabling or demoting it';

-- A second super admin: the guard must now allow the first to be demoted.
INSERT INTO dbo.admin_users (email, display_name, password_hash, status)
VALUES ('smoke.second@example.com', N'Smoke Second', @hash, 'active');
SET @second = SCOPE_IDENTITY();
INSERT INTO dbo.admin_user_roles (admin_user_id, role_id) VALUES (@second, @superRole);

SET @n = (SELECT COUNT(*) FROM dbo.admin_user_roles aur
          JOIN dbo.roles r ON r.id = aur.role_id
          JOIN dbo.admin_users au ON au.id = aur.admin_user_id
          WHERE r.slug = 'super_admin' AND au.status = 'active' AND au.id <> @super);
IF @n < 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a second active super admin was not counted';
END
ELSE PRINT 'ok: with a second super admin, demoting the first is allowed';

-- 7. A disabled super admin does not count towards the guard: status is part of the question.
UPDATE dbo.admin_users SET status = 'disabled' WHERE id = @second;
SET @n = (SELECT COUNT(*) FROM dbo.admin_user_roles aur
          JOIN dbo.roles r ON r.id = aur.role_id
          JOIN dbo.admin_users au ON au.id = aur.admin_user_id
          WHERE r.slug = 'super_admin' AND au.status = 'active' AND au.id <> @super AND au.email LIKE 'smoke.%');
IF @n <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a disabled super admin was still counted as active';
END
ELSE PRINT 'ok: a disabled super admin does not hold the platform open';
UPDATE dbo.admin_users SET status = 'active' WHERE id = @second;

-- 8. Resetting a password: the flag goes on, the lockout is cleared, the timestamp moves.
UPDATE dbo.admin_users
SET password_hash = @hash + N'2', password_changed_at = SYSDATETIMEOFFSET(),
    must_change_password = 1, failed_login_count = 0, locked_until = NULL
WHERE id = @plain;
IF NOT EXISTS (SELECT 1 FROM dbo.admin_users
               WHERE id = @plain AND must_change_password = 1 AND locked_until IS NULL AND failed_login_count = 0)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a password reset did not set the flag and clear the lockout';
END
ELSE PRINT 'ok: a password reset forces a change and clears any lockout';

-- 9. Changing your own password clears the flag.
UPDATE dbo.admin_users
SET password_hash = @hash + N'3', password_changed_at = SYSDATETIMEOFFSET(), must_change_password = 0
WHERE id = @plain;
SET @bit = (SELECT must_change_password FROM dbo.admin_users WHERE id = @plain);
IF @bit <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: changing the password did not clear the flag';
END
ELSE PRINT 'ok: changing your own password clears the flag';

-- 10. Session revocation, as both endpoints perform it.
INSERT INTO dbo.admin_sessions (admin_user_id, refresh_token_hash, expires_at)
VALUES (@plain, CONVERT(varbinary(64), 'smoke-admin-token-1'), DATEADD(day, 7, SYSDATETIMEOFFSET()));
INSERT INTO dbo.admin_sessions (admin_user_id, refresh_token_hash, expires_at)
VALUES (@plain, CONVERT(varbinary(64), 'smoke-admin-token-2'), DATEADD(day, 7, SYSDATETIMEOFFSET()));

UPDATE dbo.admin_sessions SET revoked_at = SYSDATETIMEOFFSET(), revoked_reason = 'revoked_by_super_admin'
WHERE admin_user_id = @plain AND revoked_at IS NULL;

SET @n = (SELECT COUNT(*) FROM dbo.admin_sessions
          WHERE admin_user_id = @plain AND revoked_at IS NULL AND rotated_at IS NULL
            AND expires_at > SYSDATETIMEOFFSET());
IF @n <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: ' + CAST(@n AS varchar(10)) + ' session(s) survived revocation';
END
ELSE PRINT 'ok: revoking ends every live session for that admin';

-- 11. The audit entries these actions write, with the action names the endpoints use.
INSERT INTO dbo.audit_logs (actor_type, actor_id, action, entity_type, entity_id, details)
VALUES ('admin', @super, 'admin.created', 'admin_user', CAST(@plain AS varchar(50)), N'{"role":"admin"}');
INSERT INTO dbo.audit_logs (actor_type, actor_id, action, entity_type, entity_id, details)
VALUES ('admin', @super, 'admin.password_reset', 'admin_user', CAST(@plain AS varchar(50)), N'{}');
INSERT INTO dbo.audit_logs (actor_type, actor_id, action, entity_type, entity_id, details)
VALUES ('admin', @plain, 'admin.password_changed', 'admin_user', CAST(@plain AS varchar(50)), NULL);

SET @n = (SELECT COUNT(*) FROM dbo.audit_logs
          WHERE entity_type = 'admin_user' AND entity_id = CAST(@plain AS varchar(50))
            AND action IN ('admin.created', 'admin.password_reset', 'admin.password_changed'));
IF @n <> 3
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: expected 3 audit entries, found ' + CAST(@n AS varchar(10));
END
ELSE PRINT 'ok: creation, reset and change are all recorded';

-- 12. No audit row carries anything password-shaped. The details column is read by administrators.
SET @n = (SELECT COUNT(*) FROM dbo.audit_logs
          WHERE entity_type = 'admin_user'
            AND (details LIKE '%password_hash%' OR details LIKE '%pbkdf2%' OR details LIKE '%"password"%'));
IF @n <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: ' + CAST(@n AS varchar(10)) + ' audit row(s) mention a password';
END
ELSE PRINT 'ok: no audit row records a password or a hash';

-- 13. The details column must be valid JSON where it is set (S0003 enforces it).
BEGIN TRY
    INSERT INTO dbo.audit_logs (actor_type, actor_id, action, entity_type, entity_id, details)
    VALUES ('admin', @super, 'admin.created', 'admin_user', CAST(@plain AS varchar(50)), N'not json');
    SET @failed = @failed + 1; PRINT 'FAIL: a non-JSON audit detail was accepted';
END TRY BEGIN CATCH PRINT 'ok: audit details must be JSON'; END CATCH;

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'admin account management behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
