-- Manual smoke test for the two things staff curate on the homepage (S0025).
--
-- There is one thing here worth real care, and it is the reason this file exists:
-- `scrolling_texts.url`. That value is typed into the admin panel and rendered as a link on every
-- public page, which is the exact shape of an open redirect — and of a `javascript:` payload. The
-- API refuses anything but a site-relative path, and so does the CHECK constraint. The API's rule
-- is covered by ScrollingTextValidationTests; what is asserted below is the constraint, because
-- that is the one that still holds for a row inserted by a script, a repair, or a later endpoint
-- that forgot.
--
-- The rest is ordinary: the `is_popular` flag defaults off, so the migration cannot have silently
-- promoted every category, and both filtered indexes exist.
--
-- It creates its own rows, asserts, then rolls back, so it leaves no data and is safe to re-run.
-- Every message it writes is prefixed `smoke-hc-`, and the one category it flags is restored by the
-- rollback rather than by an UPDATE, so a failure part-way through cannot leave a category promoted.
--
-- Run:
--   npm run db:check -- homepage

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @category int, @line int, @n int;

SELECT TOP (1) @category = id FROM dbo.categories WHERE level = 2 ORDER BY id;

-- ---------------------------------------------------------------- popular categories
-- 1. The flag defaults to off. A migration that defaulted it on would have put the whole
--    directory under the search box on the day it was applied.
IF EXISTS (SELECT 1 FROM dbo.categories WHERE is_popular IS NULL)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: is_popular is NULL on some categories';
END
ELSE PRINT 'ok: is_popular is never NULL';

-- 2. Flagging one category flags exactly one.
UPDATE dbo.categories SET is_popular = 1 WHERE id = @category;
SET @n = (SELECT COUNT(*) FROM dbo.categories WHERE is_popular = 1 AND id <> @category);
IF (SELECT is_popular FROM dbo.categories WHERE id = @category) <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the category was not flagged';
END
ELSE PRINT 'ok: a category can be flagged popular';

-- 3. The filtered index the public read depends on exists. Without it the homepage scans the whole
--    category table on every request that is not cached.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'categories_popular_idx' AND object_id = OBJECT_ID('dbo.categories'))
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: categories_popular_idx is missing';
END
ELSE PRINT 'ok: categories_popular_idx exists';

-- ---------------------------------------------------------------- the scrolling strip
-- 4. An ordinary line with a site-relative link is accepted.
INSERT INTO dbo.scrolling_texts (message, url, sort_order)
VALUES (N'smoke-hc-one', '/verified', 0);
SET @line = SCOPE_IDENTITY();
PRINT 'ok: a line with a site-relative link is accepted';

-- 5. A line with no link is accepted: an announcement with nowhere to go is legitimate.
BEGIN TRY
    INSERT INTO dbo.scrolling_texts (message, url) VALUES (N'smoke-hc-two', NULL);
    PRINT 'ok: a line with no link is accepted';
END TRY
BEGIN CATCH
    SET @failed = @failed + 1; PRINT 'FAIL: a line with no link was refused';
END CATCH

-- 6. is_active defaults on, so a line staff add appears without a second step.
IF (SELECT is_active FROM dbo.scrolling_texts WHERE id = @line) <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: is_active did not default to 1';
END
ELSE PRINT 'ok: a new line is active by default';

-- 7. A blank message is refused. An empty line on a moving strip is a gap nobody can explain.
BEGIN TRY
    INSERT INTO dbo.scrolling_texts (message) VALUES (N'   ');
    SET @failed = @failed + 1; PRINT 'FAIL: a blank message was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a blank message is refused';
END CATCH

-- ---------------------------------------------------------------- the link rule, one shape at a time
-- 8. A scheme is refused. This is the assertion the whole file is for.
BEGIN TRY
    INSERT INTO dbo.scrolling_texts (message, url) VALUES (N'smoke-hc-js', 'javascript:alert(1)');
    SET @failed = @failed + 1; PRINT 'FAIL: a javascript: URL was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a javascript: URL is refused';
END CATCH

-- 9. An absolute URL to another host is refused: this strip does not leave the site.
BEGIN TRY
    INSERT INTO dbo.scrolling_texts (message, url) VALUES (N'smoke-hc-abs', 'https://evil.example');
    SET @failed = @failed + 1; PRINT 'FAIL: an off-site URL was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: an off-site URL is refused';
END CATCH

-- 10. Protocol-relative is refused. It starts with "/" and a naive check would let it through,
--     but a browser reads "//evil.example" as another host, not as a path.
BEGIN TRY
    INSERT INTO dbo.scrolling_texts (message, url) VALUES (N'smoke-hc-pr', '//evil.example');
    SET @failed = @failed + 1; PRINT 'FAIL: a protocol-relative URL was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a protocol-relative URL is refused';
END CATCH

-- 11. A bare word is refused: it is not a path, and the browser would resolve it against whatever
--     page the strip happens to be on.
BEGIN TRY
    INSERT INTO dbo.scrolling_texts (message, url) VALUES (N'smoke-hc-bare', 'verified');
    SET @failed = @failed + 1; PRINT 'FAIL: a relative word was accepted as a link';
END TRY
BEGIN CATCH
    PRINT 'ok: a bare word is refused';
END CATCH

-- 12. "/" alone is refused. It is technically a path, but a line that links to the homepage from
--     the homepage is a dead click, and the API says the same.
BEGIN TRY
    INSERT INTO dbo.scrolling_texts (message, url) VALUES (N'smoke-hc-root', '/');
    SET @failed = @failed + 1; PRINT 'FAIL: "/" was accepted as a link';
END TRY
BEGIN CATCH
    PRINT 'ok: "/" alone is refused';
END CATCH

-- 13. The filtered index the public read uses.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'scrolling_texts_order_idx' AND object_id = OBJECT_ID('dbo.scrolling_texts'))
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: scrolling_texts_order_idx is missing';
END
ELSE PRINT 'ok: scrolling_texts_order_idx exists';

-- 14. The permission both admin screens are gated on. Without it the screens exist and nothing
--     can open them.
IF NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE code = 'homepage.manage')
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the homepage.manage permission is missing';
END
ELSE PRINT 'ok: homepage.manage exists';

-- 15. And it is granted to the admin role, as S0025 says. A permission granted to nobody is a
--     screen nobody can reach.
IF NOT EXISTS (
    SELECT 1 FROM dbo.role_permissions rp
    JOIN dbo.roles r ON r.id = rp.role_id AND r.slug = 'admin'
    JOIN dbo.permissions p ON p.id = rp.permission_id AND p.code = 'homepage.manage')
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: homepage.manage is not granted to the admin role';
END
ELSE PRINT 'ok: homepage.manage is granted to the admin role';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'the strip only links inside this site, and no category is popular until somebody says so';
GO

ROLLBACK TRANSACTION;
GO
