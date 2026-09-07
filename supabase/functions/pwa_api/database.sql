-- Supabase PostgreSQL Migration for SG Bus Kaki PWA

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

-- 3. MRT Alert State Tracking Table
CREATE TABLE IF NOT EXISTS pwa_mrt_alert_state (
    id INT PRIMARY KEY DEFAULT 1,
    last_status INT DEFAULT 1,
    last_affected JSONB DEFAULT '[]'::JSONB,
    last_message TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
