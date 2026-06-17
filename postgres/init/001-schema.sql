CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS domains (
    id BIGSERIAL PRIMARY KEY,
    tenant_slug TEXT NOT NULL UNIQUE CHECK (tenant_slug ~ '^[a-z0-9-]+$'),
    domain TEXT NOT NULL UNIQUE CHECK (domain ~ '^mail\.[a-z0-9-]+\.[a-z0-9.-]+$'),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mailboxes (
    id BIGSERIAL PRIMARY KEY,
    domain_id BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    local_part TEXT NOT NULL CHECK (local_part ~ '^[a-z0-9._-]+$'),
    password_hash TEXT NOT NULL,
    quota_mb INTEGER NOT NULL DEFAULT 1024 CHECK (quota_mb > 0),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (domain_id, local_part)
);

CREATE INDEX IF NOT EXISTS idx_domains_domain_enabled ON domains(domain, enabled);
CREATE INDEX IF NOT EXISTS idx_mailboxes_lookup ON mailboxes(domain_id, local_part, enabled);

CREATE OR REPLACE VIEW mailbox_emails AS
SELECT
    m.id AS mailbox_id,
    d.id AS domain_id,
    d.tenant_slug,
    d.domain,
    m.local_part,
    (m.local_part || '@' || d.domain) AS email,
    m.quota_mb,
    m.enabled
FROM mailboxes m
JOIN domains d ON d.id = m.domain_id;

CREATE OR REPLACE FUNCTION create_domain(p_tenant_slug TEXT, p_root_domain TEXT)
RETURNS TABLE(domain_id BIGINT, domain TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant TEXT;
    v_root TEXT;
    v_domain TEXT;
BEGIN
    v_tenant := lower(trim(p_tenant_slug));
    v_root := lower(trim(p_root_domain));

    IF v_tenant !~ '^[a-z0-9-]+$' THEN
        RAISE EXCEPTION 'invalid tenant_slug: %', p_tenant_slug;
    END IF;

    IF v_root !~ '^[a-z0-9.-]+$' THEN
        RAISE EXCEPTION 'invalid root_domain: %', p_root_domain;
    END IF;

    v_domain := 'mail.' || v_tenant || '.' || v_root;

    INSERT INTO domains (tenant_slug, domain, enabled)
    VALUES (v_tenant, v_domain, TRUE)
    ON CONFLICT (tenant_slug)
    DO UPDATE SET domain = EXCLUDED.domain, enabled = TRUE
    RETURNING id, domains.domain INTO domain_id, domain;

    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION create_or_update_mailbox(
    p_domain TEXT,
    p_local_part TEXT,
    p_password TEXT,
    p_quota_mb INTEGER DEFAULT 1024
)
RETURNS TABLE(mailbox_id BIGINT, email TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_domain_id BIGINT;
    v_local_part TEXT;
    v_domain TEXT;
BEGIN
    v_local_part := lower(trim(p_local_part));
    v_domain := lower(trim(p_domain));

    IF v_local_part !~ '^[a-z0-9._-]+$' THEN
        RAISE EXCEPTION 'invalid local_part: %', p_local_part;
    END IF;

    IF p_quota_mb IS NULL OR p_quota_mb <= 0 THEN
        RAISE EXCEPTION 'invalid quota_mb: %', p_quota_mb;
    END IF;

    SELECT id INTO v_domain_id
    FROM domains
    WHERE domain = v_domain
      AND enabled = TRUE;

    IF v_domain_id IS NULL THEN
        RAISE EXCEPTION 'domain not found or disabled: %', p_domain;
    END IF;

    INSERT INTO mailboxes (domain_id, local_part, password_hash, quota_mb, enabled)
    VALUES (
        v_domain_id,
        v_local_part,
        '{BLF-CRYPT}' || crypt(p_password, gen_salt('bf', 10)),
        p_quota_mb,
        TRUE
    )
    ON CONFLICT (domain_id, local_part)
    DO UPDATE SET
        password_hash = '{BLF-CRYPT}' || crypt(p_password, gen_salt('bf', 10)),
        quota_mb = EXCLUDED.quota_mb,
        enabled = TRUE
    RETURNING id INTO mailbox_id;

    email := v_local_part || '@' || v_domain;
    RETURN NEXT;
END;
$$;
