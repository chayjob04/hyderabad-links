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
         grants_verified_badge, media_limits_confirmed, sort_order, is_active)
    VALUES
        ('free', 'Free', 0, 0, 0, 0, 0, 1, 0, 1);
END;

-- Configure the single paid plan.
IF EXISTS (SELECT 1 FROM dbo.plans WHERE slug = 'verified')
BEGIN
    UPDATE dbo.plans
    SET name = 'Verified',
        price_paise = 39900,
        photo_limit = 10,
        video_limit = 3,
        logo_limit = 1,
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
         grants_verified_badge, media_limits_confirmed, sort_order, is_active)
    VALUES
        ('verified', 'Verified', 39900, 10, 3, 1, 1, 1, 1, 1);
END;

-- Disable legacy plans without deleting rows that other records may reference.
UPDATE dbo.plans
SET is_active = 0,
    updated_at = SYSDATETIMEOFFSET()
WHERE slug NOT IN ('free', 'verified');

COMMIT TRANSACTION;
GO
