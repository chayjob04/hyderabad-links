SET XACT_ABORT ON;

BEGIN TRANSACTION;

-- Ensure the Free plan exists and is configured correctly.
IF EXISTS (SELECT 1 FROM dbo.plans WHERE slug = 'free')
BEGIN
    UPDATE dbo.plans
    SET name = 'Free',
        price_paise = 0,
        photo_limit = 0,
        video_limit = 0,
        logo_limit = 0,
        faq_limit = 0,
        content_section_limit = 0,
        grants_verified_badge = 0,
        media_limits_confirmed = 1,
        sort_order = 0,
        is_active = 1,
        updated_at = SYSDATETIMEOFFSET()
    WHERE slug = 'free';
END
ELSE
BEGIN
    INSERT INTO dbo.plans
        (slug, name, price_paise, photo_limit, video_limit, logo_limit,
         faq_limit, content_section_limit,
         grants_verified_badge, media_limits_confirmed, sort_order, is_active)
    VALUES
        ('free', 'Free', 0, 0, 0, 0, 0, 0, 0, 1, 0, 1);
END;

/* Configure the single paid plan.

   These numbers are the same ones the migrations assert, and they have to be kept that way: this
   seed is re-applied on EVERY `npm run db:migrate`, *after* the migrations (MigrationRunner calls
   ApplySeedFiles last). So a migration that changes a plan allowance and does not change this file
   is undone by it seconds later, in the same command, with the migration still recorded as applied.
   That is exactly what happened to S0029 in production: it set 5 photos and 1 video, its own
   assertion passed, and then this seed put 10 and 2 back.

   photo_limit 5 and video_limit 1 are S0029's values. S0016 asserts the older 10 and 2, which is
   correct at its own point in history and runs long before this seed does. */
IF EXISTS (SELECT 1 FROM dbo.plans WHERE slug = 'verified')
BEGIN
    UPDATE dbo.plans
    SET name = 'Verified',
        price_paise = 39900,
        photo_limit = 5,
        video_limit = 1,
        logo_limit = 1,
        faq_limit = 10,
        content_section_limit = 5,
        grants_verified_badge = 1,
        media_limits_confirmed = 1,
        sort_order = 1,
        is_active = 1,
        updated_at = SYSDATETIMEOFFSET()
    WHERE slug = 'verified';
END
ELSE
BEGIN
    INSERT INTO dbo.plans
        (slug, name, price_paise, photo_limit, video_limit, logo_limit,
         faq_limit, content_section_limit,
         grants_verified_badge, media_limits_confirmed, sort_order, is_active)
    VALUES
        ('verified', 'Verified', 39900, 5, 1, 1, 10, 5, 1, 1, 1, 1);
END;

/* Free and Verified are the whole subscription structure. The three old tiers were removed by
   migration S0011; this is the safety net for anything else that turns up — it deactivates rather
   than deletes, because a seed runs on every `db:migrate` and a seed is the wrong place to remove
   rows that something might reference. Removing a plan for good is a migration's job, where it can
   check its dependencies and refuse. */
UPDATE dbo.plans
SET is_active = 0,
    updated_at = SYSDATETIMEOFFSET()
WHERE slug NOT IN ('free', 'verified')
  AND is_active = 1;

COMMIT TRANSACTION;
GO
