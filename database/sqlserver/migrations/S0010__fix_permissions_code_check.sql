-- S0010: replace an unsatisfiable CHECK constraint on permissions.code.
--
-- The company database's schema was built outside these migrations, and its version of
-- permissions_code_format cannot be satisfied by any value at all:
--
--     ([code] COLLATE Latin1_General_100_BIN2 LIKE '[a-z]%.%'
--      AND NOT ([code]) COLLATE Latin1_General_100_BIN2 LIKE '%[^a-z_.]%'
--      AND NOT [code] LIKE '%.'
--      AND NOT [code] LIKE '%..%'
--      AND NOT [code] LIKE '%._%')          <-- this one
--
-- `_` is LIKE's single-character wildcard, not a literal underscore. That last clause therefore
-- reads "the code must not contain a dot followed by any character", while the first clause
-- requires a dot and the third forbids the code ending in one. Nothing can satisfy all three, so
-- the table could never accept a row:
--
--     The INSERT statement conflicted with the CHECK constraint "permissions_code_format".
--
-- That is why R003_roles_permissions.sql failed on this database, and it means the admin and
-- super-admin permission system could never have worked here: no permissions, so no roles with
-- permissions, so every admin request would be refused.
--
-- A literal underscore in a LIKE pattern has to be written [_] or escaped with ESCAPE. The correct
-- clause is already in S0003, which spells the character class as '%[^a-z_.]%' -- inside brackets an
-- underscore *is* literal, which is why that clause was right all along and only the extra one was
-- wrong. The definition installed below is S0003's, character for character, so a database built
-- from the migrations and this one end up with the same rule.
--
-- Dropping a constraint is destructive in form but not in effect here: permissions is empty, and
-- the constraint being replaced accepts nothing, so no existing row can fail the new one. The drop
-- is guarded by name so this is safe on a database that already has the correct version.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = 'permissions_code_format'
             AND parent_object_id = OBJECT_ID('dbo.permissions'))
BEGIN
    ALTER TABLE dbo.permissions DROP CONSTRAINT permissions_code_format;
END;
GO

ALTER TABLE dbo.permissions WITH CHECK ADD CONSTRAINT permissions_code_format CHECK (
    code COLLATE Latin1_General_BIN2 LIKE '[a-z]%'
    AND code COLLATE Latin1_General_BIN2 NOT LIKE '%[^a-z_.]%'
    AND CHARINDEX('.', code) > 1
    AND code NOT LIKE '%.'
    AND code NOT LIKE '%..%'
);
GO
