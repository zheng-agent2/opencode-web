-- OpenCode Cloud Database Schema
-- For Supabase Postgres
-- Version: 1.0

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- USERS TABLE
-- ============================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    auth_provider VARCHAR(50) NOT NULL,
    auth_provider_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settings JSONB DEFAULT '{}'::jsonb,
    tier VARCHAR(50) DEFAULT 'free',

    -- Resource limits per tier
    max_sessions INT DEFAULT 10,
    max_storage_mb INT DEFAULT 1000,
    max_concurrent_containers INT DEFAULT 1,

    -- Usage tracking
    current_sessions INT DEFAULT 0,
    current_storage_mb INT DEFAULT 0,

    CONSTRAINT valid_tier CHECK (tier IN ('free', 'pro', 'enterprise'))
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_auth_provider ON users(auth_provider, auth_provider_id);

-- ============================================================================
-- PROJECTS TABLE
-- ============================================================================
CREATE TABLE projects (
    id VARCHAR(255) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255),
    directory_path TEXT NOT NULL,
    vcs VARCHAR(10),
    worktree_path TEXT,

    icon_url TEXT,
    icon_color VARCHAR(50),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    initialized_at TIMESTAMPTZ,

    -- Storage metadata
    s3_prefix TEXT NOT NULL,
    total_size_bytes BIGINT DEFAULT 0,

    UNIQUE(user_id, directory_path)
);

CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_updated_at ON projects(updated_at DESC);

-- ============================================================================
-- SESSIONS TABLE
-- ============================================================================
CREATE TABLE sessions (
    id VARCHAR(255) PRIMARY KEY,
    project_id VARCHAR(255) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id VARCHAR(255) REFERENCES sessions(id) ON DELETE SET NULL,

    title TEXT NOT NULL,
    version VARCHAR(50) NOT NULL,

    -- Container assignment
    container_id VARCHAR(255),
    container_status VARCHAR(20),

    -- Session metadata
    summary JSONB,
    share_info JSONB,
    permission_ruleset JSONB,
    revert_info JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    compacting_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,

    CONSTRAINT valid_container_status CHECK (
        container_status IN ('creating', 'running', 'stopped', 'error', NULL)
    )
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_project_id ON sessions(project_id);
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC);
CREATE INDEX idx_sessions_container_id ON sessions(container_id);

-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================
CREATE TABLE messages (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    role VARCHAR(20) NOT NULL,
    content JSONB,
    metadata JSONB,

    -- AI model info
    provider_id VARCHAR(100),
    model_id VARCHAR(100),

    -- Token usage and cost
    tokens_input INT DEFAULT 0,
    tokens_output INT DEFAULT 0,
    tokens_cached INT DEFAULT 0,
    cost_usd DECIMAL(10, 6) DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_role CHECK (role IN ('user', 'assistant', 'system'))
);

CREATE INDEX idx_messages_session_id ON messages(session_id, id);
CREATE INDEX idx_messages_user_id ON messages(user_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- ============================================================================
-- MESSAGE PARTS TABLE
-- ============================================================================
CREATE TABLE message_parts (
    id VARCHAR(255) PRIMARY KEY,
    message_id VARCHAR(255) NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    session_id VARCHAR(255) NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    type VARCHAR(50) NOT NULL,
    content JSONB NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_parts_message_id ON message_parts(message_id);
CREATE INDEX idx_message_parts_session_id ON message_parts(session_id);

-- ============================================================================
-- FILES TABLE
-- ============================================================================
CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id VARCHAR(255) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    path TEXT NOT NULL,
    s3_key TEXT NOT NULL,

    size_bytes BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(255),

    -- Version control
    version INT NOT NULL DEFAULT 1,
    is_latest BOOLEAN NOT NULL DEFAULT TRUE,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_session_id VARCHAR(255) REFERENCES sessions(id),

    UNIQUE(project_id, path, version)
);

CREATE INDEX idx_files_project_id ON files(project_id);
CREATE INDEX idx_files_project_path ON files(project_id, path);
CREATE INDEX idx_files_latest ON files(project_id, is_latest) WHERE is_latest = TRUE;
CREATE INDEX idx_files_s3_key ON files(s3_key);

-- ============================================================================
-- FILE VERSIONS TABLE
-- ============================================================================
CREATE TABLE file_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    project_id VARCHAR(255) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    version INT NOT NULL,
    s3_key TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,

    -- Change tracking
    diff TEXT,
    session_id VARCHAR(255) REFERENCES sessions(id),
    message_id VARCHAR(255) REFERENCES messages(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(file_id, version)
);

CREATE INDEX idx_file_versions_file_id ON file_versions(file_id);
CREATE INDEX idx_file_versions_session_id ON file_versions(session_id);

-- ============================================================================
-- CONTAINERS TABLE
-- ============================================================================
CREATE TABLE containers (
    id VARCHAR(255) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id VARCHAR(255) NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    project_id VARCHAR(255) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Container info
    image VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL,

    -- Resource allocation
    cpu_limit DECIMAL(4, 2),
    memory_limit_mb INT,
    disk_limit_mb INT,

    -- Network isolation
    internal_ip VARCHAR(50),
    internal_port INT,

    -- Lifecycle
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    last_heartbeat TIMESTAMPTZ,

    -- Workspace sync
    last_sync_at TIMESTAMPTZ,
    sync_status VARCHAR(20),

    CONSTRAINT valid_status CHECK (
        status IN ('creating', 'running', 'stopped', 'error')
    )
);

CREATE INDEX idx_containers_user_id ON containers(user_id);
CREATE INDEX idx_containers_session_id ON containers(session_id);
CREATE INDEX idx_containers_status ON containers(status);
CREATE INDEX idx_containers_heartbeat ON containers(last_heartbeat);

-- ============================================================================
-- USER SECRETS TABLE
-- ============================================================================
CREATE TABLE user_secrets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    provider_id VARCHAR(100) NOT NULL,
    encrypted_key TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,

    UNIQUE(user_id, provider_id)
);

CREATE INDEX idx_user_secrets_user_id ON user_secrets(user_id);

-- ============================================================================
-- AUDIT LOGS TABLE
-- ============================================================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE SET NULL,

    event_type VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),

    ip_address INET,
    user_agent TEXT,

    metadata JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id, created_at);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE containers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_secrets ENABLE ROW LEVEL SECURITY;

-- Users table policies
CREATE POLICY users_select_own ON users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY users_update_own ON users
    FOR UPDATE USING (auth.uid() = id);

-- Projects table policies
CREATE POLICY projects_select_own ON projects
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY projects_insert_own ON projects
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY projects_update_own ON projects
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY projects_delete_own ON projects
    FOR DELETE USING (auth.uid() = user_id);

-- Sessions table policies
CREATE POLICY sessions_select_own ON sessions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY sessions_insert_own ON sessions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY sessions_update_own ON sessions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY sessions_delete_own ON sessions
    FOR DELETE USING (auth.uid() = user_id);

-- Messages table policies
CREATE POLICY messages_select_own ON messages
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY messages_insert_own ON messages
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Message parts table policies
CREATE POLICY message_parts_select_own ON message_parts
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY message_parts_insert_own ON message_parts
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY message_parts_update_own ON message_parts
    FOR UPDATE USING (auth.uid() = user_id);

-- Files table policies
CREATE POLICY files_select_own ON files
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY files_insert_own ON files
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY files_update_own ON files
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY files_delete_own ON files
    FOR DELETE USING (auth.uid() = user_id);

-- File versions table policies
CREATE POLICY file_versions_select_own ON file_versions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY file_versions_insert_own ON file_versions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Containers table policies
CREATE POLICY containers_select_own ON containers
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY containers_insert_own ON containers
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY containers_update_own ON containers
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY containers_delete_own ON containers
    FOR DELETE USING (auth.uid() = user_id);

-- User secrets table policies
CREATE POLICY user_secrets_select_own ON user_secrets
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY user_secrets_insert_own ON user_secrets
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_secrets_update_own ON user_secrets
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY user_secrets_delete_own ON user_secrets
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update updated_at timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_secrets_updated_at BEFORE UPDATE ON user_secrets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update project total size when files change
CREATE OR REPLACE FUNCTION update_project_size()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE projects
        SET total_size_bytes = (
            SELECT COALESCE(SUM(size_bytes), 0)
            FROM files
            WHERE project_id = NEW.project_id AND is_latest = TRUE
        )
        WHERE id = NEW.project_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE projects
        SET total_size_bytes = (
            SELECT COALESCE(SUM(size_bytes), 0)
            FROM files
            WHERE project_id = OLD.project_id AND is_latest = TRUE
        )
        WHERE id = OLD.project_id;
    END IF;
    RETURN NULL;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_project_size_trigger
    AFTER INSERT OR UPDATE OR DELETE ON files
    FOR EACH ROW EXECUTE FUNCTION update_project_size();

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to mark previous file versions as not latest
CREATE OR REPLACE FUNCTION mark_previous_versions_not_latest()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_latest = TRUE THEN
        UPDATE files
        SET is_latest = FALSE
        WHERE project_id = NEW.project_id
          AND path = NEW.path
          AND id != NEW.id;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER mark_previous_versions_trigger
    AFTER INSERT OR UPDATE ON files
    FOR EACH ROW EXECUTE FUNCTION mark_previous_versions_not_latest();

-- ============================================================================
-- INITIAL DATA
-- ============================================================================

-- Create a system user for background jobs
INSERT INTO users (id, email, auth_provider, tier, max_sessions, max_storage_mb, max_concurrent_containers)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'system@opencode.ai',
    'internal',
    'enterprise',
    999999,
    999999,
    999999
) ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- NOTES
-- ============================================================================

-- To apply this schema to your Supabase project:
-- 1. Create a new Supabase project
-- 2. Go to SQL Editor
-- 3. Copy and paste this entire file
-- 4. Run the query
--
-- To update the schema:
-- 1. Create migration files in infra/migrations/
-- 2. Run migrations in order
--
-- Security notes:
-- - All tables use Row Level Security (RLS)
-- - Users can only access their own data
-- - Service role key bypasses RLS for admin operations
-- - Always use parameterized queries to prevent SQL injection
