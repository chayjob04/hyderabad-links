-- S0014: two new permissions, and the move of listing *writing* off the admin role.
--
-- The brief that drove this: an admin may review, approve or reject what owners submit, and may
-- keep the categories, subcategories and localities tidy. An admin may no longer add, edit or
-- delete a business by hand -- that is now super-admin work, on /api/v1/super-admin.
--
-- Three parts, all operating on permission *grants*, never on business data:
--   1. add taxonomy.manage and listings.delete to dbo.permissions
--   2. grant every permission to super_admin (the same CROSS JOIN R003 uses, so a permission added
--      later still reaches them), and taxonomy.manage to admin
--   3. revoke listings.create and listings.edit from the admin role
--
-- Part 3 deletes rows, so it is called out: they are role_permissions rows, which are
-- configuration, not history. No listing, subscription, payment, user or audit row is touched, and
-- nothing cascades from role_permissions. It is reversible by re-granting. Without it the database
-- would still say an admin may edit listings while the API refuses -- and the database is what the
-- admin UI reads to decide which navigation to show.
--
-- Idempotent, like R003: safe to run on a database where some of this is already true.
--
-- approved-destructive: revokes two permission grants from the 'admin' role, by the owner's
-- instruction of 2026-10-26. Configuration rows only; no business data is deleted.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 1. The new permission codes. Note the format rule on this column (see S0010): lower-case letters,
-- underscores and dots only, and at least one dot.
INSERT INTO dbo.permissions (code, description)
SELECT v.code, v.description
FROM (VALUES
    ('taxonomy.manage',  'Manage categories, subcategories and localities'),
    ('listings.delete',  'Delete a listing outright')
) AS v(code, description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.permissions p WHERE p.code = v.code);
GO

-- 2a. The super admin holds everything there is, including anything added above.
INSERT INTO dbo.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM dbo.roles r
CROSS JOIN dbo.permissions p
WHERE r.slug = 'super_admin'
  AND NOT EXISTS (
      SELECT 1 FROM dbo.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
GO

-- 2b. The ordinary admin gains taxonomy work and nothing else.
INSERT INTO dbo.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM dbo.roles r
JOIN dbo.permissions p ON p.code = 'taxonomy.manage'
WHERE r.slug = 'admin'
  AND NOT EXISTS (
      SELECT 1 FROM dbo.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
GO

-- 3. Revoke writing listings from the admin role. Scoped to that role by slug, so the super admin's
-- own grants (inserted above) are untouched.
DELETE rp
FROM dbo.role_permissions rp
JOIN dbo.roles r ON r.id = rp.role_id
JOIN dbo.permissions p ON p.id = rp.permission_id
WHERE r.slug = 'admin'
  AND p.code IN ('listings.create', 'listings.edit');
GO

-- Prove the end state rather than trusting the statements above: an admin must not hold either
-- write permission, and must hold taxonomy.manage.
IF EXISTS (
    SELECT 1
    FROM dbo.role_permissions rp
    JOIN dbo.roles r ON r.id = rp.role_id
    JOIN dbo.permissions p ON p.id = rp.permission_id
    WHERE r.slug = 'admin' AND p.code IN ('listings.create', 'listings.edit')
)
BEGIN
    THROW 51014, 'The admin role still holds listings.create or listings.edit after S0014.', 1;
END
GO

IF EXISTS (SELECT 1 FROM dbo.roles WHERE slug = 'admin')
   AND NOT EXISTS (
    SELECT 1
    FROM dbo.role_permissions rp
    JOIN dbo.roles r ON r.id = rp.role_id
    JOIN dbo.permissions p ON p.id = rp.permission_id
    WHERE r.slug = 'admin' AND p.code = 'taxonomy.manage'
)
BEGIN
    THROW 51015, 'The admin role did not gain taxonomy.manage in S0014.', 1;
END
GO
