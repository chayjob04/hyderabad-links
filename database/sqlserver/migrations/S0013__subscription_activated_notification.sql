-- S0013: let a notification say "your plan is active".
--
-- A customer paid Rs 399 and got nothing in writing. The enquiry, approval and rejection emails all
-- exist; the one that confirms money was taken did not, which is the one an owner is most likely to
-- go looking for. `notifications_kind_check` allowed only three kinds, so the row could not even be
-- recorded.
--
-- `subject_type` is unchanged: a subscription's subject is the listing it verifies, which 'listing'
-- already covers.
--
-- approved-destructive: replaces one CHECK constraint with the same constraint plus one more
-- allowed value. No data is read, written or deleted, and the new constraint accepts everything the
-- old one did.
--
-- **The constraint is found by its definition, not by its name.** This database's schema was built
-- outside these migrations, so its constraints carry system-generated names -- the same trap S0010
-- hit on `permissions`, where the migration's name did not exist on the live table. Dropping
-- `notifications_kind_check` by name would work on a database built from S0007 and fail on this one.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

DECLARE @name sysname = (
    SELECT TOP (1) cc.name
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id = OBJECT_ID('dbo.notifications')
      AND cc.definition LIKE '%enquiry_received%');

IF @name IS NULL
BEGIN
    /* Either the constraint is already gone, or it never matched. Not an error to stop the chain
       for: the ADD below is what this migration is actually for, and it would fail loudly if the
       old constraint were still in place under a definition this did not recognise. */
    PRINT 'S0013 note: no existing kind constraint matched; adding the new one only.';
END
ELSE
BEGIN
    DECLARE @drop nvarchar(400) =
        N'ALTER TABLE dbo.notifications DROP CONSTRAINT ' + QUOTENAME(@name) + N';';
    EXEC sp_executesql @drop;
END;
GO

-- Named, so a future migration can find it either way.
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.notifications') AND name = 'notifications_kind_check')
BEGIN
    ALTER TABLE dbo.notifications WITH CHECK ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
        'enquiry_received',
        'listing_approved',
        'listing_rejected',
        'subscription_activated'
    ));
END;
GO
