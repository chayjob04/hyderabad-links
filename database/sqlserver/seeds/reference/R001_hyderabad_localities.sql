-- Reference seed: Hyderabad and its localities. Idempotent (safe to run on every deploy).
-- Coordinates are APPROXIMATE centre points. Verify against the chosen maps provider before relying
-- on them for ranking. Existing rows are never overwritten, so manual edits made later are kept.
--
-- The SQL Server counterpart of database/seeds/reference/R001_hyderabad_localities.sql. PostgreSQL
-- said "insert unless it is there" with ON CONFLICT DO NOTHING; SQL Server has no such clause, so
-- each insert carries a NOT EXISTS instead.
--
-- geography::Point takes LATITUDE first, where PostGIS's ST_MakePoint took longitude first. The
-- VALUES rows below are unchanged, and the constructor reads them in the order that is right here.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

INSERT INTO dbo.cities (slug, name, state, center)
SELECT 'hyderabad', 'Hyderabad', 'Telangana', geography::Point(17.3850, 78.4867, 4326)
WHERE NOT EXISTS (SELECT 1 FROM dbo.cities WHERE slug = 'hyderabad');
GO

INSERT INTO dbo.localities (city_id, slug, name, center)
SELECT c.id, v.slug, v.name, geography::Point(v.lat, v.lng, 4326)
FROM (VALUES
('gachibowli', 'Gachibowli', 17.4401, 78.3489),
  ('madhapur', 'Madhapur', 17.4486, 78.3908),
  ('hitec-city', 'HITEC City', 17.4435, 78.3772),
  ('kondapur', 'Kondapur', 17.46, 78.365),
  ('financial-district', 'Financial District', 17.418, 78.341),
  ('nanakramguda', 'Nanakramguda', 17.417, 78.342),
  ('kokapet', 'Kokapet', 17.396, 78.335),
  ('manikonda', 'Manikonda', 17.401, 78.383),
  ('narsingi', 'Narsingi', 17.392, 78.364),
  ('khajaguda', 'Khajaguda', 17.417, 78.368),
  ('raidurg', 'Raidurg', 17.426, 78.379),
  ('puppalaguda', 'Puppalaguda', 17.393, 78.37),
  ('tellapur', 'Tellapur', 17.454, 78.287),
  ('gopanpally', 'Gopanpally', 17.462, 78.317),
  ('lingampally', 'Lingampally', 17.4934, 78.3167),
  ('chandanagar', 'Chandanagar', 17.493, 78.328),
  ('miyapur', 'Miyapur', 17.4967, 78.3586),
  ('madinaguda', 'Madinaguda', 17.495, 78.35),
  ('hafeezpet', 'Hafeezpet', 17.485, 78.355),
  ('kothaguda', 'Kothaguda', 17.463, 78.379),
  ('kukatpally', 'Kukatpally', 17.4948, 78.3996),
  ('kphb-colony', 'KPHB Colony', 17.4933, 78.3915),
  ('nizampet', 'Nizampet', 17.516, 78.383),
  ('pragathi-nagar', 'Pragathi Nagar', 17.517, 78.389),
  ('bachupally', 'Bachupally', 17.544, 78.364),
  ('bollaram', 'Bollaram', 17.543, 78.359),
  ('beeramguda', 'Beeramguda', 17.52, 78.304),
  ('patancheru', 'Patancheru', 17.53, 78.265),
  ('jubilee-hills', 'Jubilee Hills', 17.4326, 78.4071),
  ('banjara-hills', 'Banjara Hills', 17.4156, 78.4347),
  ('film-nagar', 'Film Nagar', 17.413, 78.41),
  ('shaikpet', 'Shaikpet', 17.406, 78.404),
  ('yousufguda', 'Yousufguda', 17.435, 78.425),
  ('ameerpet', 'Ameerpet', 17.4375, 78.4483),
  ('sr-nagar', 'SR Nagar', 17.441, 78.444),
  ('erragadda', 'Erragadda', 17.456, 78.435),
  ('moosapet', 'Moosapet', 17.464, 78.426),
  ('borabanda', 'Borabanda', 17.45, 78.418),
  ('sanath-nagar', 'Sanath Nagar', 17.458, 78.44),
  ('balanagar', 'Balanagar', 17.477, 78.443),
  ('begumpet', 'Begumpet', 17.444, 78.4676),
  ('punjagutta', 'Punjagutta', 17.4285, 78.4519),
  ('somajiguda', 'Somajiguda', 17.4239, 78.4586),
  ('khairatabad', 'Khairatabad', 17.412, 78.46),
  ('masab-tank', 'Masab Tank', 17.4, 78.453),
  ('lakdikapul', 'Lakdikapul', 17.4, 78.464),
  ('himayatnagar', 'Himayatnagar', 17.406, 78.483),
  ('basheerbagh', 'Basheerbagh', 17.399, 78.475),
  ('nampally', 'Nampally', 17.391, 78.47),
  ('abids', 'Abids', 17.392, 78.474),
  ('koti', 'Koti', 17.385, 78.484),
  ('musheerabad', 'Musheerabad', 17.409, 78.493),
  ('secunderabad', 'Secunderabad', 17.4399, 78.4983),
  ('bowenpally', 'Bowenpally', 17.472, 78.472),
  ('trimulgherry', 'Trimulgherry', 17.48, 78.5),
  ('alwal', 'Alwal', 17.5, 78.51),
  ('bolarum', 'Bolarum', 17.53, 78.51),
  ('jeedimetla', 'Jeedimetla', 17.511, 78.439),
  ('quthbullapur', 'Quthbullapur', 17.519, 78.46),
  ('kompally', 'Kompally', 17.54, 78.486),
  ('medchal', 'Medchal', 17.63, 78.481),
  ('malkajgiri', 'Malkajgiri', 17.45, 78.526),
  ('sainikpuri', 'Sainikpuri', 17.497, 78.552),
  ('ecil', 'ECIL', 17.47, 78.571),
  ('kushaiguda', 'Kushaiguda', 17.49, 78.56),
  ('nagaram', 'Nagaram', 17.497, 78.589),
  ('mallapur', 'Mallapur', 17.457, 78.578),
  ('tarnaka', 'Tarnaka', 17.426, 78.533),
  ('habsiguda', 'Habsiguda', 17.415, 78.54),
  ('nacharam', 'Nacharam', 17.429, 78.556),
  ('uppal', 'Uppal', 17.405, 78.559),
  ('ramanthapur', 'Ramanthapur', 17.399, 78.538),
  ('amberpet', 'Amberpet', 17.399, 78.517),
  ('boduppal', 'Boduppal', 17.41, 78.59),
  ('peerzadiguda', 'Peerzadiguda', 17.4, 78.59),
  ('pocharam', 'Pocharam', 17.44, 78.62),
  ('ghatkesar', 'Ghatkesar', 17.45, 78.68),
  ('nagole', 'Nagole', 17.368, 78.56),
  ('mansoorabad', 'Mansoorabad', 17.355, 78.556),
  ('lb-nagar', 'LB Nagar', 17.3457, 78.5522),
  ('kothapet', 'Kothapet', 17.368, 78.542),
  ('chaitanyapuri', 'Chaitanyapuri', 17.372, 78.538),
  ('dilsukhnagar', 'Dilsukhnagar', 17.3688, 78.5247),
  ('saroornagar', 'Saroornagar', 17.356, 78.52),
  ('saidabad', 'Saidabad', 17.36, 78.51),
  ('malakpet', 'Malakpet', 17.375, 78.5),
  ('champapet', 'Champapet', 17.34, 78.51),
  ('vanasthalipuram', 'Vanasthalipuram', 17.33, 78.569),
  ('hayathnagar', 'Hayathnagar', 17.328, 78.603),
  ('bandlaguda', 'Bandlaguda', 17.32, 78.52),
  ('charminar', 'Charminar', 17.3616, 78.4747),
  ('yakutpura', 'Yakutpura', 17.37, 78.485),
  ('falaknuma', 'Falaknuma', 17.332, 78.468),
  ('bahadurpura', 'Bahadurpura', 17.35, 78.45),
  ('mehdipatnam', 'Mehdipatnam', 17.395, 78.435),
  ('tolichowki', 'Tolichowki', 17.4, 78.416),
  ('langar-houz', 'Langar Houz', 17.382, 78.43),
  ('golconda', 'Golconda', 17.3833, 78.4011),
  ('attapur', 'Attapur', 17.368, 78.426),
  ('rajendranagar', 'Rajendranagar', 17.317, 78.402),
  ('gandipet', 'Gandipet', 17.387, 78.318),
  ('moinabad', 'Moinabad', 17.305, 78.338),
  ('shamshabad', 'Shamshabad', 17.26, 78.39)
) AS v(slug, name, lat, lng)
CROSS JOIN dbo.cities c
WHERE c.slug = 'hyderabad'
  AND NOT EXISTS (SELECT 1 FROM dbo.localities l WHERE l.city_id = c.id AND l.slug = v.slug);
GO
