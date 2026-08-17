BEGIN;

CREATE TABLE continuity.payload_key_anchors (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (length(server_purpose) BETWEEN 1 AND 96 AND server_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  payload_ref STRING NOT NULL CHECK (payload_ref ~ '^[0-9a-f]{48}$'),
  payload_revision DECIMAL(20, 0) NOT NULL CHECK (payload_revision BETWEEN 1 AND 18446744073709551615),
  requested_purpose STRING NOT NULL CHECK (length(requested_purpose) BETWEEN 1 AND 96 AND requested_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  key_scope_id STRING NOT NULL CHECK (key_scope_id ~ '^[0-9a-f]{48}$'),
  sensitivity_class STRING NOT NULL CHECK (sensitivity_class = 'synthetic'),
  crypto_domain_version STRING NOT NULL CHECK (length(crypto_domain_version) BETWEEN 1 AND 96 AND crypto_domain_version ~ '^[a-z][a-z0-9._:-]*$'),
  retention_origin_created_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  lifecycle_state STRING NOT NULL CHECK (lifecycle_state IN ('active', 'tombstoned', 'purged')),
  deletion_epoch DECIMAL(20, 0) NOT NULL DEFAULT 0 CHECK (deletion_epoch BETWEEN 0 AND 18446744073709551615),
  CHECK (retention_origin_created_at < retention_expires_at),
  CHECK (retention_expires_at <= retention_origin_created_at + INTERVAL '24 hours'),
  PRIMARY KEY (tenant_id, server_purpose, payload_ref, payload_revision),
  UNIQUE (tenant_id, server_purpose, key_scope_id),
  UNIQUE (
    tenant_id,
    server_purpose,
    payload_ref,
    payload_revision,
    requested_purpose,
    key_scope_id,
    sensitivity_class,
    crypto_domain_version,
    retention_origin_created_at,
    retention_expires_at
  ),
  FOREIGN KEY (tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose)
    REFERENCES continuity.payload_anchors (tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.payload_revision_material (
  tenant_id STRING NOT NULL,
  server_purpose STRING NOT NULL,
  payload_ref STRING NOT NULL,
  payload_revision DECIMAL(20, 0) NOT NULL,
  requested_purpose STRING NOT NULL,
  key_scope_id STRING NOT NULL,
  sensitivity_class STRING NOT NULL CHECK (sensitivity_class = 'synthetic'),
  crypto_domain_version STRING NOT NULL,
  retention_origin_created_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  envelope_format_version DECIMAL(20, 0) NOT NULL CHECK (envelope_format_version = 1),
  aead_algorithm STRING NOT NULL CHECK (aead_algorithm = 'AES-256-GCM'),
  nonce_96 BYTES NOT NULL CHECK (length(nonce_96) = 12),
  ciphertext BYTES NOT NULL CHECK (length(ciphertext) BETWEEN 1 AND 65536),
  tag_128 BYTES NOT NULL CHECK (length(tag_128) = 16),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (created_at >= retention_origin_created_at),
  CHECK (created_at < expires_at),
  CHECK (expires_at = retention_expires_at),
  PRIMARY KEY (tenant_id, server_purpose, payload_ref, payload_revision),
  FOREIGN KEY (
    tenant_id,
    server_purpose,
    payload_ref,
    payload_revision,
    requested_purpose,
    key_scope_id,
    sensitivity_class,
    crypto_domain_version,
    retention_origin_created_at,
    retention_expires_at
  ) REFERENCES continuity.payload_key_anchors (
    tenant_id,
    server_purpose,
    payload_ref,
    payload_revision,
    requested_purpose,
    key_scope_id,
    sensitivity_class,
    crypto_domain_version,
    retention_origin_created_at,
    retention_expires_at
  ) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.payload_wrapped_keys (
  tenant_id STRING NOT NULL,
  server_purpose STRING NOT NULL,
  payload_ref STRING NOT NULL,
  payload_revision DECIMAL(20, 0) NOT NULL,
  requested_purpose STRING NOT NULL,
  key_scope_id STRING NOT NULL,
  sensitivity_class STRING NOT NULL CHECK (sensitivity_class = 'synthetic'),
  crypto_domain_version STRING NOT NULL,
  retention_origin_created_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  kek_ref STRING NOT NULL CHECK (kek_ref ~ '^[0-9a-f]{48}$'),
  kek_version DECIMAL(20, 0) NOT NULL CHECK (kek_version BETWEEN 1 AND 18446744073709551615),
  wrapped_key_version DECIMAL(20, 0) NOT NULL CHECK (wrapped_key_version BETWEEN 1 AND 18446744073709551615),
  wrapped_dek BYTES NOT NULL CHECK (length(wrapped_dek) BETWEEN 1 AND 4096),
  lifecycle_state STRING NOT NULL CHECK (lifecycle_state = 'active'),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (created_at >= retention_origin_created_at),
  CHECK (created_at < expires_at),
  CHECK (expires_at = retention_expires_at),
  PRIMARY KEY (tenant_id, server_purpose, payload_ref, payload_revision),
  FOREIGN KEY (
    tenant_id,
    server_purpose,
    payload_ref,
    payload_revision,
    requested_purpose,
    key_scope_id,
    sensitivity_class,
    crypto_domain_version,
    retention_origin_created_at,
    retention_expires_at
  ) REFERENCES continuity.payload_key_anchors (
    tenant_id,
    server_purpose,
    payload_ref,
    payload_revision,
    requested_purpose,
    key_scope_id,
    sensitivity_class,
    crypto_domain_version,
    retention_origin_created_at,
    retention_expires_at
  ) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.payload_superseded_wrapped_keys (
  tenant_id STRING NOT NULL,
  server_purpose STRING NOT NULL,
  payload_ref STRING NOT NULL,
  payload_revision DECIMAL(20, 0) NOT NULL,
  requested_purpose STRING NOT NULL,
  key_scope_id STRING NOT NULL,
  sensitivity_class STRING NOT NULL CHECK (sensitivity_class = 'synthetic'),
  crypto_domain_version STRING NOT NULL,
  retention_origin_created_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  kek_ref STRING NOT NULL CHECK (kek_ref ~ '^[0-9a-f]{48}$'),
  kek_version DECIMAL(20, 0) NOT NULL CHECK (kek_version BETWEEN 1 AND 18446744073709551615),
  wrapped_key_version DECIMAL(20, 0) NOT NULL CHECK (wrapped_key_version BETWEEN 1 AND 18446744073709551615),
  wrapped_dek BYTES NOT NULL CHECK (length(wrapped_dek) BETWEEN 1 AND 4096),
  lifecycle_state STRING NOT NULL CHECK (lifecycle_state = 'superseded'),
  superseded_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (superseded_at >= retention_origin_created_at),
  CHECK (superseded_at < expires_at),
  CHECK (expires_at = retention_expires_at),
  PRIMARY KEY (tenant_id, server_purpose, payload_ref, payload_revision, wrapped_key_version),
  FOREIGN KEY (
    tenant_id,
    server_purpose,
    payload_ref,
    payload_revision,
    requested_purpose,
    key_scope_id,
    sensitivity_class,
    crypto_domain_version,
    retention_origin_created_at,
    retention_expires_at
  ) REFERENCES continuity.payload_key_anchors (
    tenant_id,
    server_purpose,
    payload_ref,
    payload_revision,
    requested_purpose,
    key_scope_id,
    sensitivity_class,
    crypto_domain_version,
    retention_origin_created_at,
    retention_expires_at
  ) ON DELETE RESTRICT ON UPDATE RESTRICT
);

REVOKE ALL PRIVILEGES ON TABLE continuity.payload_key_anchors FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.payload_revision_material FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.payload_wrapped_keys FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.payload_superseded_wrapped_keys FROM PUBLIC;

ALTER TABLE continuity.payload_key_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.payload_key_anchors FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.payload_revision_material ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.payload_revision_material FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.payload_wrapped_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.payload_wrapped_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.payload_superseded_wrapped_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.payload_superseded_wrapped_keys FORCE ROW LEVEL SECURITY;

COMMIT;
