
CREATE TABLE IF NOT EXISTS seed_markers (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  brand varchar(120) NOT NULL DEFAULT 'AILUU.CLO',
  eyebrow varchar(200) NOT NULL DEFAULT '',
  headline varchar(300) NOT NULL DEFAULT '',
  subheadline varchar(700) NOT NULL DEFAULT '',
  announcement varchar(300) NOT NULL DEFAULT '',
  instagram varchar(500) NOT NULL DEFAULT '',
  whatsapp varchar(100) NOT NULL DEFAULT '',
  telegram varchar(200) NOT NULL DEFAULT '',
  currency varchar(20) NOT NULL DEFAULT 'сом',
  delivery_text varchar(1000) NOT NULL DEFAULT '',
  about_title varchar(300) NOT NULL DEFAULT '',
  about_text varchar(3000) NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  name varchar(160) NOT NULL CHECK (length(trim(name)) > 0),
  price integer NOT NULL CHECK (price >= 0),
  old_price integer NOT NULL DEFAULT 0 CHECK (old_price >= 0),
  category varchar(100) NOT NULL DEFAULT 'Коллекция',
  description varchar(3000) NOT NULL DEFAULT '',
  sizes text[] NOT NULL DEFAULT '{}',
  colors text[] NOT NULL DEFAULT '{}',
  image_url varchar(1000) NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  featured boolean NOT NULL DEFAULT false,
  stock_quantity integer CHECK (stock_quantity IS NULL OR stock_quantity >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_public_idx
  ON products (is_active, featured DESC, sort_order DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category) WHERE is_active = true;

CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1001;

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  order_number varchar(32) NOT NULL UNIQUE,
  customer_name varchar(160) NOT NULL,
  customer_phone varchar(60) NOT NULL,
  customer_address varchar(500) NOT NULL DEFAULT '',
  customer_comment varchar(1000) NOT NULL DEFAULT '',
  total integer NOT NULL CHECK (total >= 0),
  status varchar(30) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'confirmed', 'sent', 'completed', 'cancelled')),
  source varchar(30) NOT NULL DEFAULT 'website',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name varchar(160) NOT NULL,
  unit_price integer NOT NULL CHECK (unit_price >= 0),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  selected_size varchar(80) NOT NULL DEFAULT '',
  selected_color varchar(80) NOT NULL DEFAULT '',
  line_total integer NOT NULL CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

CREATE TABLE IF NOT EXISTS order_idempotency (
  idempotency_key varchar(64) PRIMARY KEY,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_idempotency_created_idx ON order_idempotency (created_at);

CREATE TABLE IF NOT EXISTS telegram_sessions (
  user_id bigint PRIMARY KEY,
  chat_id bigint NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_sessions_expiry_idx ON telegram_sessions (expires_at);

CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id bigint PRIMARY KEY,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type varchar(30) NOT NULL,
  actor_id varchar(120) NOT NULL DEFAULT '',
  action varchar(120) NOT NULL,
  entity_type varchar(60) NOT NULL DEFAULT '',
  entity_id varchar(120) NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS store_settings_updated_at ON store_settings;
CREATE TRIGGER store_settings_updated_at
BEFORE UPDATE ON store_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS orders_updated_at ON orders;
CREATE TRIGGER orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS telegram_sessions_updated_at ON telegram_sessions;
CREATE TRIGGER telegram_sessions_updated_at
BEFORE UPDATE ON telegram_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
