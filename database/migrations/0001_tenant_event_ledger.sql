BEGIN;

CREATE SCHEMA continuity;

CREATE TABLE continuity.tenants (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  PRIMARY KEY (tenant_id)
);

CREATE TABLE continuity.payload_anchors (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  payload_ref STRING NOT NULL CHECK (payload_ref ~ '^[0-9a-f]{48}$'),
  payload_revision DECIMAL(20, 0) NOT NULL CHECK (payload_revision >= 1 AND payload_revision <= 18446744073709551615),
  requested_purpose STRING NOT NULL CHECK (length(requested_purpose) BETWEEN 1 AND 96 AND requested_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  server_purpose STRING NOT NULL CHECK (length(server_purpose) BETWEEN 1 AND 96 AND server_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  PRIMARY KEY (tenant_id, payload_ref, payload_revision),
  UNIQUE (tenant_id, payload_ref, payload_revision, requested_purpose, server_purpose),
  FOREIGN KEY (tenant_id) REFERENCES continuity.tenants (tenant_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.events (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  event_id STRING NOT NULL CHECK (event_id ~ '^[0-9a-f]{48}$'),
  event_revision DECIMAL(20, 0) NOT NULL CHECK (event_revision >= 1 AND event_revision <= 18446744073709551615),
  schema_version STRING NOT NULL CHECK (schema_version = 'zc.contracts.v1'),
  requested_purpose STRING NOT NULL CHECK (length(requested_purpose) BETWEEN 1 AND 96 AND requested_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  server_purpose STRING NOT NULL CHECK (length(server_purpose) BETWEEN 1 AND 96 AND server_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  operation_id STRING NOT NULL CHECK (operation_id ~ '^[0-9a-f]{48}$'),
  attempt_id STRING NOT NULL CHECK (attempt_id ~ '^[0-9a-f]{48}$'),
  event_type STRING NOT NULL CHECK (event_type IN (
    'interaction.appended',
    'memory.revision.recorded',
    'response.recorded',
    'task.checkpointed'
  )),
  occurred_at TIMESTAMPTZ NOT NULL,
  subject_ref STRING NOT NULL CHECK (subject_ref ~ '^[0-9a-f]{48}$'),
  payload_tenant_id STRING,
  payload_ref STRING,
  payload_revision DECIMAL(20, 0),
  payload_requested_purpose STRING,
  payload_server_purpose STRING,
  causation_id STRING,
  correlation_id STRING,
  CHECK (payload_tenant_id IS NULL OR payload_tenant_id ~ '^[0-9a-f]{48}$'),
  CHECK (payload_ref IS NULL OR payload_ref ~ '^[0-9a-f]{48}$'),
  CHECK (payload_revision IS NULL OR (payload_revision >= 1 AND payload_revision <= 18446744073709551615)),
  CHECK (payload_requested_purpose IS NULL OR (length(payload_requested_purpose) BETWEEN 1 AND 96 AND payload_requested_purpose ~ '^[a-z][a-z0-9._:-]*$')),
  CHECK (payload_server_purpose IS NULL OR (length(payload_server_purpose) BETWEEN 1 AND 96 AND payload_server_purpose ~ '^[a-z][a-z0-9._:-]*$')),
  CHECK (causation_id IS NULL OR causation_id ~ '^[0-9a-f]{48}$'),
  CHECK (correlation_id IS NULL OR correlation_id ~ '^[0-9a-f]{48}$'),
  CHECK (payload_tenant_id IS NULL OR payload_tenant_id = tenant_id),
  CHECK (payload_requested_purpose IS NULL OR payload_requested_purpose = requested_purpose),
  CHECK (payload_server_purpose IS NULL OR payload_server_purpose = server_purpose),
  CHECK ((payload_tenant_id IS NULL AND payload_ref IS NULL AND payload_revision IS NULL AND payload_requested_purpose IS NULL AND payload_server_purpose IS NULL) OR (payload_tenant_id IS NOT NULL AND payload_ref IS NOT NULL AND payload_revision IS NOT NULL AND payload_requested_purpose IS NOT NULL AND payload_server_purpose IS NOT NULL)),
  PRIMARY KEY (tenant_id, event_id, event_revision),
  FOREIGN KEY (tenant_id) REFERENCES continuity.tenants (tenant_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (payload_tenant_id, payload_ref, payload_revision, payload_requested_purpose, payload_server_purpose)
    REFERENCES continuity.payload_anchors (tenant_id, payload_ref, payload_revision, requested_purpose, server_purpose)
    MATCH FULL ON DELETE RESTRICT ON UPDATE RESTRICT
);

COMMIT;
