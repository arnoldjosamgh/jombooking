-- ============================================================
-- Jomish Booking and Delivering Management System — PostgreSQL Schema
-- Run this on your Neon PostgreSQL console to initialize the DB
-- ============================================================

-- Business type enum (safely create only if it doesn't exist)
DO $$ BEGIN
  CREATE TYPE business_type AS ENUM ('product', 'service');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Sellers (Admin/Tech and Business Owners)
CREATE TABLE IF NOT EXISTS sellers (
  id               SERIAL PRIMARY KEY,
  username         VARCHAR(100) UNIQUE NOT NULL, -- e.g., 'tech', 'jomish1'
  password_hash    TEXT, -- Can be null before setup
  name             VARCHAR(100),
  role             VARCHAR(20) DEFAULT 'owner' CHECK (role IN ('owner', 'tech')),
  setup_token      TEXT, -- For magic link
  webauthn_cred_id TEXT, -- Biometrics credential ID
  webauthn_pub_key TEXT, -- Biometrics public key
  webauthn_counter INT DEFAULT 0,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Businesses table (multi-tenant)
CREATE TABLE IF NOT EXISTS businesses (
  id                       SERIAL PRIMARY KEY,
  owner_id                 INT REFERENCES sellers(id) ON DELETE CASCADE,
  name                     VARCHAR(100) NOT NULL,
  type                     business_type NOT NULL,
  slug                     VARCHAR(50) UNIQUE NOT NULL,
  logo_url                 TEXT,
  open_time                TIME DEFAULT '09:00:00',
  close_time               TIME DEFAULT '18:00:00',
  open_days                INTEGER[] DEFAULT '{1,2,3,4,5,6}', -- 0=Sun,1=Mon,...,6=Sat
  session_duration_minutes INT DEFAULT 30,
  currency_symbol          VARCHAR(5) DEFAULT '$',
  pusher_channel           VARCHAR(100),
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Push Subscriptions (Web Push)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          SERIAL PRIMARY KEY,
  seller_id   INT REFERENCES sellers(id) ON DELETE CASCADE,
  endpoint    TEXT UNIQUE NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Clients (public, frictionless registration)
CREATE TABLE IF NOT EXISTS clients (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  location    TEXT NOT NULL,
  photo_url   TEXT,
  seller_note TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products inventory
CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  business_id    INT REFERENCES businesses(id) ON DELETE CASCADE,
  title          VARCHAR(100) NOT NULL,
  description    TEXT,
  price          DECIMAL(10,2) NOT NULL,
  image_url      TEXT,
  stock_quantity INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Orders (product flow)
CREATE TABLE IF NOT EXISTS orders (
  id          SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  client_id   INT REFERENCES clients(id) ON DELETE SET NULL,
  product_id  INT REFERENCES products(id) ON DELETE SET NULL,
  quantity    INT NOT NULL DEFAULT 1,
  status      VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bookings (service flow) — UNIQUE constraint prevents double-booking
CREATE TABLE IF NOT EXISTS bookings (
  id           SERIAL PRIMARY KEY,
  business_id  INT REFERENCES businesses(id) ON DELETE CASCADE,
  client_id    INT REFERENCES clients(id) ON DELETE SET NULL,
  booking_time TIMESTAMP NOT NULL,
  status       VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('confirmed','completed','cancelled')),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_slot UNIQUE (business_id, booking_time)
);

-- In-app messages (real-time chat)
CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  client_id   INT REFERENCES clients(id) ON DELETE CASCADE,
  sender      VARCHAR(10) NOT NULL CHECK (sender IN ('client', 'seller')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_business ON orders(business_id);
CREATE INDEX IF NOT EXISTS idx_orders_client   ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_bookings_business_time ON bookings(business_id, booking_time);
CREATE INDEX IF NOT EXISTS idx_messages_chat   ON messages(business_id, client_id);
CREATE INDEX IF NOT EXISTS idx_push_subs       ON push_subscriptions(seller_id);

-- ============================================================
-- Seed: Tech Admin and Demo business
-- ============================================================
-- Tech user (password is Jomish9!! -> hashed)
-- bcrypt hash of Jomish9!! is $2b$10$tZ2.K9wE3w2vQ1e.3D.eOu5I4Q9F7G4xH4F6t/mB6wTzU9X5J1Xm2
INSERT INTO sellers (username, password_hash, name, role)
VALUES ('tech', '$2b$10$tZ2.K9wE3w2vQ1e.3D.eOu5I4Q9F7G4xH4F6t/mB6wTzU9X5J1Xm2', 'Tech Admin', 'tech')
ON CONFLICT (username) DO NOTHING;

INSERT INTO sellers (username, password_hash, name, role)
VALUES ('demo_owner', '$2b$10$tZ2.K9wE3w2vQ1e.3D.eOu5I4Q9F7G4xH4F6t/mB6wTzU9X5J1Xm2', 'Demo Owner', 'owner')
ON CONFLICT (username) DO NOTHING;

INSERT INTO businesses (owner_id, name, type, slug, session_duration_minutes, currency_symbol, pusher_channel)
SELECT id, 'Jomish Café', 'product', 'jomish-cafe', 30, '$', 'jomish-cafe-channel' FROM sellers WHERE username = 'demo_owner'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO businesses (owner_id, name, type, slug, session_duration_minutes, currency_symbol, pusher_channel)
SELECT id, 'Jomish Salon', 'service', 'jomish-salon', 45, '$', 'jomish-salon-channel' FROM sellers WHERE username = 'demo_owner'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO products (business_id, title, description, price, stock_quantity)
SELECT id, 'Espresso', 'Rich double-shot espresso', 3.50, 50 FROM businesses WHERE slug = 'jomish-cafe'
ON CONFLICT DO NOTHING;

INSERT INTO products (business_id, title, description, price, stock_quantity)
SELECT id, 'Latte', 'Smooth milk-based coffee', 4.50, 40 FROM businesses WHERE slug = 'jomish-cafe'
ON CONFLICT DO NOTHING;

INSERT INTO products (business_id, title, description, price, stock_quantity)
SELECT id, 'Cappuccino', 'Classic Italian cappuccino', 4.00, 35 FROM businesses WHERE slug = 'jomish-cafe'
ON CONFLICT DO NOTHING;

INSERT INTO products (business_id, title, description, price, stock_quantity)
SELECT id, 'Croissant', 'Buttery French croissant', 2.50, 20 FROM businesses WHERE slug = 'jomish-cafe'
ON CONFLICT DO NOTHING;
