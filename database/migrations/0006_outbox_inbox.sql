BEGIN;

CREATE TABLE continuity.outbox_messages (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (length(server_purpose) BETWEEN 1 AND 96 AND server_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  message_id STRING NOT NULL CHECK (message_id ~ '^[0-9a-f]{48}$'),
  message_revision DECIMAL(20, 0) NOT NULL CHECK (message_revision BETWEEN 1 AND 18446744073709551615),
  previous_message_revision DECIMAL(20, 0) NOT NULL CHECK (previous_message_revision BETWEEN 0 AND 18446744073709551615),
  record_schema_version STRING NOT NULL CHECK (record_schema_version = 'zc.internal.outbox-message.v1'),
  record_family STRING NOT NULL CHECK (record_family = 'outbox_message'),
  requested_purpose STRING NOT NULL CHECK (length(requested_purpose) BETWEEN 1 AND 96 AND requested_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  operation_id STRING NOT NULL CHECK (operation_id ~ '^[0-9a-f]{48}$'),
  attempt_id STRING NOT NULL CHECK (attempt_id ~ '^[0-9a-f]{48}$'),
  message_type STRING NOT NULL CHECK (length(message_type) BETWEEN 1 AND 64 AND message_type ~ '^[a-z][a-z0-9._:-]*$'),
  operation_name STRING NOT NULL CHECK (length(operation_name) BETWEEN 1 AND 64 AND operation_name ~ '^[a-z][a-z0-9._:-]*$'),
  payload_ref STRING NOT NULL CHECK (payload_ref ~ '^[0-9a-f]{48}$'),
  payload_revision DECIMAL(20, 0) NOT NULL CHECK (payload_revision BETWEEN 1 AND 18446744073709551615),
  occurred_at TIMESTAMPTZ NOT NULL,
  predecessor_message_revision DECIMAL(20, 0) AS (
    CASE WHEN previous_message_revision = 0 THEN NULL ELSE previous_message_revision END
  ) STORED,
  CHECK (requested_purpose = server_purpose),
  CHECK (message_revision > previous_message_revision),
  CHECK (operation_id <> message_id),
  UNIQUE (tenant_id, server_purpose, message_id, previous_message_revision),
  CHECK (
    (previous_message_revision = 0 AND predecessor_message_revision IS NULL)
    OR (previous_message_revision > 0 AND predecessor_message_revision = previous_message_revision)
  ),
  PRIMARY KEY (tenant_id, server_purpose, message_id, message_revision),
  UNIQUE (tenant_id, server_purpose, operation_id, attempt_id),
  FOREIGN KEY (tenant_id) REFERENCES continuity.tenants (tenant_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose)
    REFERENCES continuity.payload_anchors (tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (tenant_id, server_purpose, message_id, predecessor_message_revision)
    REFERENCES continuity.outbox_messages (tenant_id, server_purpose, message_id, message_revision)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.outbox_deliveries (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (length(server_purpose) BETWEEN 1 AND 96 AND server_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  message_id STRING NOT NULL CHECK (message_id ~ '^[0-9a-f]{48}$'),
  message_revision DECIMAL(20, 0) NOT NULL CHECK (message_revision BETWEEN 1 AND 18446744073709551615),
  delivery_status STRING NOT NULL CHECK (delivery_status IN ('pending', 'claimed', 'acked', 'dead')),
  attempt_count DECIMAL(20, 0) NOT NULL CHECK (attempt_count BETWEEN 0 AND 18446744073709551615),
  fence_token STRING NOT NULL CHECK (fence_token ~ '^[0-9a-f]{48}$'),
  consumer_id STRING NOT NULL CHECK (consumer_id ~ '^[0-9a-f]{48}$'),
  lease_expires_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (
    (delivery_status = 'pending' AND consumer_id = '000000000000000000000000000000000000000000000000')
    OR (delivery_status <> 'pending')
  ),
  CHECK (
    (delivery_status = 'claimed' AND lease_expires_at IS NOT NULL)
    OR (delivery_status <> 'claimed' AND lease_expires_at IS NULL)
  ),
  PRIMARY KEY (tenant_id, server_purpose, message_id, message_revision),
  FOREIGN KEY (tenant_id, server_purpose, message_id, message_revision)
    REFERENCES continuity.outbox_messages (tenant_id, server_purpose, message_id, message_revision)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.inbox_receipts (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (length(server_purpose) BETWEEN 1 AND 96 AND server_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  consumer_id STRING NOT NULL CHECK (consumer_id ~ '^[0-9a-f]{48}$'),
  message_id STRING NOT NULL CHECK (message_id ~ '^[0-9a-f]{48}$'),
  message_revision DECIMAL(20, 0) NOT NULL CHECK (message_revision BETWEEN 1 AND 18446744073709551615),
  claim_attempt_count DECIMAL(20, 0) NOT NULL CHECK (claim_attempt_count BETWEEN 1 AND 18446744073709551615),
  claim_fence_token STRING NOT NULL CHECK (claim_fence_token ~ '^[0-9a-f]{48}$'),
  record_schema_version STRING NOT NULL CHECK (record_schema_version = 'zc.internal.inbox-receipt.v1'),
  record_family STRING NOT NULL CHECK (record_family = 'inbox_receipt'),
  requested_purpose STRING NOT NULL CHECK (length(requested_purpose) BETWEEN 1 AND 96 AND requested_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  received_at TIMESTAMPTZ NOT NULL,
  CHECK (requested_purpose = server_purpose),
  PRIMARY KEY (tenant_id, server_purpose, consumer_id, message_id, message_revision, claim_attempt_count),
  FOREIGN KEY (tenant_id) REFERENCES continuity.tenants (tenant_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (tenant_id, server_purpose, message_id, message_revision)
    REFERENCES continuity.outbox_messages (tenant_id, server_purpose, message_id, message_revision)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE ROLE zc_continuity_transition_owner
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
GRANT zc_continuity_transition_owner TO admin;

REVOKE ALL PRIVILEGES ON TABLE continuity.outbox_messages FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.outbox_deliveries FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.inbox_receipts FROM PUBLIC;
GRANT USAGE ON SCHEMA continuity TO zc_continuity_executor;
GRANT SELECT ON TABLE continuity.outbox_messages TO zc_continuity_reader;
GRANT SELECT ON TABLE continuity.outbox_deliveries TO zc_continuity_reader;
GRANT SELECT ON TABLE continuity.inbox_receipts TO zc_continuity_reader;
GRANT SELECT, INSERT ON TABLE continuity.outbox_messages TO zc_continuity_executor;
GRANT SELECT ON TABLE continuity.outbox_deliveries TO zc_continuity_executor;
GRANT SELECT ON TABLE continuity.inbox_receipts TO zc_continuity_executor;
GRANT USAGE ON SCHEMA continuity TO zc_continuity_transition_owner;
GRANT CREATE ON SCHEMA continuity TO zc_continuity_transition_owner;
GRANT SELECT, INSERT, UPDATE ON TABLE continuity.outbox_deliveries TO zc_continuity_transition_owner;
GRANT SELECT, INSERT ON TABLE continuity.inbox_receipts TO zc_continuity_transition_owner;

ALTER TABLE continuity.outbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.outbox_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.outbox_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.outbox_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.inbox_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.inbox_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY outbox_messages_reader_scope
  ON continuity.outbox_messages
  FOR SELECT
  TO zc_continuity_reader
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY outbox_messages_executor_select_scope
  ON continuity.outbox_messages
  FOR SELECT
  TO zc_continuity_executor
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY outbox_messages_executor_insert_scope
  ON continuity.outbox_messages
  FOR INSERT
  TO zc_continuity_executor
  WITH CHECK (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
    AND requested_purpose = server_purpose
  );

CREATE POLICY outbox_deliveries_reader_scope
  ON continuity.outbox_deliveries
  FOR SELECT
  TO zc_continuity_reader
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY outbox_deliveries_executor_select_scope
  ON continuity.outbox_deliveries
  FOR SELECT
  TO zc_continuity_executor
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY outbox_deliveries_transition_owner_scope
  ON continuity.outbox_deliveries
  FOR ALL
  TO zc_continuity_transition_owner
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  )
  WITH CHECK (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY inbox_receipts_reader_scope
  ON continuity.inbox_receipts
  FOR SELECT
  TO zc_continuity_reader
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY inbox_receipts_executor_select_scope
  ON continuity.inbox_receipts
  FOR SELECT
  TO zc_continuity_executor
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY inbox_receipts_transition_owner_scope
  ON continuity.inbox_receipts
  FOR ALL
  TO zc_continuity_transition_owner
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
    AND consumer_id = current_setting('continuity.consumer_id', true)
  )
  WITH CHECK (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
    AND consumer_id = current_setting('continuity.consumer_id', true)
  );

CREATE FUNCTION continuity.claim_outbox_delivery(
  p_lease INTERVAL
)
RETURNS TABLE (
  message_id STRING,
  message_revision DECIMAL(20, 0),
  attempt_count DECIMAL(20, 0),
  fence_token STRING
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH candidate AS (
    SELECT tenant_id, server_purpose, message_id, message_revision
    FROM continuity.outbox_deliveries
    WHERE tenant_id = current_setting('continuity.tenant_id', true)
      AND server_purpose = current_setting('continuity.server_purpose', true)
      AND (delivery_status = 'pending' OR (delivery_status = 'claimed' AND lease_expires_at <= CURRENT_TIMESTAMP))
    ORDER BY updated_at, message_id, message_revision
    LIMIT 1
  )
  UPDATE continuity.outbox_deliveries AS delivery
  SET delivery_status = 'claimed',
      attempt_count = delivery.attempt_count + 1,
      consumer_id = current_setting('continuity.consumer_id', true),
      fence_token = left(replace(gen_random_uuid()::STRING, '-', '') || replace(gen_random_uuid()::STRING, '-', ''), 48),
      lease_expires_at = CURRENT_TIMESTAMP + p_lease,
      updated_at = CURRENT_TIMESTAMP
  FROM candidate
  WHERE delivery.tenant_id = candidate.tenant_id
    AND delivery.server_purpose = candidate.server_purpose
    AND delivery.message_id = candidate.message_id
    AND delivery.message_revision = candidate.message_revision
    AND (delivery.delivery_status = 'pending' OR (delivery.delivery_status = 'claimed' AND delivery.lease_expires_at <= CURRENT_TIMESTAMP))
    AND p_lease BETWEEN '1 second'::INTERVAL AND '5 minutes'::INTERVAL
    AND current_setting('continuity.consumer_id', true) ~ '^[0-9a-f]{48}$'
  RETURNING delivery.message_id, delivery.message_revision, delivery.attempt_count, delivery.fence_token
$$;

CREATE FUNCTION continuity.record_outbox_inbox(
  p_message_id STRING,
  p_message_revision DECIMAL(20, 0),
  p_claim_attempt_count DECIMAL(20, 0),
  p_claim_fence_token STRING
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH inserted AS (
    INSERT INTO continuity.inbox_receipts (
      tenant_id, server_purpose, consumer_id, message_id, message_revision, claim_attempt_count, claim_fence_token,
      record_schema_version, record_family, requested_purpose, received_at
    )
    SELECT delivery.tenant_id, delivery.server_purpose, delivery.consumer_id,
      delivery.message_id, delivery.message_revision, delivery.attempt_count, delivery.fence_token,
      'zc.internal.inbox-receipt.v1', 'inbox_receipt', delivery.server_purpose, CURRENT_TIMESTAMP
    FROM continuity.outbox_deliveries AS delivery
    WHERE delivery.tenant_id = current_setting('continuity.tenant_id', true)
      AND delivery.server_purpose = current_setting('continuity.server_purpose', true)
      AND delivery.consumer_id = current_setting('continuity.consumer_id', true)
      AND delivery.message_id = p_message_id
      AND delivery.message_revision = p_message_revision
      AND delivery.attempt_count = p_claim_attempt_count
      AND delivery.fence_token = p_claim_fence_token
      AND delivery.delivery_status = 'claimed'
      AND delivery.lease_expires_at > CURRENT_TIMESTAMP
    ON CONFLICT DO NOTHING
    RETURNING TRUE
  )
  SELECT EXISTS (SELECT 1 FROM inserted)
    OR EXISTS (
      SELECT 1 FROM continuity.inbox_receipts AS receipt
      WHERE receipt.tenant_id = current_setting('continuity.tenant_id', true)
        AND receipt.server_purpose = current_setting('continuity.server_purpose', true)
        AND receipt.consumer_id = current_setting('continuity.consumer_id', true)
        AND receipt.message_id = p_message_id
        AND receipt.message_revision = p_message_revision
        AND receipt.claim_attempt_count = p_claim_attempt_count
        AND receipt.claim_fence_token = p_claim_fence_token
    )
$$;

CREATE FUNCTION continuity.acknowledge_outbox_delivery(
  p_message_id STRING,
  p_message_revision DECIMAL(20, 0),
  p_attempt_count DECIMAL(20, 0),
  p_fence_token STRING
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH acknowledged AS (
    UPDATE continuity.outbox_deliveries AS delivery
    SET delivery_status = 'acked', lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE delivery.tenant_id = current_setting('continuity.tenant_id', true)
      AND delivery.server_purpose = current_setting('continuity.server_purpose', true)
      AND delivery.consumer_id = current_setting('continuity.consumer_id', true)
      AND delivery.message_id = p_message_id
      AND delivery.message_revision = p_message_revision
      AND delivery.attempt_count = p_attempt_count
      AND delivery.fence_token = p_fence_token
      AND delivery.delivery_status = 'claimed'
      AND delivery.lease_expires_at > CURRENT_TIMESTAMP
      AND EXISTS (
        SELECT 1 FROM continuity.inbox_receipts AS receipt
        WHERE receipt.tenant_id = delivery.tenant_id
          AND receipt.server_purpose = delivery.server_purpose
          AND receipt.consumer_id = delivery.consumer_id
          AND receipt.message_id = delivery.message_id
          AND receipt.message_revision = delivery.message_revision
          AND receipt.claim_attempt_count = delivery.attempt_count
          AND receipt.claim_fence_token = delivery.fence_token
      )
    RETURNING TRUE
  )
  SELECT EXISTS (SELECT 1 FROM acknowledged)
$$;

ALTER FUNCTION continuity.claim_outbox_delivery(INTERVAL) OWNER TO zc_continuity_transition_owner;
ALTER FUNCTION continuity.record_outbox_inbox(STRING, DECIMAL, DECIMAL, STRING) OWNER TO zc_continuity_transition_owner;
ALTER FUNCTION continuity.acknowledge_outbox_delivery(STRING, DECIMAL, DECIMAL, STRING) OWNER TO zc_continuity_transition_owner;
REVOKE CREATE ON SCHEMA continuity FROM zc_continuity_transition_owner;
REVOKE ALL ON FUNCTION continuity.claim_outbox_delivery(INTERVAL) FROM PUBLIC;
REVOKE ALL ON FUNCTION continuity.record_outbox_inbox(STRING, DECIMAL, DECIMAL, STRING) FROM PUBLIC;
REVOKE ALL ON FUNCTION continuity.acknowledge_outbox_delivery(STRING, DECIMAL, DECIMAL, STRING) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION continuity.claim_outbox_delivery(INTERVAL) TO zc_continuity_executor;
GRANT EXECUTE ON FUNCTION continuity.record_outbox_inbox(STRING, DECIMAL, DECIMAL, STRING) TO zc_continuity_executor;
GRANT EXECUTE ON FUNCTION continuity.acknowledge_outbox_delivery(STRING, DECIMAL, DECIMAL, STRING) TO zc_continuity_executor;

COMMIT;
