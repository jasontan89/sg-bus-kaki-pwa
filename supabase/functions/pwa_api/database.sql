-- Supabase PostgreSQL Migration for SG Bus Kaki PWA
-- Comprehensive Security Hardening with Row Level Security (RLS)

-- 1. Web Push Subscriptions Table
CREATE TABLE IF NOT EXISTS pwa_push_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    mrt_lines TEXT[] DEFAULT ARRAY[]::TEXT[],
    alert_filter TEXT DEFAULT 'major', -- 'major' or 'all'
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pwa_push_endpoint ON pwa_push_subscriptions(endpoint);

-- 2. Bus Arrival Countdown Alarms Table
CREATE TABLE IF NOT EXISTS pwa_bus_alarms (
    id BIGSERIAL PRIMARY KEY,
    endpoint TEXT NOT NULL REFERENCES pwa_push_subscriptions(endpoint) ON DELETE CASCADE,
    bus_stop_code VARCHAR(10) NOT NULL,
    bus_stop_name VARCHAR(120),
    service_no VARCHAR(10) NOT NULL,
    lead_mins INT NOT NULL DEFAULT 3,
    fired BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '45 minutes')
);

CREATE INDEX IF NOT EXISTS idx_pwa_alarms_active ON pwa_bus_alarms(fired, expires_at);

-- 3. Active Ride Alighting Alarms Table (Cloud Live-Bus GPS & Trajectory Tracking)
CREATE TABLE IF NOT EXISTS pwa_alight_alarms (
    id BIGSERIAL PRIMARY KEY,
    endpoint TEXT NOT NULL REFERENCES pwa_push_subscriptions(endpoint) ON DELETE CASCADE,
    target_stop_code VARCHAR(10) NOT NULL,
    target_stop_name VARCHAR(120),
    road_name VARCHAR(120),
    target_lat DOUBLE PRECISION NOT NULL,
    target_lon DOUBLE PRECISION NOT NULL,
    threshold_meters INT NOT NULL DEFAULT 500,
    tracking_mode VARCHAR(24) NOT NULL DEFAULT 'auto_detect', -- 'bus_locked', 'auto_detect', 'mrt', 'trajectory_eta'
    service_no VARCHAR(12),
    direction INT,
    boarding_stop_seq INT,
    tracked_stop_seq INT,
    target_stop_seq INT,
    stops_remaining INT,
    last_user_lat DOUBLE PRECISION,
    last_user_lon DOUBLE PRECISION,
    last_user_speed_mps DOUBLE PRECISION,
    last_user_sync_at TIMESTAMPTZ,
    estimated_distance_meters INT,
    candidate_services TEXT[] DEFAULT ARRAY[]::TEXT[],
    metadata JSONB DEFAULT '{}'::JSONB,
    pre_alert_fired BOOLEAN NOT NULL DEFAULT FALSE,
    fired BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '2 hours 30 minutes')
);

CREATE INDEX IF NOT EXISTS idx_pwa_alight_active ON pwa_alight_alarms(fired, expires_at);
CREATE INDEX IF NOT EXISTS idx_pwa_alight_endpoint ON pwa_alight_alarms(endpoint);

-- 4. MRT Alert State Tracking Table
CREATE TABLE IF NOT EXISTS pwa_mrt_alert_state (
    id INT PRIMARY KEY DEFAULT 1,
    last_status INT DEFAULT 1,
    last_affected JSONB DEFAULT '[]'::JSONB,
    last_message TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) HARDENING POLICIES
-- ====================================================================

-- Enable RLS on all PWA tables
ALTER TABLE pwa_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pwa_bus_alarms ENABLE ROW LEVEL SECURITY;
ALTER TABLE pwa_alight_alarms ENABLE ROW LEVEL SECURITY;
ALTER TABLE pwa_mrt_alert_state ENABLE ROW LEVEL SECURITY;

-- If bus stops and routes tables exist, enable RLS on them as well
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'lta_bus_stops') THEN
        ALTER TABLE lta_bus_stops ENABLE ROW LEVEL SECURITY;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'lta_bus_routes') THEN
        ALTER TABLE lta_bus_routes ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- 1. Public Read-Only Access for Transit Catalog (Bus stops & routes)
DROP POLICY IF EXISTS "Public read lta_bus_stops" ON lta_bus_stops;
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'lta_bus_stops') THEN
        CREATE POLICY "Public read lta_bus_stops" ON lta_bus_stops
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DROP POLICY IF EXISTS "Public read lta_bus_routes" ON lta_bus_routes;
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'lta_bus_routes') THEN
        CREATE POLICY "Public read lta_bus_routes" ON lta_bus_routes
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

-- 2. Public Read-Only Access for MRT Alert Status
DROP POLICY IF EXISTS "Public read pwa_mrt_alert_state" ON pwa_mrt_alert_state;
CREATE POLICY "Public read pwa_mrt_alert_state" ON pwa_mrt_alert_state
    FOR SELECT TO anon, authenticated USING (true);

-- 3. Strict Protection on Push Subscriptions, Bus Alarms & Alight Alarms
-- Direct public anonymous reads, writes, and deletions are strictly blocked via RLS.
-- All operations on these tables are mediated securely by the Supabase Edge Function (pwa_api)
-- using the backend service_role key, which bypasses RLS safely.

DROP POLICY IF EXISTS "No anon direct access to push subscriptions" ON pwa_push_subscriptions;
CREATE POLICY "No anon direct access to push subscriptions" ON pwa_push_subscriptions
    FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "No anon direct access to bus alarms" ON pwa_bus_alarms;
CREATE POLICY "No anon direct access to bus alarms" ON pwa_bus_alarms
    FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "No anon direct access to alight alarms" ON pwa_alight_alarms;
CREATE POLICY "No anon direct access to alight alarms" ON pwa_alight_alarms
    FOR ALL TO anon USING (false);
