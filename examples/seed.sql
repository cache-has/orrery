-- Orrery example dashboards — seed data
-- Creates all tables and populates them with realistic sample data.
-- Run: psql -d orrery_examples -f examples/seed.sql

BEGIN;

-- ============================================================================
-- ECOMMERCE: orders, customers, products
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  region VARCHAR(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  sku VARCHAR(20) UNIQUE NOT NULL,
  unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  product_id INTEGER REFERENCES products(id),
  amount NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  region VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  fulfillment_warehouse VARCHAR(50),
  shipped_at TIMESTAMP
);

-- Customers
INSERT INTO customers (name, region)
SELECT
  'Customer ' || i,
  (ARRAY['US','EU','APAC','LATAM'])[1 + (i % 4)]
FROM generate_series(1, 500) i;

-- Products
INSERT INTO products (name, category, sku, unit_cost)
SELECT
  'Product ' || i,
  (ARRAY['Electronics','Apparel','Food & Beverage','Industrial','Pharmaceuticals'])[1 + (i % 5)],
  'SKU-' || LPAD(i::text, 5, '0'),
  (10 + random() * 490)::numeric(10,2)
FROM generate_series(1, 200) i;

-- Orders (last 120 days, ~50/day)
INSERT INTO orders (customer_id, product_id, amount, status, region, created_at, order_date, fulfillment_warehouse, shipped_at)
SELECT
  1 + (random() * 499)::int,
  1 + (random() * 199)::int,
  (5 + random() * 500)::numeric(10,2),
  (ARRAY['completed','completed','completed','completed','processing','shipped','backordered'])[1 + (random() * 6)::int],
  (ARRAY['US','EU','APAC','LATAM'])[1 + (random() * 3)::int],
  ts,
  ts::date,
  (ARRAY['Warehouse East','Warehouse West','Warehouse Central','Warehouse EU'])[1 + (random() * 3)::int],
  CASE WHEN random() > 0.2 THEN ts + (random() * 48 || ' hours')::interval ELSE NULL END
FROM (
  SELECT NOW() - (random() * 120 || ' days')::interval AS ts
  FROM generate_series(1, 6000)
) sub;

-- ============================================================================
-- SAAS: subscriptions, users
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(200) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  monthly_amount NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL,
  plan_name VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  canceled_at TIMESTAMP,
  trial_started_at TIMESTAMP
);

INSERT INTO users (email, created_at)
SELECT
  'user' || i || '@example.com',
  NOW() - (random() * 730 || ' days')::interval
FROM generate_series(1, 2000) i;

INSERT INTO subscriptions (user_id, monthly_amount, status, plan_name, created_at, canceled_at, trial_started_at)
SELECT
  u.id,
  CASE plan_name
    WHEN 'Starter' THEN 29
    WHEN 'Pro' THEN 99
    WHEN 'Enterprise' THEN 499
  END,
  CASE WHEN random() > 0.15 THEN 'active' ELSE 'canceled' END,
  plan_name,
  u.created_at + (random() * 30 || ' days')::interval,
  CASE WHEN random() > 0.85 THEN u.created_at + (random() * 365 || ' days')::interval ELSE NULL END,
  u.created_at - INTERVAL '14 days'
FROM users u
CROSS JOIN LATERAL (
  SELECT (ARRAY['Starter','Starter','Pro','Pro','Pro','Enterprise'])[1 + (u.id % 6)] AS plan_name
) p;

-- ============================================================================
-- INFRASTRUCTURE: request_logs
-- ============================================================================

CREATE TABLE IF NOT EXISTS request_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  service_name VARCHAR(50) NOT NULL,
  endpoint VARCHAR(200) NOT NULL,
  status_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL
);

INSERT INTO request_logs (timestamp, service_name, endpoint, status_code, duration_ms)
SELECT
  NOW() - (random() * 7 || ' days')::interval,
  (ARRAY['api-gateway','auth-service','payments','user-service','search','notifications'])[1 + (random() * 5)::int],
  (ARRAY['/api/v1/users','/api/v1/orders','/api/v1/products','/api/v1/search','/api/v1/auth/login','/api/v1/auth/token','/api/v1/payments','/api/v1/webhooks','/healthz'])[1 + (random() * 8)::int],
  CASE
    WHEN random() < 0.85 THEN 200
    WHEN random() < 0.90 THEN 201
    WHEN random() < 0.93 THEN 301
    WHEN random() < 0.96 THEN 400
    WHEN random() < 0.98 THEN 404
    WHEN random() < 0.99 THEN 429
    ELSE 500 + (random() * 3)::int
  END,
  GREATEST(1, (5 + random() * 200 + (CASE WHEN random() > 0.95 THEN random() * 2000 ELSE 0 END))::int)
FROM generate_series(1, 50000);

-- ============================================================================
-- MARKETING: campaigns, ad_spend, conversions, attribution_events
-- ============================================================================

CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  channel VARCHAR(30) NOT NULL,
  campaign_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS ad_spend (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER REFERENCES campaigns(campaign_id),
  date DATE NOT NULL,
  spend NUMERIC(10,2) NOT NULL,
  impressions INTEGER NOT NULL,
  clicks INTEGER NOT NULL,
  channel VARCHAR(30),
  campaign_type VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS conversions (
  conversion_id SERIAL PRIMARY KEY,
  campaign_id INTEGER REFERENCES campaigns(campaign_id),
  converted_at TIMESTAMP NOT NULL,
  event_type VARCHAR(20) NOT NULL,
  revenue NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS attribution_events (
  id SERIAL PRIMARY KEY,
  conversion_id INTEGER REFERENCES conversions(conversion_id),
  first_touch_campaign_id INTEGER REFERENCES campaigns(campaign_id),
  last_touch_campaign_id INTEGER REFERENCES campaigns(campaign_id),
  event_type VARCHAR(20) NOT NULL,
  first_touch_at TIMESTAMP NOT NULL
);

INSERT INTO campaigns (name, channel, campaign_type, status)
SELECT
  ch || ' - ' || ct || ' #' || i,
  ch,
  ct,
  CASE WHEN random() > 0.1 THEN 'active' ELSE 'paused' END
FROM generate_series(1, 5) i
CROSS JOIN (VALUES ('Google Ads'),('Meta Ads'),('LinkedIn'),('TikTok'),('Email'),('Organic Search')) AS channels(ch)
CROSS JOIN (VALUES ('Brand'),('Performance'),('Retargeting'),('Awareness')) AS types(ct);

INSERT INTO ad_spend (campaign_id, date, spend, impressions, clicks, channel, campaign_type)
SELECT
  c.campaign_id,
  d::date,
  (50 + random() * 500)::numeric(10,2),
  (1000 + random() * 50000)::int,
  (10 + random() * 2000)::int,
  c.channel,
  c.campaign_type
FROM campaigns c
CROSS JOIN generate_series(CURRENT_DATE - 90, CURRENT_DATE, '1 day') d
WHERE random() > 0.1;

INSERT INTO conversions (campaign_id, converted_at, event_type, revenue)
SELECT
  a.campaign_id,
  a.date + (random() * 24 || ' hours')::interval,
  (ARRAY['lead','purchase','purchase'])[1 + (random() * 2)::int],
  CASE WHEN random() > 0.4 THEN (20 + random() * 500)::numeric(10,2) ELSE NULL END
FROM ad_spend a
WHERE random() < 0.08;

INSERT INTO attribution_events (conversion_id, first_touch_campaign_id, last_touch_campaign_id, event_type, first_touch_at)
SELECT
  cv.conversion_id,
  cv.campaign_id,
  CASE WHEN random() > 0.5 THEN cv.campaign_id ELSE (SELECT campaign_id FROM campaigns ORDER BY random() LIMIT 1) END,
  cv.event_type,
  cv.converted_at - (random() * 168 || ' hours')::interval
FROM conversions cv;

-- ============================================================================
-- SUPPLY CHAIN: warehouses, carriers, suppliers, inventory, shipments,
--               order_lines, purchase_orders
-- ============================================================================

CREATE TABLE IF NOT EXISTS warehouses (
  warehouse_id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS carriers (
  carrier_id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(20) REFERENCES products(sku),
  warehouse_id INTEGER REFERENCES warehouses(warehouse_id),
  quantity_on_hand INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 10,
  days_since_last_movement INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shipments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER,
  carrier_id INTEGER REFERENCES carriers(carrier_id),
  origin_warehouse VARCHAR(50),
  shipped_at TIMESTAMP,
  delivered_at TIMESTAMP,
  estimated_delivery TIMESTAMP,
  shipping_cost NUMERIC(10,2),
  status VARCHAR(20) NOT NULL DEFAULT 'delivered'
);

CREATE TABLE IF NOT EXISTS order_lines (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  sku VARCHAR(20) REFERENCES products(sku),
  quantity INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER REFERENCES suppliers(supplier_id),
  actual_lead_days INTEGER NOT NULL,
  quoted_lead_days INTEGER NOT NULL,
  quality_status VARCHAR(20) NOT NULL DEFAULT 'accepted',
  total_cost NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO warehouses (name) VALUES
  ('Warehouse East'),('Warehouse West'),('Warehouse Central'),('Warehouse EU');

INSERT INTO carriers (name) VALUES
  ('FedEx'),('UPS'),('DHL'),('USPS'),('Amazon Logistics');

INSERT INTO suppliers (name) VALUES
  ('Acme Components'),('GlobalParts Inc'),('Pacific Supply Co'),('EuroSource GmbH'),
  ('TechDirect Ltd'),('PrimeMaterials'),('Atlas Logistics'),('NovaChem');

INSERT INTO inventory (sku, warehouse_id, quantity_on_hand, reorder_point, days_since_last_movement)
SELECT
  p.sku,
  w.warehouse_id,
  (random() * 500)::int,
  (5 + random() * 50)::int,
  (random() * 60)::int
FROM products p
CROSS JOIN warehouses w
WHERE random() > 0.3;

INSERT INTO shipments (order_id, carrier_id, origin_warehouse, shipped_at, delivered_at, estimated_delivery, shipping_cost, status)
SELECT
  o.id,
  1 + (random() * 4)::int,
  o.fulfillment_warehouse,
  o.shipped_at,
  CASE WHEN random() > 0.05
    THEN o.shipped_at + ((1 + random() * 5) || ' days')::interval
    ELSE NULL
  END,
  o.shipped_at + ((2 + random() * 5) || ' days')::interval,
  (5 + random() * 50)::numeric(10,2),
  CASE
    WHEN random() > 0.98 THEN 'damaged'
    WHEN random() > 0.95 THEN 'in_transit'
    ELSE 'delivered'
  END
FROM orders o
WHERE o.shipped_at IS NOT NULL;

INSERT INTO order_lines (order_id, sku, quantity)
SELECT
  o.id,
  (SELECT sku FROM products ORDER BY random() LIMIT 1),
  1 + (random() * 5)::int
FROM orders o;

INSERT INTO purchase_orders (supplier_id, actual_lead_days, quoted_lead_days, quality_status, total_cost, created_at)
SELECT
  1 + (random() * 7)::int,
  (3 + random() * 25)::int,
  (5 + random() * 15)::int,
  (ARRAY['accepted','accepted','accepted','accepted','rejected'])[1 + (random() * 4)::int],
  (500 + random() * 20000)::numeric(10,2),
  NOW() - (random() * 90 || ' days')::interval
FROM generate_series(1, 400);

-- ============================================================================
-- FINANCIAL: accounts, positions, prices, benchmarks, trades
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounts (
  account_id SERIAL PRIMARY KEY,
  account_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(account_id),
  ticker VARCHAR(10) NOT NULL,
  name VARCHAR(100) NOT NULL,
  quantity NUMERIC(12,4) NOT NULL,
  avg_cost_basis NUMERIC(10,2) NOT NULL,
  asset_class VARCHAR(30) NOT NULL,
  sector VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS prices (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10) NOT NULL,
  price_date DATE NOT NULL,
  close_price NUMERIC(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmarks (
  id SERIAL PRIMARY KEY,
  benchmark_name VARCHAR(50) NOT NULL,
  price_date DATE NOT NULL,
  close_price NUMERIC(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(account_id),
  ticker VARCHAR(10) NOT NULL,
  side VARCHAR(10) NOT NULL,
  quantity NUMERIC(12,4) NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  asset_class VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'filled',
  trade_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO accounts (account_name, status) VALUES
  ('Growth Portfolio', 'active'),
  ('Income Portfolio', 'active'),
  ('Retirement 401k', 'active'),
  ('Crypto Wallet', 'active');

-- Tickers with sectors
WITH tickers(ticker, name, asset_class, sector, base_price) AS (VALUES
  ('AAPL','Apple Inc','Equities','Technology',185),
  ('MSFT','Microsoft Corp','Equities','Technology',420),
  ('GOOGL','Alphabet Inc','Equities','Technology',175),
  ('AMZN','Amazon.com Inc','Equities','Consumer Discretionary',185),
  ('NVDA','NVIDIA Corp','Equities','Technology',880),
  ('JPM','JPMorgan Chase','Equities','Financials',195),
  ('JNJ','Johnson & Johnson','Equities','Healthcare',155),
  ('XOM','Exxon Mobil','Equities','Energy',105),
  ('PG','Procter & Gamble','Equities','Consumer Staples',165),
  ('V','Visa Inc','Equities','Financials',280),
  ('UNH','UnitedHealth','Equities','Healthcare',520),
  ('HD','Home Depot','Equities','Consumer Discretionary',380),
  ('BND','Vanguard Bond ETF','Fixed Income',NULL,72),
  ('AGG','iShares Agg Bond','Fixed Income',NULL,98),
  ('TLT','iShares 20+ Yr','Fixed Income',NULL,92),
  ('GLD','SPDR Gold Trust','Commodities',NULL,215),
  ('SLV','iShares Silver','Commodities',NULL,23),
  ('VNQ','Vanguard Real Estate','Real Estate',NULL,82),
  ('BTC','Bitcoin','Crypto',NULL,67000),
  ('ETH','Ethereum','Crypto',NULL,3400)
)
INSERT INTO positions (account_id, ticker, name, quantity, avg_cost_basis, asset_class, sector)
SELECT
  a.account_id,
  t.ticker,
  t.name,
  CASE
    WHEN t.base_price > 10000 THEN (0.1 + random() * 2)::numeric(12,4)
    WHEN t.base_price > 500 THEN (5 + random() * 50)::numeric(12,4)
    ELSE (10 + random() * 200)::numeric(12,4)
  END,
  (t.base_price * (0.85 + random() * 0.3))::numeric(10,2),
  t.asset_class,
  t.sector
FROM accounts a
CROSS JOIN tickers t
WHERE random() > 0.4;

-- Daily prices for last 180 days
WITH tickers(ticker, base_price) AS (VALUES
  ('AAPL',185),('MSFT',420),('GOOGL',175),('AMZN',185),('NVDA',880),
  ('JPM',195),('JNJ',155),('XOM',105),('PG',165),('V',280),
  ('UNH',520),('HD',380),('BND',72),('AGG',98),('TLT',92),
  ('GLD',215),('SLV',23),('VNQ',82),('BTC',67000),('ETH',3400)
)
INSERT INTO prices (ticker, price_date, close_price)
SELECT
  t.ticker,
  d::date,
  -- Random walk from base price
  (t.base_price * (1 + 0.001 * (random() - 0.48) * (CURRENT_DATE - d::date)))::numeric(10,2)
FROM tickers t
CROSS JOIN generate_series(CURRENT_DATE - 180, CURRENT_DATE, '1 day') d
WHERE EXTRACT(DOW FROM d) NOT IN (0, 6); -- weekdays only

-- Benchmarks
INSERT INTO benchmarks (benchmark_name, price_date, close_price)
SELECT bm, d::date,
  CASE bm
    WHEN 'S&P 500' THEN (5200 * (1 + 0.0005 * (random() - 0.45) * (CURRENT_DATE - d::date)))::numeric(10,2)
    WHEN 'MSCI World' THEN (3500 * (1 + 0.0004 * (random() - 0.45) * (CURRENT_DATE - d::date)))::numeric(10,2)
    WHEN 'Bloomberg Agg' THEN (100 * (1 + 0.0001 * (random() - 0.48) * (CURRENT_DATE - d::date)))::numeric(10,2)
    WHEN '60/40 Blend' THEN (1000 * (1 + 0.0003 * (random() - 0.46) * (CURRENT_DATE - d::date)))::numeric(10,2)
  END
FROM (VALUES ('S&P 500'),('MSCI World'),('Bloomberg Agg'),('60/40 Blend')) AS bms(bm)
CROSS JOIN generate_series(CURRENT_DATE - 180, CURRENT_DATE, '1 day') d
WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);

-- Trades
INSERT INTO trades (account_id, ticker, side, quantity, price, asset_class, status, trade_date, created_at)
SELECT
  p.account_id,
  p.ticker,
  (ARRAY['Buy','Buy','Buy','Sell'])[1 + (random() * 3)::int],
  (1 + random() * 20)::numeric(12,4),
  pr.close_price,
  p.asset_class,
  'filled',
  pr.price_date,
  pr.price_date::timestamp + (random() * 8 || ' hours')::interval
FROM positions p
JOIN prices pr ON p.ticker = pr.ticker
WHERE random() < 0.02;

-- ============================================================================
-- HR: departments, employees, engagement_surveys, performance_reviews
-- ============================================================================

CREATE TABLE IF NOT EXISTS departments (
  department_id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS employees (
  employee_id SERIAL PRIMARY KEY,
  department_id INTEGER REFERENCES departments(department_id),
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  title VARCHAR(100) NOT NULL,
  level VARCHAR(20) NOT NULL,
  location VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  hire_date DATE NOT NULL,
  termination_date DATE,
  termination_reason VARCHAR(50),
  base_salary NUMERIC(10,2) NOT NULL,
  bonus_target NUMERIC(10,2),
  equity_value NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS engagement_surveys (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(employee_id),
  survey_date DATE NOT NULL,
  overall_score NUMERIC(3,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS performance_reviews (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(employee_id),
  rating VARCHAR(30) NOT NULL,
  review_cycle VARCHAR(20) NOT NULL
);

INSERT INTO departments (name) VALUES
  ('Engineering'),('Product'),('Design'),('Marketing'),('Sales'),
  ('Customer Success'),('Finance'),('People Ops'),('Legal'),('Data Science');

-- First names and last names
WITH first_names(n) AS (VALUES
  ('James'),('Mary'),('Robert'),('Patricia'),('John'),('Jennifer'),('Michael'),('Linda'),
  ('David'),('Elizabeth'),('William'),('Barbara'),('Richard'),('Susan'),('Joseph'),('Jessica'),
  ('Thomas'),('Sarah'),('Charles'),('Karen'),('Daniel'),('Lisa'),('Matthew'),('Nancy'),
  ('Anthony'),('Betty'),('Mark'),('Margaret'),('Donald'),('Sandra'),('Steven'),('Ashley'),
  ('Andrew'),('Kimberly'),('Paul'),('Emily'),('Joshua'),('Donna'),('Kenneth'),('Michelle'),
  ('Kevin'),('Carol'),('Brian'),('Amanda'),('George'),('Dorothy'),('Timothy'),('Melissa'),
  ('Wei'),('Aisha'),('Raj'),('Fatima'),('Hiroshi'),('Priya'),('Carlos'),('Yuki'),
  ('Olga'),('Ahmed'),('Sofia'),('Diego'),('Mei'),('Hassan'),('Ingrid'),('Lars')
),
last_names(n) AS (VALUES
  ('Smith'),('Johnson'),('Williams'),('Brown'),('Jones'),('Garcia'),('Miller'),('Davis'),
  ('Rodriguez'),('Martinez'),('Hernandez'),('Lopez'),('Wilson'),('Anderson'),('Thomas'),('Taylor'),
  ('Moore'),('Jackson'),('Martin'),('Lee'),('Thompson'),('White'),('Harris'),('Clark'),
  ('Chen'),('Kumar'),('Patel'),('Kim'),('Tanaka'),('Mueller'),('Johansson'),('Santos'),
  ('Okafor'),('Al-Rashid'),('Ivanova'),('Park'),('Nguyen'),('Dubois'),('Fernandez'),('Weber')
),
levels(lvl, base_sal) AS (VALUES
  ('IC1',70000),('IC1',75000),('IC2',95000),('IC2',100000),('IC3',130000),('IC3',135000),
  ('IC4',170000),('IC5',210000),('M1',150000),('M2',185000),('M3',220000),
  ('Director',250000),('VP',300000),('C-Suite',400000)
),
locations(loc) AS (VALUES
  ('New York'),('New York'),('San Francisco'),('San Francisco'),('London'),
  ('Berlin'),('Singapore'),('Sydney'),('Remote'),('Remote'),('Remote')
)
INSERT INTO employees (department_id, first_name, last_name, title, level, location, status, hire_date, termination_date, termination_reason, base_salary, bonus_target, equity_value)
SELECT
  1 + (rn % 10),
  fn.n,
  ln.n,
  lvl || ' ' || (ARRAY['Engineer','Analyst','Manager','Designer','Specialist','Lead','Architect'])[1 + (rn % 7)],
  lvl,
  (ARRAY['New York','New York','San Francisco','San Francisco','London','Berlin','Singapore','Sydney','Remote','Remote','Remote'])[1 + (rn % 11)],
  CASE WHEN rn % 8 > 0 THEN 'active' ELSE 'terminated' END,
  (CURRENT_DATE - (50 + (rn * 7) % 2500 || ' days')::interval)::date,
  NULL, NULL,
  (base_sal * (0.85 + (rn % 30) * 0.01))::numeric(10,2),
  CASE WHEN rn % 3 > 0 THEN (base_sal * 0.15)::numeric(10,2) ELSE NULL END,
  CASE WHEN rn % 5 > 0 THEN (base_sal * (0.2 + (rn % 10) * 0.05))::numeric(10,2) ELSE NULL END
FROM (
  SELECT
    fn.n, ln.n AS ln,
    ROW_NUMBER() OVER () as rn,
    (ARRAY['IC1','IC1','IC1','IC2','IC2','IC2','IC3','IC3','IC4','IC5','M1','M2','M3','Director','VP','C-Suite'])[1 + (ROW_NUMBER() OVER () % 16)] as lvl,
    (ARRAY[70000,70000,70000,95000,95000,95000,130000,130000,170000,210000,150000,185000,220000,250000,300000,400000])[1 + (ROW_NUMBER() OVER () % 16)] as base_sal
  FROM first_names fn
  CROSS JOIN last_names ln
) sub
WHERE rn % 4 = 0
LIMIT 800;

-- Set termination dates and reasons for terminated employees
UPDATE employees
SET
  termination_date = hire_date + ((random() * (CURRENT_DATE - hire_date)) || ' days')::interval,
  termination_reason = (ARRAY['Voluntary - New Opportunity','Voluntary - Relocation','Voluntary - Career Change','Involuntary - Performance','Involuntary - Restructuring','Retirement'])[1 + (random() * 5)::int]
WHERE status = 'terminated';

-- Engagement surveys (quarterly for last 2 years)
INSERT INTO engagement_surveys (employee_id, survey_date, overall_score)
SELECT
  e.employee_id,
  d::date,
  GREATEST(1, LEAST(5, (3.2 + (random() - 0.5) * 2)))::numeric(3,2)
FROM employees e
CROSS JOIN generate_series(CURRENT_DATE - INTERVAL '2 years', CURRENT_DATE, '3 months') d
WHERE e.status = 'active' AND random() > 0.1;

-- Performance reviews (annual)
INSERT INTO performance_reviews (employee_id, rating, review_cycle)
SELECT
  e.employee_id,
  (ARRAY['Exceeds Expectations','Meets Expectations','Meets Expectations','Meets Expectations','Needs Improvement','Outstanding'])[1 + (random() * 5)::int],
  cycle
FROM employees e
CROSS JOIN (VALUES ('2024'),('2025'),('2026')) AS cycles(cycle)
WHERE e.hire_date < (cycle || '-01-01')::date
  AND (e.termination_date IS NULL OR e.termination_date > (cycle || '-01-01')::date)
  AND random() > 0.05;

-- ============================================================================
-- IOT: zones, sensors, equipment, sensor_readings, sensor_alerts
-- ============================================================================

CREATE TABLE IF NOT EXISTS zones (
  zone_id SERIAL PRIMARY KEY,
  zone_name VARCHAR(50) NOT NULL,
  floor INTEGER NOT NULL,
  facility_id VARCHAR(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS equipment (
  equipment_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  facility_id VARCHAR(20) NOT NULL,
  uptime_pct NUMERIC(5,2) NOT NULL DEFAULT 99.0,
  last_uptime_check TIMESTAMP DEFAULT NOW(),
  last_downtime TIMESTAMP,
  installed_at TIMESTAMP NOT NULL,
  next_maintenance_date DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS sensors (
  sensor_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  sensor_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  facility_id VARCHAR(20) NOT NULL,
  zone_id INTEGER REFERENCES zones(zone_id),
  equipment_id INTEGER REFERENCES equipment(equipment_id),
  firmware_version VARCHAR(20) NOT NULL DEFAULT '2.1.0',
  last_reading_at TIMESTAMP,
  battery_pct INTEGER DEFAULT 100
);

CREATE TABLE IF NOT EXISTS sensor_readings (
  id SERIAL PRIMARY KEY,
  sensor_id INTEGER REFERENCES sensors(sensor_id),
  sensor_type VARCHAR(30) NOT NULL,
  facility_id VARCHAR(20) NOT NULL,
  zone_id INTEGER,
  value NUMERIC(10,2) NOT NULL,
  unit VARCHAR(20),
  recorded_at TIMESTAMP NOT NULL,
  is_anomaly BOOLEAN NOT NULL DEFAULT false,
  battery_pct INTEGER
);

CREATE TABLE IF NOT EXISTS sensor_alerts (
  id SERIAL PRIMARY KEY,
  sensor_id INTEGER REFERENCES sensors(sensor_id),
  facility_id VARCHAR(20) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  message VARCHAR(200) NOT NULL,
  triggered_at TIMESTAMP NOT NULL,
  resolved_at TIMESTAMP
);

-- Zones across 2 facilities
INSERT INTO zones (zone_name, floor, facility_id)
SELECT
  'Zone ' || z || '-' || f,
  f,
  'FAC-' || fac
FROM generate_series(1, 6) z
CROSS JOIN generate_series(1, 3) f
CROSS JOIN (VALUES (1),(2)) AS facs(fac);

-- Equipment
INSERT INTO equipment (name, status, facility_id, uptime_pct, last_uptime_check, last_downtime, installed_at, next_maintenance_date)
SELECT
  (ARRAY['HVAC Unit','Compressor','Generator','Conveyor Belt','Chiller','Pump Station'])[1 + (i % 6)] || ' #' || i,
  CASE WHEN random() > 0.08 THEN 'running' ELSE 'maintenance' END,
  'FAC-' || (1 + (i % 2)),
  (90 + random() * 10)::numeric(5,2),
  NOW() - (random() * 2 || ' hours')::interval,
  NOW() - (random() * 30 || ' days')::interval,
  NOW() - (random() * 1000 || ' days')::interval,
  (CURRENT_DATE + (random() * 90 || ' days')::interval)::date
FROM generate_series(1, 20) i;

-- Sensors
INSERT INTO sensors (name, sensor_type, status, facility_id, zone_id, equipment_id, firmware_version, last_reading_at, battery_pct)
SELECT
  st || '-' || z.zone_id || '-' || i,
  st,
  CASE WHEN random() > 0.05 THEN 'active' ELSE 'offline' END,
  z.facility_id,
  z.zone_id,
  CASE WHEN st IN ('power','vibration') THEN (SELECT equipment_id FROM equipment WHERE facility_id = z.facility_id ORDER BY random() LIMIT 1) ELSE NULL END,
  (ARRAY['2.0.1','2.1.0','2.1.0','2.2.0','3.0.0-beta'])[1 + (random() * 4)::int],
  NOW() - (random() * 60 || ' minutes')::interval,
  GREATEST(5, (60 + random() * 40)::int)
FROM zones z
CROSS JOIN (VALUES ('temperature'),('humidity'),('air_quality'),('noise'),('power'),('vibration')) AS types(st)
CROSS JOIN generate_series(1, 2) i
WHERE random() > 0.2;

-- Sensor readings (last 48 hours, every ~5 min per sensor)
INSERT INTO sensor_readings (sensor_id, sensor_type, facility_id, zone_id, value, unit, recorded_at, is_anomaly, battery_pct)
SELECT
  s.sensor_id,
  s.sensor_type,
  s.facility_id,
  s.zone_id,
  CASE s.sensor_type
    WHEN 'temperature' THEN (18 + random() * 12)::numeric(10,2)
    WHEN 'humidity' THEN (30 + random() * 40)::numeric(10,2)
    WHEN 'air_quality' THEN (20 + random() * 120)::numeric(10,2)
    WHEN 'noise' THEN (30 + random() * 50)::numeric(10,2)
    WHEN 'power' THEN (5 + random() * 45)::numeric(10,2)
    WHEN 'vibration' THEN (0.1 + random() * 8)::numeric(10,2)
  END,
  CASE s.sensor_type
    WHEN 'temperature' THEN 'C'
    WHEN 'humidity' THEN '%'
    WHEN 'air_quality' THEN 'AQI'
    WHEN 'noise' THEN 'dB'
    WHEN 'power' THEN 'kW'
    WHEN 'vibration' THEN 'mm/s'
  END,
  ts,
  random() < 0.02,
  s.battery_pct
FROM sensors s
CROSS JOIN LATERAL (
  SELECT NOW() - (i * 5 || ' minutes')::interval AS ts
  FROM generate_series(0, 576) i  -- 48 hours * 12 per hour
) times
WHERE s.status = 'active' AND random() > 0.05;

-- Sensor alerts
INSERT INTO sensor_alerts (sensor_id, facility_id, severity, message, triggered_at, resolved_at)
SELECT
  s.sensor_id,
  s.facility_id,
  (ARRAY['warning','warning','warning','critical','info'])[1 + (random() * 4)::int],
  CASE s.sensor_type
    WHEN 'temperature' THEN 'Temperature exceeded threshold'
    WHEN 'humidity' THEN 'Humidity outside safe range'
    WHEN 'power' THEN 'Power consumption spike detected'
    WHEN 'vibration' THEN 'Abnormal vibration pattern'
    ELSE 'Sensor value out of range'
  END,
  triggered,
  CASE WHEN random() > 0.25 THEN triggered + (random() * 120 || ' minutes')::interval ELSE NULL END
FROM sensors s
CROSS JOIN generate_series(1, 3)
CROSS JOIN LATERAL (SELECT NOW() - (random() * 72 || ' hours')::interval AS triggered) t
WHERE random() < 0.3;

COMMIT;
