-- S0028: an admin account can be required to change its password at the next sign-in.
--
-- Everything else the Admin Accounts screen needs is already in `admin_users`: last_login_at,
-- password_changed_at, totp_enabled_at, failed_login_count, locked_until and the invited/active/
-- disabled status have all been there since S0003. They were simply never surfaced. This adds the
-- one fact the schema could not already express.
--
-- It is set when a super admin creates an account, and when one resets somebody else's password:
-- in both cases the password was chosen by a third party and typed into a screen, so it is
-- temporary by definition. Changing your own password clears it.
--
-- The flag is not merely a hint to the UI. AdminAccess.Authorize and AuthorizeSuper -- the two
-- gates every permission-checked admin endpoint already passes through -- refuse while it is set,
-- so a token obtained with a temporary password reaches nothing except the endpoint that changes
-- it. Enforcing it in the browser alone would be theatre.
--
-- Nothing here is destructive, and no other table is touched.
--
-- Object names are looked up rather than assumed, and everything is schema-qualified: the
-- production login's default schema is not dbo, and its constraints carry server-generated names
-- (decisions D57 and D58).

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH('dbo.admin_users', 'must_change_password') IS NULL
BEGIN
    ALTER TABLE dbo.admin_users
        ADD must_change_password bit NOT NULL
            CONSTRAINT admin_users_must_change_default DEFAULT 0;
END
GO

-- Fail loudly rather than journalling a migration that did nothing, as every migration here does.
IF COL_LENGTH('dbo.admin_users', 'must_change_password') IS NULL
BEGIN
    THROW 51040, 'S0028 did not add admin_users.must_change_password.', 1;
END
GO
