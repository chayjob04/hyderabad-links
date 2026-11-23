-- Manual smoke test for S0032: owners' requests for an area or a category.
-- The transactional part inserts, asserts, and rolls back, so it leaves no data and is safe to re-run.
--
-- The rules worth checking here are the ones the database holds rather than the API: one pending
-- request per name, "approved" being impossible without something to show for it, and a refusal
-- being impossible without a reason. Each of those is a CHECK or an index, and each of them is what
-- stops a queue item that no screen can describe.
--
-- Run:
--   npm run db:check -- taxonomy_suggestions
--
-- NOTE, honestly: this file has never been executed. There is no SQL Server available outside
-- production in this environment, so it was written alongside the migration and is the first thing
-- to run once S0032 has been applied to a database somebody can afford to break.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.taxonomy_suggestions', 'U') IS NULL
BEGIN
    PRINT 'FAIL: dbo.taxonomy_suggestions does not exist, so S0032 has not run';
    THROW 51033, 'S0032 has not been applied.', 1;
END;
PRINT 'ok: the suggestions table exists';
GO

DECLARE @failed int = 0;
BEGIN TRANSACTION;

DECLARE @owner bigint, @category int, @locality int, @first bigint;

SELECT TOP (1) @locality = id FROM dbo.localities ORDER BY id;
SELECT TOP (1) @category = id FROM dbo.categories WHERE level = 2 ORDER BY id;

INSERT INTO dbo.users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900711', SYSDATETIMEOFFSET(), 'Smoke Suggest Owner', 'suggest@example.com');
SET @owner = SCOPE_IDENTITY();

-- 1. A request can be recorded.
INSERT INTO dbo.taxonomy_suggestions (kind, suggested_name, normalised, status, user_id)
VALUES ('locality', N'Smoke Nallagandla', N'smoke nallagandla', 'pending', @owner);
SET @first = SCOPE_IDENTITY();
PRINT 'ok: a request can be recorded';

-- 2. The same name twice, while nobody has answered, is one request and not two.
BEGIN TRY
    INSERT INTO dbo.taxonomy_suggestions (kind, suggested_name, normalised, status, user_id)
    VALUES ('locality', N'smoke  nallagandla', N'smoke nallagandla', 'pending', @owner);
    SET @failed = @failed + 1;
    PRINT 'FAIL: a second pending request for the same name was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: one pending request per name';
END CATCH

-- 3. The same name for the other kind is a different request: an area and a category can share a
--    name without being the same thing to ask for.
BEGIN TRY
    INSERT INTO dbo.taxonomy_suggestions (kind, suggested_name, normalised, status, user_id)
    VALUES ('category', N'Smoke Nallagandla', N'smoke nallagandla', 'pending', @owner);
    PRINT 'ok: the same name can be asked for as an area and as a category';
END TRY
BEGIN CATCH
    SET @failed = @failed + 1;
    PRINT 'FAIL: the duplicate rule is not scoped to the kind: ' + ERROR_MESSAGE();
END CATCH

-- 4. A kind outside the two is refused.
BEGIN TRY
    INSERT INTO dbo.taxonomy_suggestions (kind, suggested_name, normalised, status, user_id)
    VALUES ('segment', N'Smoke Segment Request', N'smoke segment request', 'pending', @owner);
    SET @failed = @failed + 1;
    PRINT 'FAIL: a third kind was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: only an area or a category can be asked for';
END CATCH

-- 5. "Approved" with nothing to show for it is refused. This is what stops approval meaning
--    "somebody pressed a button" rather than "this exists now".
BEGIN TRY
    UPDATE dbo.taxonomy_suggestions SET status = 'approved' WHERE id = @first;
    SET @failed = @failed + 1;
    PRINT 'FAIL: a request was approved without creating anything';
END TRY
BEGIN CATCH
    PRINT 'ok: an approved request has to point at what it became';
END CATCH

-- 6. And it has to point at the right kind of thing: an area request cannot resolve to a category.
BEGIN TRY
    UPDATE dbo.taxonomy_suggestions SET status = 'approved', resolved_category_id = @category WHERE id = @first;
    SET @failed = @failed + 1;
    PRINT 'FAIL: an area request was resolved to a category';
END TRY
BEGIN CATCH
    PRINT 'ok: an area request resolves to an area';
END CATCH

-- 7. The right shape is accepted.
BEGIN TRY
    UPDATE dbo.taxonomy_suggestions SET status = 'approved', resolved_locality_id = @locality WHERE id = @first;
    PRINT 'ok: an approved area request points at the area it created';
END TRY
BEGIN CATCH
    SET @failed = @failed + 1;
    PRINT 'FAIL: a correctly resolved request was refused: ' + ERROR_MESSAGE();
END CATCH

-- 8. Now that the first one is decided, the same name may be asked for again. A refusal or an
--    approval is not a permanent ban on a word.
BEGIN TRY
    INSERT INTO dbo.taxonomy_suggestions (kind, suggested_name, normalised, status, user_id)
    VALUES ('locality', N'Smoke Nallagandla', N'smoke nallagandla', 'pending', @owner);
    PRINT 'ok: a name can be asked for again once the first request is decided';
END TRY
BEGIN CATCH
    SET @failed = @failed + 1;
    PRINT 'FAIL: the duplicate rule is not limited to pending requests: ' + ERROR_MESSAGE();
END CATCH

-- 9. A refusal has to say why, and so does "already there": the owner reads it.
DECLARE @second bigint = SCOPE_IDENTITY();

BEGIN TRY
    UPDATE dbo.taxonomy_suggestions SET status = 'rejected' WHERE id = @second;
    SET @failed = @failed + 1;
    PRINT 'FAIL: a refusal with no note was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a refusal must carry a note';
END CATCH

BEGIN TRY
    UPDATE dbo.taxonomy_suggestions SET status = 'already_exists', note = N'   ' WHERE id = @second;
    SET @failed = @failed + 1;
    PRINT 'FAIL: "already there" with a blank note was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: "already there" has to name what to use instead';
END CATCH

-- 10. A one-character name is refused by the table as well as by the API.
BEGIN TRY
    INSERT INTO dbo.taxonomy_suggestions (kind, suggested_name, normalised, status, user_id)
    VALUES ('locality', N'x', N'x', 'pending', @owner);
    SET @failed = @failed + 1;
    PRINT 'FAIL: a one-character name was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a name has to be long enough to be a name';
END CATCH

ROLLBACK TRANSACTION;

IF @failed > 0
BEGIN
    DECLARE @message nvarchar(200) = CAST(@failed AS nvarchar(10)) + ' suggestion check(s) failed.';
    THROW 51034, @message, 1;
END
PRINT 'taxonomy_suggestions_smoke: all checks passed.';
GO
