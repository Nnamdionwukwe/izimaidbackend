-- db/seed/reference-data-seed.sql
-- Reference data: supported currencies and languages

INSERT INTO supported_currencies
  (code, name, symbol, decimal_places, paystack_supported, stripe_supported, flutterwave_supported, is_active, sort_order)
VALUES
  ('NGN', 'Nigerian Naira',    '₦',  2, true,  false, true,  true, 1),
  ('USD', 'US Dollar',         '$',  2, false, true,  true,  true, 2),
  ('GBP', 'British Pound',     '£',  2, false, true,  true,  true, 3),
  ('EUR', 'Euro',              '€',  2, false, true,  true,  true, 4),
  ('KES', 'Kenyan Shilling',   'KSh',2, false, false, true,  true, 5),
  ('GHS', 'Ghanaian Cedi',     '₵',  2, false, false, true,  true, 6),
  ('ZAR', 'South African Rand','R',  2, false, false, true,  true, 7),
  ('CAD', 'Canadian Dollar',   'C$', 2, false, true,  false, true, 8),
  ('AUD', 'Australian Dollar', 'A$', 2, false, true,  false, true, 9)
ON CONFLICT (code) DO NOTHING;

INSERT INTO supported_languages
  (code, name, native_name, rtl, is_active, sort_order)
VALUES
  ('en', 'English',         'English',  false, true, 1),
  ('yo', 'Yoruba',          'Yorùbá',   false, true, 2),
  ('ig', 'Igbo',            'Igbo',     false, true, 3),
  ('ha', 'Hausa',           'Hausa',    false, true, 4),
  ('pcm','Nigerian Pidgin', 'Naijá',    false, true, 5),
  ('fr', 'French',          'Français', false, true, 6),
  ('ar', 'Arabic',          'العربية',   true,  true, 7)
ON CONFLICT (code) DO NOTHING;