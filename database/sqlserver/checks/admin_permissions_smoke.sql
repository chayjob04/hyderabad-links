-- Manual smoke test for how an admin's permissions are resolved (S0003, R003, S0028).
--
-- This is the database half of authorization. Nothing about permissions travels in a token: every
-- request re-reads them with the query in `AdminAccess.LoadSql`, so what that query returns *is*
-- what an admin may do. The C# gates are covered by AdminPermissionSurfaceTests and
-- AdminPermissionBindingTests, which need no database; what they cannot check is whether the
-- resolution query itself still answers correctly against the real schema and the real grants.
-- That is what this asserts.
--
-- The queries below are deliberately copies of the ones the application runs -- `LoadSql` and
-- `AdminAccess.HoldsSuperAdmin` -- rather than simplified versions of them. A simplification would
-- pass while the real one failed, which is the opposite of useful.
--
-- It creates its own admin accounts, asserts, then rolls back, so it leaves no data and is safe to
-- re-run. Every email is prefixed `smoke-adm-` so it cannot collide with a real account or with a
-- leftover row. **No existing account is read, changed or relied upon**, so this says nothing about
-- and does nothing to the real super admin.
--
-- Run:
--   npm run db:check -- admin_permissions

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @adminRole int, @superRole int;
DECLARE @withAdmin bigint, @withSuper bigint, @disabled bigint, @noRoles bigint;
DECLARE @roles nvarchar(max), @perms nvarchar(max);
DECLARE @n int, @mustChange bit;

-- ------------------------------------------------------------------ 0. prerequisites
/* The two system roles and their grants come from R003 and from S0014/S0021/S0023/S0025. If they
   are missing, every assertion below would fail for the wrong reason, so it is said plainly here. */
SELECT @adminRole = id FROM dbo.roles WHERE slug = 'admin';
SELECT @superRole = id FROM dbo.roles WHERE slug = 'super_admin';

IF @adminRole IS NULL OR @superRole IS NULL
BEGIN
    PRINT 'FAIL: the admin and/or super_admin role is missing. Run the reference seeds: npm run db:migrate';
    SET @failed = @failed + 1;
END
ELSE PRINT 'ok: both system roles exist';

-- ------------------------------------------------------------------ 1. fixtures
INSERT INTO dbo.admin_users (email, display_name, password_hash, status)
VALUES ('smoke-adm-admin@example.com', 'Smoke Adm Admin', 'not-a-real-hash', 'active');
SET @withAdmin = SCOPE_IDENTITY();

INSERT INTO dbo.admin_users (email, display_name, password_hash, status)
VALUES ('smoke-adm-super@example.com', 'Smoke Adm Super', 'not-a-real-hash', 'active');
SET @withSuper = SCOPE_IDENTITY();

-- Same role as the first, but disabled: the resolution query must refuse to load it at all.
INSERT INTO dbo.admin_users (email, display_name, password_hash, status)
VALUES ('smoke-adm-disabled@example.com', 'Smoke Adm Disabled', 'not-a-real-hash', 'disabled');
SET @disabled = SCOPE_IDENTITY();

-- A signed-in admin holding no role is a real state, not an error.
INSERT INTO dbo.admin_users (email, display_name, password_hash, status)
VALUES ('smoke-adm-noroles@example.com', 'Smoke Adm No Roles', 'not-a-real-hash', 'active');
SET @noRoles = SCOPE_IDENTITY();

INSERT INTO dbo.admin_user_roles (admin_user_id, role_id)
VALUES (@withAdmin, @adminRole), (@withSuper, @superRole), (@disabled, @adminRole);

-- ------------------------------------------------------------------ 2. must_change_password default
/* S0028 added the column with DEFAULT 0, and the CLI bootstrap does not set it. If the default were
   ever changed to 1, a newly created admin would be able to do nothing but change its password --
   both gates refuse everything while it is true -- which is a silent lockout of every new account. */
SELECT @mustChange = must_change_password FROM dbo.admin_users WHERE id = @withAdmin;
IF @mustChange <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: must_change_password defaulted to 1; every newly created admin would be locked to the password screen';
END
ELSE PRINT 'ok: a new admin account is not forced to change its password';

-- ------------------------------------------------------------------ 3. the resolution query itself
/* AdminAccess.LoadSql, verbatim in shape: two correlated STRING_AGG subqueries over DISTINCT, and
   `status = 'active'` in the WHERE. SQL Server has no array type, which is why the roles and
   permissions come back as comma-separated strings for Load() to split. */
SELECT @roles = (SELECT STRING_AGG(x.slug, ',')
                 FROM (SELECT DISTINCT r.slug
                       FROM dbo.admin_user_roles aur
                       JOIN dbo.roles r ON r.id = aur.role_id
                       WHERE aur.admin_user_id = au.id) x),
       @perms = (SELECT STRING_AGG(x.code, ',')
                 FROM (SELECT DISTINCT p.code
                       FROM dbo.admin_user_roles aur
                       JOIN dbo.role_permissions rp ON rp.role_id = aur.role_id
                       JOIN dbo.permissions p ON p.id = rp.permission_id
                       WHERE aur.admin_user_id = au.id) x)
FROM dbo.admin_users au
WHERE au.id = @withAdmin AND au.status = 'active';

IF @roles IS NULL OR CHARINDEX('admin', @roles) = 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: an account with the admin role resolved roles: ' + ISNULL(@roles, 'NULL');
END
ELSE PRINT 'ok: the admin role resolves through the live query';

-- Core admin work must be present. Checked as rows rather than by string search, so a code that is
-- a substring of another cannot produce a false pass.
SELECT @n = COUNT(*)
FROM STRING_SPLIT(ISNULL(@perms, ''), ',') s
WHERE s.value IN ('listings.review', 'taxonomy.manage', 'reports.handle');

IF @n <> 3
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the admin role resolved ' + CAST(@n AS varchar(10)) + ' of the 3 core admin permissions';
END
ELSE PRINT 'ok: the admin role carries the core moderation permissions';

/* And the super-admin gate is not among them. If `admins.manage` ever reached the admin role, that
   account would be issued a super-admin token at sign-in, because HoldsSuperAdmin is what decides
   whether one is minted. That is the privilege boundary, stated as an assertion. */
IF EXISTS (SELECT 1 FROM STRING_SPLIT(ISNULL(@perms, ''), ',') s WHERE s.value = 'admins.manage')
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the admin role holds admins.manage, so an ordinary admin would be given a super-admin token';
END
ELSE PRINT 'ok: the admin role does not hold admins.manage';

-- ------------------------------------------------------------------ 4. the super-admin role
SELECT @perms = (SELECT STRING_AGG(x.code, ',')
                 FROM (SELECT DISTINCT p.code
                       FROM dbo.admin_user_roles aur
                       JOIN dbo.role_permissions rp ON rp.role_id = aur.role_id
                       JOIN dbo.permissions p ON p.id = rp.permission_id
                       WHERE aur.admin_user_id = au.id) x)
FROM dbo.admin_users au
WHERE au.id = @withSuper AND au.status = 'active';

SELECT @n = COUNT(*)
FROM STRING_SPLIT(ISNULL(@perms, ''), ',') s
WHERE s.value IN ('admins.manage', 'audit.view', 'listings.create', 'listings.feature');

IF @n <> 4
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the super_admin role resolved ' + CAST(@n AS varchar(10)) + ' of the 4 platform permissions';
END
ELSE PRINT 'ok: the super_admin role carries the platform permissions';

-- ------------------------------------------------------------------ 5. a disabled account
/* `status = 'active'` in LoadSql is the whole of how disabling takes effect: a token already issued
   keeps validating, and this query is what stops it being worth anything. Suspension is immediate
   because of this line, not because sessions are revoked -- that happens too, but it is the belt. */
SET @n = (SELECT COUNT(*) FROM dbo.admin_users au WHERE au.id = @disabled AND au.status = 'active');
IF @n <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a disabled account still satisfied the active filter in the resolution query';
END
ELSE PRINT 'ok: a disabled account cannot be loaded, so its existing tokens resolve to nothing';

-- ------------------------------------------------------------------ 6. an account with no roles
SELECT @roles = (SELECT STRING_AGG(x.slug, ',')
                 FROM (SELECT DISTINCT r.slug
                       FROM dbo.admin_user_roles aur
                       JOIN dbo.roles r ON r.id = aur.role_id
                       WHERE aur.admin_user_id = au.id) x)
FROM dbo.admin_users au
WHERE au.id = @noRoles AND au.status = 'active';

/* NULL, which Load() reads as an empty list rather than a missing one. The account still loads --
   it is a real signed-in admin who may do nothing -- so the row must come back even though the
   aggregate is NULL. */
IF @roles IS NOT NULL
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: an account with no roles resolved roles: ' + @roles;
END
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.admin_users WHERE id = @noRoles AND status = 'active')
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: an account with no roles did not load at all';
END
ELSE PRINT 'ok: an account with no roles loads, holding nothing';

-- ------------------------------------------------------------------ 7. HoldsSuperAdmin
/* What decides whether a super-admin token is minted at sign-in. Read from the database inside the
   session transaction, like every other permission, rather than from anything the caller sent. */
IF NOT EXISTS (
    SELECT TOP (1) 1
    FROM dbo.admin_user_roles aur
    JOIN dbo.role_permissions rp ON rp.role_id = aur.role_id
    JOIN dbo.permissions p ON p.id = rp.permission_id
    WHERE aur.admin_user_id = @withSuper AND p.code = 'admins.manage')
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: HoldsSuperAdmin said no for an account with the super_admin role';
END
ELSE PRINT 'ok: a super_admin account is recognised as holding admins.manage';

IF EXISTS (
    SELECT TOP (1) 1
    FROM dbo.admin_user_roles aur
    JOIN dbo.role_permissions rp ON rp.role_id = aur.role_id
    JOIN dbo.permissions p ON p.id = rp.permission_id
    WHERE aur.admin_user_id = @withAdmin AND p.code = 'admins.manage')
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: HoldsSuperAdmin said yes for an ordinary admin account';
END
ELSE PRINT 'ok: an ordinary admin is not given a super-admin token';

-- ------------------------------------------------------------------ 8. the audit row shape
/* AuditLog.WriteAsync writes this, in the caller's own transaction, so a change cannot commit
   without its record. The CHECK constraints are the part worth asserting: an actor_type outside the
   three allowed words, or details that are not JSON, would make every audited action fail at the
   last step -- after the change itself had already been made in the same transaction. */
INSERT INTO dbo.audit_logs (actor_type, actor_id, action, entity_type, entity_id, details, ip)
VALUES ('admin', @withSuper, 'smoke.admin_permissions_check', 'admin_user',
        CAST(@withAdmin AS nvarchar(100)), '{"roles":["admin"]}', '203.0.113.9');

IF NOT EXISTS (
    SELECT 1 FROM dbo.audit_logs
    WHERE action = 'smoke.admin_permissions_check' AND actor_type = 'admin' AND ISJSON(details) = 1)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the audit row was not written in the shape AuditLog.WriteAsync writes';
END
ELSE PRINT 'ok: an audit row records an admin action with JSON details';

-- ------------------------------------------------------------------ summary
IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'permissions resolve from roles, disabled accounts resolve to nothing, and the privilege boundary holds';
GO

ROLLBACK TRANSACTION;
GO
