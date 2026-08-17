BEGIN;

ALTER TABLE continuity.events
  ADD CONSTRAINT events_target_candidate_key
  UNIQUE (tenant_id, server_purpose, event_id, event_revision, requested_purpose);

CREATE TABLE continuity.event_revision_requests (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (length(server_purpose) BETWEEN 1 AND 96 AND server_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  request_id STRING NOT NULL CHECK (request_id ~ '^[0-9a-f]{48}$'),
  request_revision DECIMAL(20, 0) NOT NULL CHECK (request_revision BETWEEN 1 AND 18446744073709551615),
  record_schema_version STRING NOT NULL CHECK (record_schema_version = 'zc.internal.event-revision-request.v1'),
  record_family STRING NOT NULL CHECK (record_family = 'event_revision_request'),
  requested_purpose STRING NOT NULL CHECK (length(requested_purpose) BETWEEN 1 AND 96 AND requested_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  operation_id STRING NOT NULL CHECK (operation_id ~ '^[0-9a-f]{48}$'),
  attempt_id STRING NOT NULL CHECK (attempt_id ~ '^[0-9a-f]{48}$'),
  request_type STRING NOT NULL CHECK (request_type IN ('correction.requested', 'retraction.requested')),
  occurred_at TIMESTAMPTZ NOT NULL,
  target_event_id STRING NOT NULL CHECK (target_event_id ~ '^[0-9a-f]{48}$'),
  target_event_revision DECIMAL(20, 0) NOT NULL CHECK (target_event_revision BETWEEN 1 AND 18446744073709551615),
  payload_tenant_id STRING,
  payload_server_purpose STRING,
  payload_ref STRING,
  payload_revision DECIMAL(20, 0),
  payload_requested_purpose STRING,
  CHECK (requested_purpose = server_purpose),
  CHECK (target_event_id <> request_id OR target_event_revision <> request_revision),
  CHECK (payload_tenant_id IS NULL OR payload_tenant_id ~ '^[0-9a-f]{48}$'),
  CHECK (payload_server_purpose IS NULL OR (length(payload_server_purpose) BETWEEN 1 AND 96 AND payload_server_purpose ~ '^[a-z][a-z0-9._:-]*$')),
  CHECK (payload_ref IS NULL OR payload_ref ~ '^[0-9a-f]{48}$'),
  CHECK (payload_revision IS NULL OR payload_revision BETWEEN 1 AND 18446744073709551615),
  CHECK (payload_requested_purpose IS NULL OR (length(payload_requested_purpose) BETWEEN 1 AND 96 AND payload_requested_purpose ~ '^[a-z][a-z0-9._:-]*$')),
  CHECK (payload_tenant_id IS NULL OR payload_tenant_id = tenant_id),
  CHECK (payload_server_purpose IS NULL OR payload_server_purpose = server_purpose),
  CHECK (payload_requested_purpose IS NULL OR payload_requested_purpose = requested_purpose),
  CHECK ((payload_tenant_id IS NULL AND payload_server_purpose IS NULL AND payload_ref IS NULL AND payload_revision IS NULL AND payload_requested_purpose IS NULL) OR (payload_tenant_id IS NOT NULL AND payload_server_purpose IS NOT NULL AND payload_ref IS NOT NULL AND payload_revision IS NOT NULL AND payload_requested_purpose IS NOT NULL)),
  PRIMARY KEY (tenant_id, server_purpose, request_id, request_revision),
  UNIQUE (tenant_id, server_purpose, operation_id, attempt_id),
  FOREIGN KEY (tenant_id) REFERENCES continuity.tenants (tenant_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (tenant_id, server_purpose, target_event_id, target_event_revision, requested_purpose)
    REFERENCES continuity.events (tenant_id, server_purpose, event_id, event_revision, requested_purpose)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (payload_tenant_id, payload_server_purpose, payload_ref, payload_revision, payload_requested_purpose)
    REFERENCES continuity.payload_anchors (tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose)
    MATCH FULL ON DELETE RESTRICT ON UPDATE RESTRICT
);

REVOKE ALL PRIVILEGES ON TABLE continuity.event_revision_requests FROM PUBLIC;
GRANT USAGE ON SCHEMA continuity TO zc_continuity_executor;
GRANT SELECT ON TABLE continuity.event_revision_requests TO zc_continuity_reader;
GRANT SELECT, INSERT ON TABLE continuity.event_revision_requests TO zc_continuity_executor;

ALTER TABLE continuity.event_revision_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.event_revision_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY event_revision_requests_reader_scope
  ON continuity.event_revision_requests
  FOR SELECT
  TO zc_continuity_reader
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY event_revision_requests_executor_select_scope
  ON continuity.event_revision_requests
  FOR SELECT
  TO zc_continuity_executor
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY event_revision_requests_executor_insert_scope
  ON continuity.event_revision_requests
  FOR INSERT
  TO zc_continuity_executor
  WITH CHECK (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

COMMIT;
