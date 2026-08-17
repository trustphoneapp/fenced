BEGIN;
-- Forward-only static E2 schema; live behavior remains unproven until E4.
UPDATE continuity.memory_facts
SET embedding = array_fill(0::float8, ARRAY[1024])::vector
WHERE fact_status = 'retracted';

ALTER TABLE continuity.memory_facts
  ADD COLUMN deletion_fence DECIMAL(20, 0) NOT NULL DEFAULT 0
    CHECK (deletion_fence BETWEEN 0 AND 18446744073709551615);

CREATE UNIQUE INDEX memory_facts_one_active_revision
  ON continuity.memory_facts (tenant_id, server_purpose, fact_id)
  WHERE fact_status = 'active';

ALTER TABLE continuity.memory_propagations
  ADD CONSTRAINT memory_propagations_effect_result_key
  UNIQUE (tenant_id, server_purpose, fact_id, from_revision, to_revision, disposition);

CREATE VECTOR INDEX memory_facts_titan_scope_l2
  ON continuity.memory_facts (
    tenant_id, server_purpose, embedding_space, fact_status, sensitivity,
    embedding vector_l2_ops
  );

CREATE ROLE zc_continuity_session_issuer
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE ROLE zc_continuity_reservation_writer
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE ROLE zc_continuity_quota_view_owner
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE ROLE zc_continuity_mcp_view_owner
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE ROLE zc_continuity_mcp_reader
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
GRANT zc_continuity_executor TO continuity_app;
GRANT zc_continuity_session_issuer TO continuity_app;
GRANT zc_continuity_reservation_writer TO continuity_app;

CREATE TABLE continuity.hackathon_runtime_control (
  control_id STRING NOT NULL CHECK (control_id = 'live-v1'),
  provider_enabled BOOL NOT NULL DEFAULT false CHECK (provider_enabled IN (true, false)),
  public_session_cap INT8 NOT NULL CHECK (public_session_cap = 100),
  public_titan_cap INT8 NOT NULL CHECK (public_titan_cap = 600),
  public_nova_cap INT8 NOT NULL CHECK (public_nova_cap = 200),
  engineering_titan_cap INT8 NOT NULL CHECK (engineering_titan_cap = 200),
  engineering_nova_cap INT8 NOT NULL CHECK (engineering_nova_cap = 100),
  absolute_titan_cap INT8 NOT NULL CHECK (absolute_titan_cap = 800),
  absolute_nova_cap INT8 NOT NULL CHECK (absolute_nova_cap = 300),
  PRIMARY KEY (control_id)
);

INSERT INTO continuity.hackathon_runtime_control (
  control_id, provider_enabled, public_session_cap, public_titan_cap, public_nova_cap,
  engineering_titan_cap, engineering_nova_cap, absolute_titan_cap, absolute_nova_cap
) VALUES ('live-v1', false, 100, 600, 200, 200, 100, 800, 300);

CREATE TABLE continuity.hackathon_quota_lock (
  lock_id STRING NOT NULL CHECK (lock_id = 'public-v1'),
  lock_version INT8 NOT NULL CHECK (lock_version >= 0),
  PRIMARY KEY (lock_id)
);
INSERT INTO continuity.hackathon_quota_lock (lock_id, lock_version) VALUES ('public-v1', 0);

CREATE TABLE continuity.hackathon_sessions (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (server_purpose = 'hackathon-demo'),
  deletion_fence DECIMAL(20, 0) NOT NULL DEFAULT 0
    CHECK (deletion_fence BETWEEN 0 AND 18446744073709551615),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (created_at < expires_at AND expires_at <= created_at + INTERVAL '24 hours'),
  PRIMARY KEY (tenant_id, server_purpose),
  FOREIGN KEY (tenant_id) REFERENCES continuity.tenants (tenant_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.hackathon_session_usage (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (server_purpose = 'hackathon-demo'),
  audience STRING NOT NULL CHECK (audience = 'public'),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, server_purpose),
  UNIQUE (tenant_id, server_purpose, audience),
  FOREIGN KEY (tenant_id, server_purpose)
    REFERENCES continuity.hackathon_sessions (tenant_id, server_purpose)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.hackathon_provider_usage (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (server_purpose = 'hackathon-demo'),
  operation_id STRING NOT NULL CHECK (operation_id ~ '^[0-9a-f]{48}$'),
  attempt_id STRING NOT NULL CHECK (attempt_id ~ '^[0-9a-f]{48}$'),
  audience STRING NOT NULL CHECK (audience IN ('public', 'engineering')),
  titan_count INT8 NOT NULL CHECK (titan_count BETWEEN 0 AND 3),
  nova_count INT8 NOT NULL CHECK (nova_count BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, server_purpose, operation_id, attempt_id),
  UNIQUE (tenant_id, server_purpose, operation_id, attempt_id, audience, titan_count, nova_count),
  FOREIGN KEY (tenant_id, server_purpose)
    REFERENCES continuity.hackathon_sessions (tenant_id, server_purpose)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.hackathon_session_tokens (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (server_purpose = 'hackathon-demo'),
  session_digest STRING NOT NULL CHECK (session_digest ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (tenant_id = left(session_digest, 48)),
  CHECK (expires_at = created_at + INTERVAL '24 hours'),
  PRIMARY KEY (tenant_id, server_purpose),
  UNIQUE (session_digest),
  FOREIGN KEY (tenant_id, server_purpose)
    REFERENCES continuity.hackathon_sessions (tenant_id, server_purpose)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.hackathon_provider_reservations (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (server_purpose = 'hackathon-demo'),
  step_ordinal DECIMAL(20, 0) NOT NULL CHECK (step_ordinal BETWEEN 0 AND 4),
  step_name STRING NOT NULL CHECK (step_name IN (
    'start', 'ask_before', 'correct', 'ask_after', 'latest_receipt'
  )),
  request_digest STRING NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  operation_id STRING NOT NULL CHECK (operation_id ~ '^[0-9a-f]{48}$'),
  attempt_id STRING NOT NULL CHECK (attempt_id ~ '^[0-9a-f]{48}$'),
  audience STRING NOT NULL CHECK (audience = 'public'),
  titan_count DECIMAL(20, 0) NOT NULL CHECK (titan_count BETWEEN 0 AND 3),
  nova_count DECIMAL(20, 0) NOT NULL CHECK (nova_count BETWEEN 0 AND 1),
  reservation_state STRING NOT NULL CHECK (reservation_state = 'reserved'),
  reserved_at TIMESTAMPTZ NOT NULL,
  CHECK (
    (step_ordinal = 0 AND step_name = 'start' AND titan_count = 3 AND nova_count = 0)
    OR (step_ordinal = 1 AND step_name = 'ask_before' AND titan_count = 1 AND nova_count = 1)
    OR (step_ordinal = 2 AND step_name = 'correct' AND titan_count = 1 AND nova_count = 0)
    OR (step_ordinal = 3 AND step_name = 'ask_after' AND titan_count = 1 AND nova_count = 1)
    OR (step_ordinal = 4 AND step_name = 'latest_receipt' AND titan_count = 0 AND nova_count = 0)
  ),
  PRIMARY KEY (tenant_id, server_purpose, step_ordinal),
  UNIQUE (tenant_id, server_purpose, request_digest),
  UNIQUE (tenant_id, server_purpose, operation_id, attempt_id),
  UNIQUE (tenant_id, server_purpose, operation_id, attempt_id, request_digest),
  UNIQUE (tenant_id, server_purpose, step_name, request_digest, operation_id, attempt_id),
  FOREIGN KEY (tenant_id, server_purpose)
    REFERENCES continuity.hackathon_sessions (tenant_id, server_purpose)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (tenant_id, server_purpose, operation_id, attempt_id, audience, titan_count, nova_count)
    REFERENCES continuity.hackathon_provider_usage (
      tenant_id, server_purpose, operation_id, attempt_id, audience, titan_count, nova_count
    ) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.hackathon_answer_receipts (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (server_purpose = 'hackathon-demo'),
  receipt_id STRING NOT NULL CHECK (receipt_id ~ '^[0-9a-f]{48}$'),
  step_name STRING NOT NULL CHECK (step_name IN ('ask_before', 'ask_after')),
  operation_id STRING NOT NULL CHECK (operation_id ~ '^[0-9a-f]{48}$'),
  attempt_id STRING NOT NULL CHECK (attempt_id ~ '^[0-9a-f]{48}$'),
  request_digest STRING NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  request_digest_version STRING NOT NULL CHECK (request_digest_version = 'zc.request-digest.v1'),
  policy_decision_id STRING NOT NULL CHECK (length(policy_decision_id) BETWEEN 1 AND 128),
  policy_version STRING NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 96),
  context_compiler_version STRING NOT NULL CHECK (length(context_compiler_version) BETWEEN 1 AND 96),
  retrieval_config_version STRING NOT NULL CHECK (length(retrieval_config_version) BETWEEN 1 AND 96),
  embedding_space STRING NOT NULL CHECK (embedding_space = 'zc.bedrock-titan-v2.1024'),
  embedding_model_id STRING NOT NULL CHECK (embedding_model_id = 'amazon.titan-embed-text-v2:0'),
  embedding_policy_decision_id STRING NOT NULL CHECK (length(embedding_policy_decision_id) BETWEEN 1 AND 128),
  embedding_provider_request_id STRING NOT NULL CHECK (length(embedding_provider_request_id) BETWEEN 1 AND 128),
  embedding_input_tokens INT8 NOT NULL CHECK (embedding_input_tokens >= 0),
  embedding_latency_ms INT8 NOT NULL CHECK (embedding_latency_ms >= 0),
  provider STRING NOT NULL CHECK (provider = 'amazon-bedrock'),
  model_id STRING NOT NULL CHECK (model_id = 'amazon.nova-lite-v1:0'),
  region STRING NOT NULL CHECK (region = 'us-east-1'),
  provider_request_id STRING NOT NULL CHECK (length(provider_request_id) BETWEEN 1 AND 128),
  input_tokens INT8 NOT NULL CHECK (input_tokens >= 0),
  output_tokens INT8 NOT NULL CHECK (output_tokens >= 0),
  total_tokens INT8 NOT NULL CHECK (total_tokens = input_tokens + output_tokens),
  latency_ms INT8 NOT NULL CHECK (latency_ms >= 0),
  stop_reason STRING NOT NULL CHECK (stop_reason = 'end_turn'),
  provider_outcome STRING NOT NULL CHECK (provider_outcome = 'succeeded'),
  deletion_fence DECIMAL(20, 0) NOT NULL CHECK (deletion_fence BETWEEN 0 AND 18446744073709551615),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, server_purpose, receipt_id),
  UNIQUE (tenant_id, server_purpose, attempt_id),
  FOREIGN KEY (tenant_id, server_purpose)
    REFERENCES continuity.hackathon_sessions (tenant_id, server_purpose)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (tenant_id, server_purpose, step_name, request_digest, operation_id, attempt_id)
    REFERENCES continuity.hackathon_provider_reservations (
      tenant_id, server_purpose, step_name, request_digest, operation_id, attempt_id
    ) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.hackathon_response_payloads (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (server_purpose = 'hackathon-demo'),
  receipt_id STRING NOT NULL CHECK (receipt_id ~ '^[0-9a-f]{48}$'),
  response_body STRING NOT NULL CHECK (length(response_body) BETWEEN 1 AND 4096),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, server_purpose, receipt_id),
  FOREIGN KEY (tenant_id, server_purpose, receipt_id)
    REFERENCES continuity.hackathon_answer_receipts (tenant_id, server_purpose, receipt_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.hackathon_effect_results (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (server_purpose = 'hackathon-demo'),
  step_name STRING NOT NULL CHECK (step_name IN ('start', 'correct')),
  request_digest STRING NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  operation_id STRING NOT NULL CHECK (operation_id ~ '^[0-9a-f]{48}$'),
  attempt_id STRING NOT NULL CHECK (attempt_id ~ '^[0-9a-f]{48}$'),
  fact_id STRING,
  from_revision DECIMAL(20, 0),
  to_revision DECIMAL(20, 0),
  disposition STRING,
  completed_at TIMESTAMPTZ NOT NULL,
  CHECK (
    (step_name = 'start' AND fact_id IS NULL AND from_revision IS NULL
      AND to_revision IS NULL AND disposition IS NULL)
    OR (step_name = 'correct' AND fact_id ~ '^[0-9a-f]{48}$'
      AND from_revision BETWEEN 1 AND 18446744073709551615
      AND to_revision BETWEEN 0 AND 18446744073709551615
      AND disposition IN ('retract', 'supersede'))
  ),
  PRIMARY KEY (tenant_id, server_purpose, step_name),
  UNIQUE (tenant_id, server_purpose, operation_id, attempt_id),
  FOREIGN KEY (tenant_id, server_purpose, operation_id, attempt_id, request_digest)
    REFERENCES continuity.hackathon_provider_reservations (
      tenant_id, server_purpose, operation_id, attempt_id, request_digest
    ) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (tenant_id, server_purpose, fact_id, from_revision, to_revision, disposition)
    REFERENCES continuity.memory_propagations (
      tenant_id, server_purpose, fact_id, from_revision, to_revision, disposition
    ) MATCH SIMPLE ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.hackathon_receipt_revisions (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (server_purpose = 'hackathon-demo'),
  receipt_id STRING NOT NULL CHECK (receipt_id ~ '^[0-9a-f]{48}$'),
  fact_id STRING NOT NULL CHECK (fact_id ~ '^[0-9a-f]{48}$'),
  fact_revision DECIMAL(20, 0) NOT NULL CHECK (fact_revision BETWEEN 1 AND 18446744073709551615),
  deletion_fence DECIMAL(20, 0) NOT NULL CHECK (deletion_fence BETWEEN 0 AND 18446744073709551615),
  PRIMARY KEY (tenant_id, server_purpose, receipt_id, fact_id, fact_revision),
  FOREIGN KEY (tenant_id, server_purpose, receipt_id)
    REFERENCES continuity.hackathon_answer_receipts (tenant_id, server_purpose, receipt_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (tenant_id, server_purpose, fact_id, fact_revision)
    REFERENCES continuity.memory_facts (tenant_id, server_purpose, fact_id, fact_revision)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.hackathon_receipt_withheld (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (server_purpose = 'hackathon-demo'),
  receipt_id STRING NOT NULL CHECK (receipt_id ~ '^[0-9a-f]{48}$'),
  fact_id STRING NOT NULL CHECK (fact_id ~ '^[0-9a-f]{48}$'),
  fact_revision DECIMAL(20, 0) NOT NULL CHECK (fact_revision BETWEEN 1 AND 18446744073709551615),
  deletion_fence DECIMAL(20, 0) NOT NULL CHECK (deletion_fence BETWEEN 0 AND 18446744073709551615),
  reason STRING NOT NULL CHECK (reason = 'sensitivity_policy'),
  PRIMARY KEY (tenant_id, server_purpose, receipt_id, fact_id, fact_revision, deletion_fence),
  FOREIGN KEY (tenant_id, server_purpose, receipt_id)
    REFERENCES continuity.hackathon_answer_receipts (tenant_id, server_purpose, receipt_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (tenant_id, server_purpose, fact_id, fact_revision)
    REFERENCES continuity.memory_facts (tenant_id, server_purpose, fact_id, fact_revision)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

REVOKE ALL PRIVILEGES ON TABLE continuity.hackathon_runtime_control FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.hackathon_quota_lock FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.hackathon_session_usage FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.hackathon_provider_usage FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.hackathon_sessions FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.hackathon_session_tokens FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.hackathon_provider_reservations FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.hackathon_answer_receipts FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.hackathon_receipt_revisions FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.hackathon_receipt_withheld FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.hackathon_response_payloads FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.hackathon_effect_results FROM PUBLIC;

GRANT USAGE ON SCHEMA continuity TO zc_continuity_session_issuer;
GRANT SELECT ON TABLE continuity.hackathon_runtime_control TO zc_continuity_session_issuer;
GRANT SELECT, UPDATE ON TABLE continuity.hackathon_quota_lock TO zc_continuity_session_issuer;
GRANT INSERT ON TABLE continuity.hackathon_session_usage TO zc_continuity_session_issuer;
GRANT INSERT ON TABLE continuity.hackathon_provider_usage TO zc_continuity_session_issuer;
GRANT INSERT ON TABLE continuity.tenants TO zc_continuity_session_issuer;
GRANT SELECT, INSERT ON TABLE continuity.hackathon_sessions TO zc_continuity_session_issuer;
GRANT SELECT, INSERT ON TABLE continuity.hackathon_session_tokens TO zc_continuity_session_issuer;
GRANT SELECT, INSERT ON TABLE continuity.hackathon_provider_reservations
  TO zc_continuity_session_issuer;
GRANT SELECT ON TABLE continuity.hackathon_runtime_control TO zc_continuity_executor;
GRANT SELECT ON TABLE continuity.hackathon_sessions TO zc_continuity_executor;
GRANT SELECT ON TABLE continuity.hackathon_session_tokens TO zc_continuity_executor;
GRANT SELECT ON TABLE continuity.hackathon_provider_reservations TO zc_continuity_executor;
GRANT SELECT, INSERT ON TABLE continuity.hackathon_answer_receipts TO zc_continuity_executor;
GRANT SELECT, INSERT ON TABLE continuity.hackathon_receipt_revisions TO zc_continuity_executor;
GRANT SELECT, INSERT ON TABLE continuity.hackathon_receipt_withheld TO zc_continuity_executor;
GRANT SELECT, INSERT ON TABLE continuity.hackathon_response_payloads TO zc_continuity_executor;
GRANT SELECT, INSERT ON TABLE continuity.hackathon_effect_results TO zc_continuity_executor;
GRANT USAGE ON SCHEMA continuity TO zc_continuity_reservation_writer;
GRANT SELECT ON TABLE continuity.hackathon_runtime_control TO zc_continuity_reservation_writer;
GRANT SELECT, UPDATE ON TABLE continuity.hackathon_quota_lock TO zc_continuity_reservation_writer;
GRANT SELECT ON TABLE continuity.hackathon_sessions TO zc_continuity_reservation_writer;
GRANT SELECT ON TABLE continuity.hackathon_session_tokens TO zc_continuity_reservation_writer;
GRANT INSERT ON TABLE continuity.hackathon_provider_usage TO zc_continuity_reservation_writer;
GRANT SELECT, INSERT ON TABLE continuity.hackathon_provider_reservations
  TO zc_continuity_reservation_writer;

ALTER TABLE continuity.hackathon_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_session_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_session_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_provider_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_provider_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_answer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_answer_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_receipt_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_receipt_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_receipt_withheld ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_receipt_withheld FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_response_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_response_payloads FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_effect_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_effect_results FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_session_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_session_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_provider_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.hackathon_provider_usage FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_session_issuer_insert_scope ON continuity.tenants
  FOR INSERT TO zc_continuity_session_issuer
  WITH CHECK (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true));

CREATE POLICY hackathon_sessions_issuer_select_scope ON continuity.hackathon_sessions
  FOR SELECT TO zc_continuity_session_issuer
  USING (tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_sessions_issuer_insert_scope ON continuity.hackathon_sessions
  FOR INSERT TO zc_continuity_session_issuer
  WITH CHECK (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));

CREATE POLICY hackathon_sessions_executor_select_scope ON continuity.hackathon_sessions
  FOR SELECT TO zc_continuity_executor
  USING (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));

CREATE POLICY hackathon_sessions_reservation_select_scope ON continuity.hackathon_sessions
  FOR SELECT TO zc_continuity_reservation_writer
  USING (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_session_tokens_issuer_select_scope ON continuity.hackathon_session_tokens
  FOR SELECT TO zc_continuity_session_issuer
  USING (tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_session_tokens_issuer_insert_scope ON continuity.hackathon_session_tokens
  FOR INSERT TO zc_continuity_session_issuer
  WITH CHECK (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_session_tokens_executor_select_scope ON continuity.hackathon_session_tokens
  FOR SELECT TO zc_continuity_executor
  USING (tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_session_tokens_reservation_select_scope ON continuity.hackathon_session_tokens
  FOR SELECT TO zc_continuity_reservation_writer
  USING (tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));

CREATE POLICY hackathon_session_usage_public_insert_scope ON continuity.hackathon_session_usage
  FOR INSERT TO zc_continuity_session_issuer
  WITH CHECK (audience = 'public' AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_provider_usage_public_insert_scope ON continuity.hackathon_provider_usage
  FOR INSERT TO zc_continuity_session_issuer, zc_continuity_reservation_writer
  WITH CHECK (audience = 'public' AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));

CREATE POLICY hackathon_reservations_writer_select_scope ON continuity.hackathon_provider_reservations
  FOR SELECT TO zc_continuity_reservation_writer
  USING (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_reservations_writer_insert_scope ON continuity.hackathon_provider_reservations
  FOR INSERT TO zc_continuity_reservation_writer
  WITH CHECK (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_reservations_issuer_select_scope ON continuity.hackathon_provider_reservations
  FOR SELECT TO zc_continuity_session_issuer
  USING (tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_reservations_issuer_insert_scope ON continuity.hackathon_provider_reservations
  FOR INSERT TO zc_continuity_session_issuer
  WITH CHECK (tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true)
    AND step_ordinal = 0 AND step_name = 'start');
CREATE POLICY hackathon_reservations_executor_select_scope
  ON continuity.hackathon_provider_reservations FOR SELECT TO zc_continuity_executor
  USING (tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));

CREATE POLICY hackathon_answer_receipts_executor_select_scope ON continuity.hackathon_answer_receipts
  FOR SELECT TO zc_continuity_executor
  USING (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_answer_receipts_executor_insert_scope ON continuity.hackathon_answer_receipts
  FOR INSERT TO zc_continuity_executor
  WITH CHECK (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));

CREATE POLICY hackathon_receipt_revisions_executor_select_scope ON continuity.hackathon_receipt_revisions
  FOR SELECT TO zc_continuity_executor
  USING (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_receipt_revisions_executor_insert_scope ON continuity.hackathon_receipt_revisions
  FOR INSERT TO zc_continuity_executor
  WITH CHECK (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));

CREATE POLICY hackathon_receipt_withheld_executor_select_scope ON continuity.hackathon_receipt_withheld
  FOR SELECT TO zc_continuity_executor
  USING (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_receipt_withheld_executor_insert_scope ON continuity.hackathon_receipt_withheld
  FOR INSERT TO zc_continuity_executor
  WITH CHECK (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true)
    AND reason = 'sensitivity_policy');

CREATE POLICY hackathon_response_payloads_executor_select_scope
  ON continuity.hackathon_response_payloads FOR SELECT TO zc_continuity_executor
  USING (tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_response_payloads_executor_insert_scope
  ON continuity.hackathon_response_payloads FOR INSERT TO zc_continuity_executor
  WITH CHECK (tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_effect_results_executor_select_scope
  ON continuity.hackathon_effect_results FOR SELECT TO zc_continuity_executor
  USING (tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_effect_results_executor_insert_scope
  ON continuity.hackathon_effect_results FOR INSERT TO zc_continuity_executor
  WITH CHECK (tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));

GRANT USAGE ON SCHEMA continuity TO zc_continuity_quota_view_owner;
GRANT CREATE ON SCHEMA continuity TO zc_continuity_quota_view_owner;
GRANT SELECT ON TABLE continuity.hackathon_session_usage TO zc_continuity_quota_view_owner;
GRANT SELECT ON TABLE continuity.hackathon_provider_usage TO zc_continuity_quota_view_owner;
CREATE POLICY hackathon_session_usage_quota_scope ON continuity.hackathon_session_usage
  FOR SELECT TO zc_continuity_quota_view_owner USING (true);
CREATE POLICY hackathon_provider_usage_quota_scope ON continuity.hackathon_provider_usage
  FOR SELECT TO zc_continuity_quota_view_owner USING (true);
CREATE VIEW continuity.hackathon_usage_summary_v1 AS SELECT
  count(session.tenant_id)::INT8 AS public_sessions,
  coalesce(sum(usage.titan_count) FILTER (WHERE usage.audience = 'public'), 0)::INT8
    AS public_titan,
  coalesce(sum(usage.nova_count) FILTER (WHERE usage.audience = 'public'), 0)::INT8
    AS public_nova,
  coalesce(sum(usage.titan_count) FILTER (WHERE usage.audience = 'engineering'), 0)::INT8
    AS engineering_titan,
  coalesce(sum(usage.nova_count) FILTER (WHERE usage.audience = 'engineering'), 0)::INT8
    AS engineering_nova
FROM continuity.hackathon_session_usage AS session
FULL OUTER JOIN continuity.hackathon_provider_usage AS usage ON false;
ALTER VIEW continuity.hackathon_usage_summary_v1 OWNER TO zc_continuity_quota_view_owner;
REVOKE CREATE ON SCHEMA continuity FROM zc_continuity_quota_view_owner;
REVOKE ALL PRIVILEGES ON continuity.hackathon_usage_summary_v1 FROM PUBLIC;
GRANT SELECT ON continuity.hackathon_usage_summary_v1
  TO zc_continuity_session_issuer, zc_continuity_reservation_writer;

GRANT SELECT ON TABLE continuity.hackathon_sessions TO zc_continuity_mcp_view_owner;
GRANT SELECT ON TABLE continuity.hackathon_provider_reservations TO zc_continuity_mcp_view_owner;
GRANT SELECT ON TABLE continuity.hackathon_answer_receipts TO zc_continuity_mcp_view_owner;
GRANT SELECT ON TABLE continuity.hackathon_receipt_revisions TO zc_continuity_mcp_view_owner;
GRANT USAGE ON SCHEMA continuity TO zc_continuity_mcp_view_owner;
GRANT CREATE ON SCHEMA continuity TO zc_continuity_mcp_view_owner;

CREATE POLICY hackathon_sessions_mcp_scope ON continuity.hackathon_sessions
  FOR SELECT TO zc_continuity_mcp_view_owner
  USING (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));
CREATE POLICY hackathon_reservations_mcp_scope ON continuity.hackathon_provider_reservations
  FOR SELECT TO zc_continuity_mcp_view_owner
  USING (tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));

CREATE POLICY hackathon_answer_receipts_mcp_scope ON continuity.hackathon_answer_receipts
  FOR SELECT TO zc_continuity_mcp_view_owner
  USING (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));

CREATE POLICY hackathon_receipt_revisions_mcp_scope ON continuity.hackathon_receipt_revisions
  FOR SELECT TO zc_continuity_mcp_view_owner
  USING (current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND server_purpose = current_setting('continuity.server_purpose', true));

CREATE VIEW continuity.task_status_summary_v1 AS
  SELECT session.tenant_id, session.server_purpose,
    count(reservation.step_ordinal)::INT8 AS reserved_steps,
    session.deletion_fence, session.expires_at
  FROM continuity.hackathon_sessions AS session
  LEFT JOIN continuity.hackathon_provider_reservations AS reservation
    ON reservation.tenant_id = session.tenant_id
    AND reservation.server_purpose = session.server_purpose
  GROUP BY session.tenant_id, session.server_purpose, session.deletion_fence, session.expires_at;
CREATE VIEW continuity.receipt_summary_v1 AS
  SELECT tenant_id, server_purpose, receipt_id, attempt_id, policy_version,
    context_compiler_version, retrieval_config_version, embedding_space,
    provider, model_id, provider_request_id, created_at
  FROM continuity.hackathon_answer_receipts;
CREATE VIEW continuity.evidence_lineage_summary_v1 AS
  SELECT tenant_id, server_purpose, receipt_id, fact_id, fact_revision, deletion_fence
  FROM continuity.hackathon_receipt_revisions;

ALTER VIEW continuity.task_status_summary_v1 OWNER TO zc_continuity_mcp_view_owner;
ALTER VIEW continuity.receipt_summary_v1 OWNER TO zc_continuity_mcp_view_owner;
ALTER VIEW continuity.evidence_lineage_summary_v1 OWNER TO zc_continuity_mcp_view_owner;
REVOKE CREATE ON SCHEMA continuity FROM zc_continuity_mcp_view_owner;
REVOKE ALL PRIVILEGES ON continuity.task_status_summary_v1 FROM PUBLIC;
REVOKE ALL PRIVILEGES ON continuity.receipt_summary_v1 FROM PUBLIC;
REVOKE ALL PRIVILEGES ON continuity.evidence_lineage_summary_v1 FROM PUBLIC;
GRANT USAGE ON SCHEMA continuity TO zc_continuity_mcp_reader;
GRANT SELECT ON continuity.task_status_summary_v1 TO zc_continuity_mcp_reader;
GRANT SELECT ON continuity.receipt_summary_v1 TO zc_continuity_mcp_reader;
GRANT SELECT ON continuity.evidence_lineage_summary_v1 TO zc_continuity_mcp_reader;

COMMIT;
