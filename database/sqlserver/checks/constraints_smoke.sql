-- Manual smoke test for the constraints that had to be rewritten by hand for SQL Server, and for
-- the trigram maintenance that replaced pg_trgm. It inserts, asserts, and rolls back, so it leaves
-- no data and is safe to re-run.
--
-- Why this file exists: PostgreSQL enforced the phone, slug and email shapes with regular
-- expressions, which a SQL Server check constraint cannot do. Each one became a set of LIKE
-- patterns over a case-sensitive collation (see database/sqlserver/migrations/README.md). A LIKE
-- pattern that is subtly wrong still accepts the good values and quietly lets a bad one through, so
-- the bad values are the point of this check.
--
-- Run:
--   npm run db:check -- constraints_smoke

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @city int = (SELECT TOP (1) id FROM cities WHERE slug = 'hyderabad');
DECLARE @locality int = (SELECT TOP (1) id FROM localities WHERE slug = 'madhapur');
DECLARE @failed int = 0;

-- A small helper pattern: each test runs a statement that must fail, and TRY/CATCH turns "it was
-- refused" into a pass. A statement that succeeds falls through to the RAISERROR after it.

-- 1. A phone number must be E.164: a plus, a non-zero digit, then digits only.
BEGIN TRY
    INSERT INTO users (phone_e164) VALUES ('09876543210');   -- no plus
    SET @failed = @failed + 1; PRINT 'FAIL: a number with no plus was accepted';
END TRY BEGIN CATCH PRINT 'ok: no plus rejected'; END CATCH;

BEGIN TRY
    INSERT INTO users (phone_e164) VALUES ('+00876543210');  -- leading zero after the plus
    SET @failed = @failed + 1; PRINT 'FAIL: a number starting +0 was accepted';
END TRY BEGIN CATCH PRINT 'ok: leading zero rejected'; END CATCH;

BEGIN TRY
    INSERT INTO users (phone_e164) VALUES ('+91987654a210'); -- a letter in the middle
    SET @failed = @failed + 1; PRINT 'FAIL: a number containing a letter was accepted';
END TRY BEGIN CATCH PRINT 'ok: letter in a number rejected'; END CATCH;

BEGIN TRY
    INSERT INTO users (phone_e164) VALUES ('+9198');         -- too short
    SET @failed = @failed + 1; PRINT 'FAIL: a 4-character number was accepted';
END TRY BEGIN CATCH PRINT 'ok: too-short number rejected'; END CATCH;

INSERT INTO users (phone_e164, name) VALUES ('+919999123456', 'Constraint Check');
PRINT 'ok: a valid E.164 number was accepted';

-- 2. A slug is lower case, digits and single hyphens. The case-sensitive collation is what makes
--    the upper-case test meaningful: the database's own collation would consider them equal.
DECLARE @business bigint;
INSERT INTO businesses (name) VALUES ('Constraint Check Business');
SET @business = SCOPE_IDENTITY();

BEGIN TRY
    INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary)
    VALUES (@business, @locality, 'Not-Lower-Case', 'Constraint Check', geography::Point(17.4, 78.4, 4326), '+919999123456');
    SET @failed = @failed + 1; PRINT 'FAIL: an upper-case slug was accepted';
END TRY BEGIN CATCH PRINT 'ok: upper-case slug rejected'; END CATCH;

BEGIN TRY
    INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary)
    VALUES (@business, @locality, 'has spaces', 'Constraint Check', geography::Point(17.4, 78.4, 4326), '+919999123456');
    SET @failed = @failed + 1; PRINT 'FAIL: a slug with a space was accepted';
END TRY BEGIN CATCH PRINT 'ok: slug with a space rejected'; END CATCH;

BEGIN TRY
    INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary)
    VALUES (@business, @locality, '-leading-hyphen', 'Constraint Check', geography::Point(17.4, 78.4, 4326), '+919999123456');
    SET @failed = @failed + 1; PRINT 'FAIL: a slug starting with a hyphen was accepted';
END TRY BEGIN CATCH PRINT 'ok: leading hyphen rejected'; END CATCH;

BEGIN TRY
    INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary)
    VALUES (@business, @locality, 'double--hyphen', 'Constraint Check', geography::Point(17.4, 78.4, 4326), '+919999123456');
    SET @failed = @failed + 1; PRINT 'FAIL: a slug with two hyphens together was accepted';
END TRY BEGIN CATCH PRINT 'ok: double hyphen rejected'; END CATCH;

DECLARE @listing bigint;
INSERT INTO listings (business_id, locality_id, slug, name, description, location, phone_primary, status)
VALUES (@business, @locality, 'constraint-check-listing', 'Constraint Check Plumbing',
        'A listing that exists only inside a transaction that rolls back.',
        geography::Point(17.4486, 78.3908, 4326), '+919999123456', 'active');
SET @listing = SCOPE_IDENTITY();
PRINT 'ok: a valid slug was accepted';

-- 3. An admin email must be lower case with an @ in it, again over a case-sensitive collation.
BEGIN TRY
    INSERT INTO admin_users (email, display_name) VALUES ('Mixed@Example.com', 'Constraint Check');
    SET @failed = @failed + 1; PRINT 'FAIL: a mixed-case admin email was accepted';
END TRY BEGIN CATCH PRINT 'ok: mixed-case admin email rejected'; END CATCH;

-- 4. A notification recipient must not contain whitespace: a newline in an address is how a header
--    injection reaches a provider.
BEGIN TRY
    INSERT INTO notifications (kind, recipient, subject_type, subject_id)
    VALUES ('enquiry_received', 'someone@example.com' + CHAR(10) + 'bcc: else@example.com', 'listing', @listing);
    SET @failed = @failed + 1; PRINT 'FAIL: a recipient containing a newline was accepted';
END TRY BEGIN CATCH PRINT 'ok: newline in a recipient rejected'; END CATCH;

-- 5. The three notification states stay honest: pending means untouched.
BEGIN TRY
    INSERT INTO notifications (kind, recipient, subject_type, subject_id, status, attempts)
    VALUES ('enquiry_received', 'someone@example.com', 'listing', @listing, 'pending', 3);
    SET @failed = @failed + 1; PRINT 'FAIL: a pending notification with attempts was accepted';
END TRY BEGIN CATCH PRINT 'ok: pending-with-attempts rejected'; END CATCH;

-- 6. Media dimensions come in pairs or not at all. This is the one PostgreSQL got wrong first time:
--    a CHECK accepts NULL, so "width > 0 AND height > 0" with only a width set let the row through.
BEGIN TRY
    INSERT INTO listing_media (listing_id, kind, storage_key, content_type, byte_size, width)
    VALUES (@listing, 'photo', 'checks/half.jpg', 'image/jpeg', 100, 800);
    SET @failed = @failed + 1; PRINT 'FAIL: a width without a height was accepted';
END TRY BEGIN CATCH PRINT 'ok: half a dimension pair rejected'; END CATCH;

-- 7. The trigram table is maintained by the triggers that replaced pg_trgm.
DECLARE @trigrams int = (SELECT COUNT(*) FROM search_trigrams WHERE entity_type = 'listing' AND entity_id = @listing);
IF @trigrams = 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: inserting a listing left no trigrams behind';
END
ELSE PRINT 'ok: the insert produced ' + CAST(@trigrams AS varchar(10)) + ' trigrams';

-- A misspelling of the new listing's name must still score above pg_trgm's 0.3 threshold.
DECLARE @similarity float = (SELECT similarity FROM hl_similarity('listing', @listing, 'constrait check plumbing'));
IF @similarity < 0.3
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a misspelling scored only ' + CAST(@similarity AS varchar(20));
END
ELSE PRINT 'ok: a misspelling scored ' + CAST(ROUND(@similarity, 3) AS varchar(20));

-- An unrelated name must score nothing at all.
DECLARE @unrelated float = (SELECT similarity FROM hl_similarity('listing', @listing, 'biryani'));
IF @unrelated > 0.1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: an unrelated word scored ' + CAST(@unrelated AS varchar(20));
END
ELSE PRINT 'ok: an unrelated word scored ' + CAST(ROUND(@unrelated, 3) AS varchar(20));

/* Renaming must move the trigrams with the name: the old name stops matching and the new one
   starts. The scores are compared against each other rather than against 0.3, because similarity
   falls as a name gets longer -- a single word against a three-word name scores under 0.3 in
   pg_trgm too, and that is the behaviour being preserved, not a fault. */
DECLARE @beforeRename float = (SELECT similarity FROM hl_similarity('listing', @listing, 'constraint check plumbing'));
UPDATE listings SET name = 'Renamed Zephyr Services' WHERE id = @listing;
DECLARE @oldName float = (SELECT similarity FROM hl_similarity('listing', @listing, 'constraint check plumbing'));
DECLARE @newName float = (SELECT similarity FROM hl_similarity('listing', @listing, 'renamed zephyr services'));
IF NOT (@oldName < @beforeRename AND @newName > @oldName)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the rename did not move the trigrams (old ' + CAST(ROUND(@oldName,3) AS varchar(20))
        + ', new ' + CAST(ROUND(@newName,3) AS varchar(20)) + ')';
END
ELSE PRINT 'ok: the rename moved the trigrams (old name now ' + CAST(ROUND(@oldName,3) AS varchar(20))
        + ', new name ' + CAST(ROUND(@newName,3) AS varchar(20)) + ')';

-- 8. The audit log is append-only: the INSTEAD OF triggers accept the statement and change nothing.
INSERT INTO audit_logs (actor_type, action) VALUES ('system', 'constraint.check');
DECLARE @auditId bigint = SCOPE_IDENTITY();
UPDATE audit_logs SET action = 'tampered' WHERE id = @auditId;
IF (SELECT action FROM audit_logs WHERE id = @auditId) <> 'constraint.check'
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: an audit row was updated';
END
ELSE PRINT 'ok: updating an audit row changed nothing';

DELETE FROM audit_logs WHERE id = @auditId;
IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE id = @auditId)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: an audit row was deleted';
END
ELSE PRINT 'ok: deleting an audit row changed nothing';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'constraints and trigram maintenance behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
