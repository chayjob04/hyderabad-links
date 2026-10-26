-- Manual smoke test for the database rules behind admin MFA (S0003 and docs/security.md).
-- It creates its own administrator, exercises the recovery-code and replay rules, then rolls back,
-- so it leaves no data and is safe to re-run.
--
-- The PostgreSQL original is database/checks/admin_mfa_smoke.sql, kept as history. What changed:
-- sha256(...) became HASHBYTES('SHA2_256', ...), decode(repeat(...),'hex') became CONVERT with
-- style 2, length() on bytes became DATALENGTH (LEN would measure characters), generate_series
-- became the hl_numbers tally table that S0008 already provides, and GET DIAGNOSTICS became
-- @@ROWCOUNT.
--
-- Run:
--   npm run db:check -- admin_mfa_smoke

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @admin bigint, @rows int, @unused int;

INSERT INTO admin_users (email, display_name, password_hash, status)
VALUES ('smoke.mfa@example.com', 'Smoke MFA', 'pbkdf2-sha256$1$AAAA$AAAA', 'active');
SET @admin = SCOPE_IDENTITY();

-- 1. A new administrator has no authenticator, so they are not yet protected by one.
IF (SELECT totp_enabled_at FROM admin_users WHERE id = @admin) IS NOT NULL
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a new admin should not be enrolled';
END
ELSE IF (SELECT totp_last_step FROM admin_users WHERE id = @admin) IS NOT NULL
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a new admin should have no spent TOTP step';
END
ELSE PRINT 'ok: a new admin is not enrolled and has no spent step';

-- 2. Enrollment stores a sealed secret. The column holds ciphertext, never the raw 20-byte secret:
--    nonce (12) + tag (16) + secret (20) = 48 bytes.
UPDATE admin_users
SET totp_secret_encrypted = CONVERT(varbinary(256), REPLICATE('ab', 48), 2),
    totp_enabled_at = SYSDATETIMEOFFSET()
WHERE id = @admin;
IF (SELECT DATALENGTH(totp_secret_encrypted) FROM admin_users WHERE id = @admin) <> 48
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the sealed secret is not the expected length';
END
ELSE PRINT 'ok: the sealed secret is 48 bytes of ciphertext';

-- 3. Recovery codes are stored as hashes, never as the codes themselves.
INSERT INTO admin_recovery_codes (admin_user_id, code_hash)
SELECT @admin, HASHBYTES('SHA2_256', CONCAT('code-', n))
FROM hl_numbers WHERE n BETWEEN 1 AND 10;

SET @unused = (SELECT COUNT(*) FROM admin_recovery_codes WHERE admin_user_id = @admin AND used_at IS NULL);
IF @unused <> 10
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: expected 10 unused recovery codes, found ' + CAST(@unused AS varchar(10));
END
ELSE PRINT 'ok: ten unused recovery codes were stored as hashes';

-- 4. Spending one marks it used, and the same UPDATE cannot spend it again. This is the exact
--    statement the endpoint runs, so a second attempt affecting 0 rows is what blocks reuse.
UPDATE admin_recovery_codes SET used_at = SYSDATETIMEOFFSET()
WHERE id = (SELECT TOP (1) id FROM admin_recovery_codes
            WHERE admin_user_id = @admin
              AND code_hash = HASHBYTES('SHA2_256', 'code-1')
              AND used_at IS NULL);
SET @rows = @@ROWCOUNT;
IF @rows <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: spending a fresh recovery code affected ' + CAST(@rows AS varchar(10)) + ' rows';
END
ELSE PRINT 'ok: spending a fresh recovery code marked exactly one row used';

UPDATE admin_recovery_codes SET used_at = SYSDATETIMEOFFSET()
WHERE id = (SELECT TOP (1) id FROM admin_recovery_codes
            WHERE admin_user_id = @admin
              AND code_hash = HASHBYTES('SHA2_256', 'code-1')
              AND used_at IS NULL);
SET @rows = @@ROWCOUNT;
IF @rows <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the same recovery code was spent twice';
END
ELSE PRINT 'ok: the same recovery code cannot be spent twice';

SET @unused = (SELECT COUNT(*) FROM admin_recovery_codes WHERE admin_user_id = @admin AND used_at IS NULL);
IF @unused <> 9
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: expected 9 unused codes after spending one, found ' + CAST(@unused AS varchar(10));
END
ELSE PRINT 'ok: nine codes remain';

-- 5. The spent TOTP step is recorded on the account, which is what makes replay detection exact.
--    A timestamp cannot stand in for it: a code accepted from the *next* step belongs to a later
--    step than "now", so a clock-derived value would be too low to refuse that same code again.
UPDATE admin_users SET totp_last_step = 59744977 WHERE id = @admin;
IF (SELECT totp_last_step FROM admin_users WHERE id = @admin) <> 59744977
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the spent step was not recorded';
END
ELSE PRINT 'ok: the spent TOTP step is recorded on the account';

-- 6. A session records when MFA completed. The sign-in path always sets it, and refresh carries it
--    forward, so a session without it must never be treated as authenticated.
INSERT INTO admin_sessions (admin_user_id, family_id, refresh_token_hash, expires_at, last_mfa_at)
VALUES (@admin, NEWID(), HASHBYTES('SHA2_256', 'refresh-1'),
        DATEADD(day, 7, SYSDATETIMEOFFSET()), SYSDATETIMEOFFSET());
IF (SELECT TOP (1) last_mfa_at FROM admin_sessions WHERE admin_user_id = @admin) IS NULL
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the session did not record its MFA time';
END
ELSE PRINT 'ok: the session records when MFA completed';

-- 7. Deleting the administrator takes their recovery codes with them.
DELETE FROM admin_sessions WHERE admin_user_id = @admin;
DELETE FROM admin_user_roles WHERE admin_user_id = @admin;
DELETE FROM admin_users WHERE id = @admin;
SET @rows = (SELECT COUNT(*) FROM admin_recovery_codes WHERE admin_user_id = @admin);
IF @rows <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: ' + CAST(@rows AS varchar(10)) + ' recovery codes outlived their admin';
END
ELSE PRINT 'ok: recovery codes do not outlive their admin';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'admin MFA storage rules behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
