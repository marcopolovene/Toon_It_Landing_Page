-- ============================================================
-- Toon It! Google Play Compliance Schema Update
-- Blockers 1, 2, 4: Reporting, UGC Moderation, Photo Disclosure
-- Date: 2026-05-28
-- ============================================================

-- ------------------------------------------------------------
-- 1. Profiles Table: Terms Acceptance + Photo Disclosure
--    (Blocker 2: UGC Policy 9876937 + Blocker 4: User Data 9888076)
-- ------------------------------------------------------------
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS terms_version VARCHAR(20),
ADD COLUMN IF NOT EXISTS photo_disclosure_accepted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS photo_disclosure_date TIMESTAMPTZ;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_profiles_terms ON profiles(terms_accepted, terms_version);

-- ------------------------------------------------------------
-- 2. Content Reports Table: AI-Generated Content Reporting
--    (Blocker 1: AI-Generated Content Policy 13985936)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    generation_id UUID REFERENCES generations(id) ON DELETE CASCADE,
    reporter_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    report_reason VARCHAR(50) NOT NULL CHECK (report_reason IN ('inappropriate','misleading','impersonation','other')),
    report_details TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    moderation_action VARCHAR(50), -- e.g., 'removed', 'warned', 'none'
    moderation_notes TEXT
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status);
CREATE INDEX IF NOT EXISTS idx_content_reports_generation ON content_reports(generation_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_created ON content_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reports_reporter ON content_reports(reporter_user_id);

-- Enable RLS
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (for idempotency)
DROP POLICY IF EXISTS "Users can create reports" ON content_reports;
DROP POLICY IF EXISTS "Users can view own reports" ON content_reports;
DROP POLICY IF EXISTS "Admins can manage all reports" ON content_reports;

-- Policy: Authenticated users can create their own reports
CREATE POLICY "Users can create reports"
    ON content_reports FOR INSERT
    TO authenticated
    WITH CHECK (reporter_user_id = auth.uid());

-- Policy: Users can view their own reports
CREATE POLICY "Users can view own reports"
    ON content_reports FOR SELECT
    TO authenticated
    USING (reporter_user_id = auth.uid());

-- Policy: Admin access (check if function exists first)
DO $$
BEGIN
    -- Try to create is_admin function if not exists
    CREATE OR REPLACE FUNCTION is_admin(user_id UUID)
    RETURNS BOOLEAN AS $func$
    BEGIN
        RETURN EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = user_id
            AND email IN ('admin@toonit.ai', 'marcopolovene@gmail.com')
        );
    END;
    $func$ LANGUAGE plpgsql SECURITY DEFINER;
EXCEPTION WHEN duplicate_function THEN
    -- Function already exists, do nothing
    NULL;
END $$;

CREATE POLICY "Admins can manage all reports"
    ON content_reports FOR ALL
    TO authenticated
    USING (is_admin(auth.uid()));

-- Allow anonymous users to create reports (if needed for unauth flows)
-- Commented out by default — uncomment if you want unauth reporting
-- DROP POLICY IF EXISTS "Anonymous can create reports" ON content_reports;
-- CREATE POLICY "Anonymous can create reports"
--     ON content_reports FOR INSERT
--     TO anon
--     WITH CHECK (true);

-- ------------------------------------------------------------
-- 3. Moderation Logs Table: Audit Trail for Blocked Content
--    (Blocker 3: Inappropriate Content Policy 9878810)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS moderation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action VARCHAR(20) NOT NULL CHECK (action IN ('blocked','flagged','allowed','auto_flagged')),
    reason TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    generation_id UUID REFERENCES generations(id) ON DELETE SET NULL,
    confidence_score NUMERIC,
    moderation_service VARCHAR(50), -- e.g., 'google_vision', 'aws_rekognition'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_logs_created ON moderation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_action ON moderation_logs(action);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_user ON moderation_logs(user_id);

-- Enable RLS
ALTER TABLE moderation_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view moderation logs
DROP POLICY IF EXISTS "Admins can view moderation logs" ON moderation_logs;
CREATE POLICY "Admins can view moderation logs"
    ON moderation_logs FOR ALL
    TO authenticated
    USING (is_admin(auth.uid()));

-- ------------------------------------------------------------
-- Verification Query: Confirm tables and columns exist
-- ------------------------------------------------------------
SELECT 'profiles columns' AS check_item,
       COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_name = 'profiles'
AND column_name IN ('terms_accepted','terms_accepted_at','terms_version',
                    'photo_disclosure_accepted','photo_disclosure_date');

SELECT 'content_reports columns' AS check_item,
       COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_name = 'content_reports';

SELECT 'moderation_logs columns' AS check_item,
       COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_name = 'moderation_logs';

-- Show current policies
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('content_reports', 'moderation_logs');

-- Done!
SELECT 'Schema update complete' AS status;
