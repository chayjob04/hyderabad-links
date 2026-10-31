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
DECLARE @total int = (SELECT COUNT(*) FROM permissions);

/* The catalogue, asserted by *name* rather than by count.
   A count has to be edited every time a permission is added, which makes a passing check a
   statement about arithmetic rather than about the product: it fails for the one harmless reason
   (something was added on purpose) and passes if a code is renamed or swapped for another. Listing
   them means this fails only when the set is genuinely not what the seed defines. */
DECLARE @expectedPermissions TABLE (code varchar(50) PRIMARY KEY);
INSERT INTO @expectedPermissions (code)
VALUES ('listings.view'), ('listings.create'), ('listings.edit'), ('listings.delete'),
       ('listings.review'), ('listings.verify'), ('listings.alert'), ('listings.feature'),
       ('reports.handle'), ('users.view'), ('taxonomy.manage'),
       ('analytics.view'), ('data.export'), ('plans.manage'), ('admins.manage'), ('audit.view'),
       -- S0021 and S0023.
       ('seo.manage'), ('blog.manage');

DECLARE @missingPermissions int =
    (SELECT COUNT(*) FROM (SELECT code FROM @expectedPermissions EXCEPT SELECT code FROM permissions) AS m);
DECLARE @unexpectedPermissions int =
    (SELECT COUNT(*) FROM (SELECT code FROM permissions EXCEPT SELECT code FROM @expectedPermissions) AS u);

IF @missingPermissions <> 0 OR @unexpectedPermissions <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the permission catalogue is wrong: '
          + CAST(@missingPermissions AS varchar(10)) + ' missing, '
          + CAST(@unexpectedPermissions AS varchar(10)) + ' unexpected';
END
ELSE PRINT 'ok: the catalogue is exactly the ' + CAST(@total AS varchar(10)) + ' codes the seed defines';

/* Against @total rather than a number of its own: "super_admin holds everything there is" is the
   actual rule (R003 grants it by CROSS JOIN), and writing it this way means adding a permission
   cannot make this assertion stale -- only forgetting to grant it can make it fail. */
IF @super <> @total
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: super_admin holds ' + CAST(@super AS varchar(10)) + ' of ' + CAST(@total AS varchar(10)) + ' permissions';
END
ELSE PRINT 'ok: super_admin holds every permission';

/* The admin role, by name, with the two kinds of difference counted separately.
   A count alone passes when one grant is swapped for another, and the swap that matters is exactly
   the one S0014 made: an admin must not hold listings.create, edit or delete, whatever the total
   happens to be. S0017 adds listings.alert and withholds listings.feature on the same principle.

   Written as two counts rather than one EXCEPT ... UNION ALL ... EXCEPT chain. SQL Server evaluates
   those left to right, so the chain reduced to "which expected grants are missing" and would not
   have noticed an *extra* one -- which is the half this check exists for. */
DECLARE @expectedAdmin TABLE (code varchar(50) PRIMARY KEY);
INSERT INTO @expectedAdmin (code)
VALUES ('listings.view'), ('listings.review'), ('listings.verify'), ('listings.alert'),
       ('reports.handle'), ('users.view'), ('taxonomy.manage'),
       -- S0021 and S0023: writing the site's own words and its page titles is admin work.
       ('seo.manage'), ('blog.manage');

DECLARE @adminGrants TABLE (code varchar(50) PRIMARY KEY);
INSERT INTO @adminGrants (code)
SELECT p.code
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.slug = 'admin';

DECLARE @adminMissing int =
    (SELECT COUNT(*) FROM (SELECT code FROM @expectedAdmin EXCEPT SELECT code FROM @adminGrants) AS m);
DECLARE @adminExtra int =
    (SELECT COUNT(*) FROM (SELECT code FROM @adminGrants EXCEPT SELECT code FROM @expectedAdmin) AS e);

IF @adminMissing <> 0 OR @adminExtra <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the admin role grants differ from the expected set: '
          + CAST(@adminMissing AS varchar(10)) + ' missing, '
          + CAST(@adminExtra AS varchar(10))
          + ' extra; writing, deleting or featuring a listing must not be among them';
END
ELSE PRINT 'ok: admin holds the seven day-to-day permissions, and neither writes nor features a listing';

-- 8. The super-admin-only permissions are not reachable through the ordinary admin role. Named
-- here as well as being absent from the set above, so the one hole that matters is stated twice.
DECLARE @leaked int = (
    SELECT COUNT(*) FROM roles r
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE r.slug = 'admin'
      AND p.code IN ('admins.manage', 'plans.manage', 'audit.view', 'analytics.view', 'data.export',
                     'listings.create', 'listings.edit', 'listings.delete', 'listings.feature'));
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
