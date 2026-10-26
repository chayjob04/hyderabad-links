-- DEV-ONLY sample data (never loaded in production). Loaded by: npm run db:seed-dev
-- Every business and listing is clearly labelled "Sample ...". Safe to re-run.
--
-- The SQL Server counterpart of database/seeds/dev/D001_sample_listings.sql. The sample rows are
-- unchanged; what differs is the point literal (latitude first), the string concatenation, and
-- ON CONFLICT DO NOTHING becoming NOT EXISTS.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

INSERT INTO dbo.businesses (name)
SELECT v.name FROM (VALUES
('Sample Sri Sai Plumbers Gachibowli'),
  ('Sample Sri Sai Plumbers Madhapur'),
  ('Sample Sri Sai Plumbers Kukatpally'),
  ('Sample Sri Sai Plumbers Secunderabad'),
  ('Sample Bright Spark Electricals Madhapur'),
  ('Sample Bright Spark Electricals Kondapur'),
  ('Sample Bright Spark Electricals Ameerpet'),
  ('Sample Smile Care Dental Clinic Banjara Hills'),
  ('Sample Smile Care Dental Clinic Gachibowli'),
  ('Sample Smile Care Dental Clinic Kukatpally'),
  ('Sample Nawab Biryani House Banjara Hills'),
  ('Sample Nawab Biryani House Charminar'),
  ('Sample Nawab Biryani House Madhapur'),
  ('Sample Glow Beauty Parlour Jubilee Hills'),
  ('Sample Glow Beauty Parlour Kondapur'),
  ('Sample Iron Peak Fitness Gachibowli'),
  ('Sample Iron Peak Fitness Uppal'),
  ('Sample Cool Breeze AC Service Kukatpally'),
  ('Sample Cool Breeze AC Service Dilsukhnagar'),
  ('Sample Safe Move Packers Mehdipatnam'),
  ('Sample Safe Move Packers Secunderabad'),
  ('Sample Bright Minds Tuitions Ameerpet'),
  ('Sample Bright Minds Tuitions Kukatpally'),
  ('Sample Brew and Bites Cafe Jubilee Hills'),
  ('Sample Brew and Bites Cafe Madhapur'),
  ('Sample Turbo Auto Garage Uppal'),
  ('Sample Turbo Auto Garage Miyapur'),
  ('Sample Dr Rao Family Clinic Begumpet'),
  ('Sample Dr Rao Family Clinic Lb Nagar')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM dbo.businesses b WHERE b.name = v.name);
GO

INSERT INTO dbo.listings (business_id, locality_id, slug, name, description, address_line, location, phone_primary, status, source)
SELECT b.id, lo.id, v.slug, v.name, 'Sample listing for local development only.',
       -- || is PostgreSQL's concatenation; SQL Server uses +.
       'Sample address, ' + lo.name,
       geography::Point(v.lat, v.lng, 4326), v.phone, 'active', 'admin'
FROM (VALUES
('gachibowli', 'sample-sri-sai-plumbers-gachibowli', 'Sample Sri Sai Plumbers Gachibowli', 17.43880, 78.34920, '+919999010001'),
  ('madhapur', 'sample-sri-sai-plumbers-madhapur', 'Sample Sri Sai Plumbers Madhapur', 17.45100, 78.38640, '+919999010002'),
  ('kukatpally', 'sample-sri-sai-plumbers-kukatpally', 'Sample Sri Sai Plumbers Kukatpally', 17.49090, 78.40050, '+919999010003'),
  ('secunderabad', 'sample-sri-sai-plumbers-secunderabad', 'Sample Sri Sai Plumbers Secunderabad', 17.43970, 78.49450, '+919999010004'),
  ('madhapur', 'sample-bright-spark-electricals-madhapur', 'Sample Bright Spark Electricals Madhapur', 17.45210, 78.39230, '+919999010005'),
  ('kondapur', 'sample-bright-spark-electricals-kondapur', 'Sample Bright Spark Electricals Kondapur', 17.45720, 78.36180, '+919999010006'),
  ('ameerpet', 'sample-bright-spark-electricals-ameerpet', 'Sample Bright Spark Electricals Ameerpet', 17.43840, 78.45040, '+919999010007'),
  ('banjara-hills', 'sample-smile-care-dental-clinic-banjara-hills', 'Sample Smile Care Dental Clinic Banjara Hills', 17.42020, 78.43210, '+919999010008'),
  ('gachibowli', 'sample-smile-care-dental-clinic-gachibowli', 'Sample Smile Care Dental Clinic Gachibowli', 17.43840, 78.35160, '+919999010009'),
  ('kukatpally', 'sample-smile-care-dental-clinic-kukatpally', 'Sample Smile Care Dental Clinic Kukatpally', 17.49680, 78.39760, '+919999010010'),
  ('banjara-hills', 'sample-nawab-biryani-house-banjara-hills', 'Sample Nawab Biryani House Banjara Hills', 17.41130, 78.43800, '+919999010011'),
  ('charminar', 'sample-nawab-biryani-house-charminar', 'Sample Nawab Biryani House Charminar', 17.36100, 78.47330, '+919999010012'),
  ('madhapur', 'sample-nawab-biryani-house-madhapur', 'Sample Nawab Biryani House Madhapur', 17.45170, 78.39470, '+919999010013'),
  ('jubilee-hills', 'sample-glow-beauty-parlour-jubilee-hills', 'Sample Glow Beauty Parlour Jubilee Hills', 17.42940, 78.40630, '+919999010014'),
  ('kondapur', 'sample-glow-beauty-parlour-kondapur', 'Sample Glow Beauty Parlour Kondapur', 17.46050, 78.36950, '+919999010015'),
  ('gachibowli', 'sample-iron-peak-fitness-gachibowli', 'Sample Iron Peak Fitness Gachibowli', 17.44430, 78.34870, '+919999010016'),
  ('uppal', 'sample-iron-peak-fitness-uppal', 'Sample Iron Peak Fitness Uppal', 17.40290, 78.55410, '+919999010017'),
  ('kukatpally', 'sample-cool-breeze-ac-service-kukatpally', 'Sample Cool Breeze AC Service Kukatpally', 17.49640, 78.40000, '+919999010018'),
  ('dilsukhnagar', 'sample-cool-breeze-ac-service-dilsukhnagar', 'Sample Cool Breeze AC Service Dilsukhnagar', 17.36410, 78.52040, '+919999010019'),
  ('mehdipatnam', 'sample-safe-move-packers-mehdipatnam', 'Sample Safe Move Packers Mehdipatnam', 17.39400, 78.43600, '+919999010020'),
  ('secunderabad', 'sample-safe-move-packers-secunderabad', 'Sample Safe Move Packers Secunderabad', 17.44260, 78.49460, '+919999010021'),
  ('ameerpet', 'sample-bright-minds-tuitions-ameerpet', 'Sample Bright Minds Tuitions Ameerpet', 17.43390, 78.44990, '+919999010022'),
  ('kukatpally', 'sample-bright-minds-tuitions-kukatpally', 'Sample Bright Minds Tuitions Kukatpally', 17.49490, 78.39650, '+919999010023'),
  ('jubilee-hills', 'sample-brew-and-bites-cafe-jubilee-hills', 'Sample Brew and Bites Cafe Jubilee Hills', 17.43640, 78.40930, '+919999010024'),
  ('madhapur', 'sample-brew-and-bites-cafe-madhapur', 'Sample Brew and Bites Cafe Madhapur', 17.44610, 78.38830, '+919999010025'),
  ('uppal', 'sample-turbo-auto-garage-uppal', 'Sample Turbo Auto Garage Uppal', 17.40620, 78.56180, '+919999010026'),
  ('miyapur', 'sample-turbo-auto-garage-miyapur', 'Sample Turbo Auto Garage Miyapur', 17.50160, 78.35670, '+919999010027'),
  ('begumpet', 'sample-dr-rao-family-clinic-begumpet', 'Sample Dr Rao Family Clinic Begumpet', 17.44260, 78.47100, '+919999010028'),
  ('lb-nagar', 'sample-dr-rao-family-clinic-lb-nagar', 'Sample Dr Rao Family Clinic Lb Nagar', 17.34800, 78.55090, '+919999010029')
) AS v(locality_slug, slug, name, lat, lng, phone)
JOIN dbo.localities lo ON lo.slug = v.locality_slug
JOIN dbo.businesses b ON b.name = v.name
WHERE NOT EXISTS (SELECT 1 FROM dbo.listings li WHERE li.locality_id = lo.id AND li.slug = v.slug);
GO

INSERT INTO dbo.listing_categories (listing_id, category_id, is_primary)
SELECT li.id, c.id, 1
FROM (VALUES
('gachibowli', 'sample-sri-sai-plumbers-gachibowli', 'plumbers'),
  ('madhapur', 'sample-sri-sai-plumbers-madhapur', 'plumbers'),
  ('kukatpally', 'sample-sri-sai-plumbers-kukatpally', 'plumbers'),
  ('secunderabad', 'sample-sri-sai-plumbers-secunderabad', 'plumbers'),
  ('madhapur', 'sample-bright-spark-electricals-madhapur', 'electricians'),
  ('kondapur', 'sample-bright-spark-electricals-kondapur', 'electricians'),
  ('ameerpet', 'sample-bright-spark-electricals-ameerpet', 'electricians'),
  ('banjara-hills', 'sample-smile-care-dental-clinic-banjara-hills', 'dentists'),
  ('gachibowli', 'sample-smile-care-dental-clinic-gachibowli', 'dentists'),
  ('kukatpally', 'sample-smile-care-dental-clinic-kukatpally', 'dentists'),
  ('banjara-hills', 'sample-nawab-biryani-house-banjara-hills', 'biryani-restaurants'),
  ('charminar', 'sample-nawab-biryani-house-charminar', 'biryani-restaurants'),
  ('madhapur', 'sample-nawab-biryani-house-madhapur', 'biryani-restaurants'),
  ('jubilee-hills', 'sample-glow-beauty-parlour-jubilee-hills', 'beauty-salons'),
  ('kondapur', 'sample-glow-beauty-parlour-kondapur', 'beauty-salons'),
  ('gachibowli', 'sample-iron-peak-fitness-gachibowli', 'gyms'),
  ('uppal', 'sample-iron-peak-fitness-uppal', 'gyms'),
  ('kukatpally', 'sample-cool-breeze-ac-service-kukatpally', 'ac-repair-and-service'),
  ('dilsukhnagar', 'sample-cool-breeze-ac-service-dilsukhnagar', 'ac-repair-and-service'),
  ('mehdipatnam', 'sample-safe-move-packers-mehdipatnam', 'packers-and-movers'),
  ('secunderabad', 'sample-safe-move-packers-secunderabad', 'packers-and-movers'),
  ('ameerpet', 'sample-bright-minds-tuitions-ameerpet', 'home-tutors'),
  ('kukatpally', 'sample-bright-minds-tuitions-kukatpally', 'home-tutors'),
  ('jubilee-hills', 'sample-brew-and-bites-cafe-jubilee-hills', 'cafes'),
  ('madhapur', 'sample-brew-and-bites-cafe-madhapur', 'cafes'),
  ('uppal', 'sample-turbo-auto-garage-uppal', 'car-repair-and-service'),
  ('miyapur', 'sample-turbo-auto-garage-miyapur', 'car-repair-and-service'),
  ('begumpet', 'sample-dr-rao-family-clinic-begumpet', 'general-physicians'),
  ('lb-nagar', 'sample-dr-rao-family-clinic-lb-nagar', 'general-physicians')
) AS v(locality_slug, listing_slug, category_slug)
JOIN dbo.localities lo ON lo.slug = v.locality_slug
JOIN dbo.listings li ON li.locality_id = lo.id AND li.slug = v.listing_slug
JOIN dbo.categories c ON c.slug = v.category_slug
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.listing_categories lc WHERE lc.listing_id = li.id AND lc.category_id = c.id
);
GO

-- One sample listing carries a WhatsApp number and a website, so the optional rows on the listing
-- detail page and the WhatsApp button on the result cards can actually be seen while developing.
-- Without this every sample listing has only a phone number, and those branches never render.
-- example.com is reserved for documentation, so this points at nobody's real site.
UPDATE li
SET phone_whatsapp = '+919999010025',
    website_url = 'https://example.com/sample-brew-and-bites'
FROM dbo.listings li
JOIN dbo.localities lo ON lo.id = li.locality_id
WHERE lo.slug = 'madhapur'
  AND li.slug = 'sample-brew-and-bites-cafe-madhapur';
GO
