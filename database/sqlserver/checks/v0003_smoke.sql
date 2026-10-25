-- Manual smoke test for S0003: the authentication, administrator and audit tables.
-- It inserts, asserts, and rolls back, so it leaves no data and is safe to re-run.
--
-- The PostgreSQL original is database/checks/v0003_smoke.sql, kept as history. What changed:
-- bytea literals became varbinary (CONVERT with style 2 reads the hex), now() became
-- SYSDATETIMEOFFSET(), jsonb became nvarchar(max) guarded by ISJSON, and the append-only audit log
-- is now INSTEAD OF triggers that accept the statement and change nothing, rather than a rule.
--
-- Run:
--   npm run db:check -- v0003_smoke

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @user bigint, @admin bigint, @audit bigint, @rows int;

-- ----------------------------------------------------------------- owner authentication
INSERT INTO users (phone_e164, phone_verified_at) VALUES ('+919999900011', SYSDATETIMEOFFSET());
SET @user = SCOPE_IDENTITY();

INSERT INTO otp_challenges (phone_e164, code_hash, expires_at, requester_ip)
VALUES ('+919999900011', CONVERT(varbinary(64), 'deadbeef', 2),
        DATEADD(minute, 5, SYSDATETIMEOFFSET()), '203.0.113.7');

INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at)
VALUES (@user, CONVERT(varbinary(64), '0102030405', 2), DATEADD(day, 30, SYSDATETIMEOFFSET()));

-- 1. A refresh token hash is unique, so a stolen token cannot be re-registered against the account.
BEGIN TRY
    INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at)
    VALUES (@user, CONVERT(varbinary(64), '0102030405', 2), DATEADD(day, 1, SYSDATETIMEOFFSET()));
    SET @failed = @failed + 1; PRINT 'FAIL: a duplicate refresh token was accepted';
END TRY BEGIN CATCH PRINT 'ok: duplicate refresh token rejected'; END CATCH;

-- ----------------------------------------------------------------- administrators
INSERT INTO admin_users (email, display_name, status)
VALUES ('smoke.admin@example.com', 'Smoke Admin', 'active');
SET @admin = SCOPE_IDENTITY();

INSERT INTO admin_user_roles (admin_user_id, role_id)
SELECT @admin, id FROM roles WHERE slug = 'admin';

-- 2. An admin email is stored lower case, so a sign-in cannot be split across two spellings.
BEGIN TRY
    INSERT INTO admin_users (email, display_name) VALUES ('Mixed.Case@Example.com', 'X');
    SET @failed = @failed + 1; PRINT 'FAIL: a mixed-case admin email was accepted';
END TRY BEGIN CATCH PRINT 'ok: mixed-case admin email rejected'; END CATCH;

-- 3. A new account starts 'invited', never active: the bootstrap and the sign-in path both rely on
--    an account only becoming usable once a password has been set.
INSERT INTO admin_users (email, display_name) VALUES ('smoke.invited@example.com', 'Smoke Invited');
IF (SELECT status FROM admin_users WHERE email = 'smoke.invited@example.com') <> 'invited'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a new admin account did not default to invited';
END
ELSE PRINT 'ok: a new admin account defaults to invited';

-- 4. Only the three states the API handles are storable.
BEGIN TRY
    INSERT INTO admin_users (email, display_name, status)
    VALUES ('smoke.bad@example.com', 'Smoke Bad', 'suspended');
    SET @failed = @failed + 1; PRINT 'FAIL: an unknown admin status was accepted';
END TRY BEGIN CATCH PRINT 'ok: unknown admin status rejected'; END CATCH;

-- ----------------------------------------------------------------- the audit log
DECLARE @auditRows TABLE (id bigint);
INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, details)
OUTPUT inserted.id INTO @auditRows
VALUES ('admin', @admin, 'listing.approve', 'listing', '42', '{"reason":"smoke"}');
SET @audit = (SELECT TOP (1) id FROM @auditRows);

-- 5. details is JSON, enforced by ISJSON rather than by a jsonb column type.
BEGIN TRY
    INSERT INTO audit_logs (actor_type, action, details) VALUES ('admin', 'x.y', 'not json at all');
    SET @failed = @failed + 1; PRINT 'FAIL: a non-JSON details value was accepted';
END TRY BEGIN CATCH PRINT 'ok: non-JSON details rejected'; END CATCH;

-- 6. Append-only. The INSTEAD OF triggers swallow the statement, so an UPDATE reports rows affected
--    while changing nothing: the assertion has to read the row back, not trust @@ROWCOUNT.
UPDATE audit_logs SET action = 'tampered' WHERE id = @audit;
IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE id = @audit AND action = 'listing.approve')
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: an audit row was modified';
END
ELSE PRINT 'ok: updating an audit row changed nothing';

DELETE FROM audit_logs WHERE id = @audit;
IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE id = @audit)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: an audit row was deleted';
END
ELSE PRINT 'ok: deleting an audit row changed nothing';

-- ----------------------------------------------------------------- roles and permissions
-- 7. The reference seed's grants, which is what every authorisation decision reads.
DECLARE @super int = (SELECT COUNT(*) FROM roles r
                      JOIN role_permissions rp ON rp.role_id = r.id
                      WHERE r.slug = 'super_admin');
DECLARE @ordinary int = (SELECT COUNT(*) FROM roles r
                         JOIN role_permissions rp ON rp.role_id = r.id
                         WHERE r.slug = 'admin');
DECLARE @total int = (SELECT COUNT(*) FROM permissions);

IF @total <> 12
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: expected 12 permissions, found ' + CAST(@total AS varchar(10));
END
ELSE PRINT 'ok: 12 permissions exist';

IF @super <> 12
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: super_admin holds ' + CAST(@super AS varchar(10)) + ' permissions, expected 12';
END
ELSE PRINT 'ok: super_admin holds every permission';

IF @ordinary <> 7
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: admin holds ' + CAST(@ordinary AS varchar(10)) + ' permissions, expected 7';
END
ELSE PRINT 'ok: admin holds the seven day-to-day permissions';

-- 8. The five super-admin-only permissions are not reachable through the ordinary admin role.
DECLARE @leaked int = (
    SELECT COUNT(*) FROM roles r
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE r.slug = 'admin'
      AND p.code IN ('admins.manage', 'plans.manage', 'audit.view', 'analytics.view', 'data.export'));
IF @leaked <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the admin role holds ' + CAST(@leaked AS varchar(10)) + ' super-admin permission(s)';
END
ELSE PRINT 'ok: super-admin permissions stay out of the admin role';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'S0003 auth, admin and audit rules behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
