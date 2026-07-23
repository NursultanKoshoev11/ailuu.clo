ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';

UPDATE products
SET image_urls = CASE
  WHEN cardinality(image_urls) > 0 THEN image_urls
  WHEN image_url <> '' THEN ARRAY[image_url]
  ELSE '{}'::text[]
END;

UPDATE products
SET
  sizes = ARRAY['80-90 см', '100-110 см', '120-130 см', '140-150 см'],
  colors = '{}'::text[];

UPDATE store_settings
SET subheadline = 'Лаконичные образы для девочек, выбирающих элегантность, комфорт и сдержанность.'
WHERE id = 1;

-- Старые незавершённые Telegram-сессии содержат прежние шаги с цветами.
DELETE FROM telegram_sessions;
