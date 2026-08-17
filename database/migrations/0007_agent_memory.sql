BEGIN;

-- Retraction contract: retracting a fact updates EVERY retained revision row
-- of that fact to fact_status = 'retracted' with content = '' in the same
-- transaction; embeddings of retracted revisions are erased by the H2 sweep.

CREATE TABLE continuity.memory_facts (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (length(server_purpose) BETWEEN 1 AND 96 AND server_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  fact_id STRING NOT NULL CHECK (fact_id ~ '^[0-9a-f]{48}$'),
  fact_revision DECIMAL(20, 0) NOT NULL CHECK (fact_revision BETWEEN 1 AND 18446744073709551615),
  record_schema_version STRING NOT NULL CHECK (record_schema_version = 'zc.internal.memory-fact.v1'),
  record_family STRING NOT NULL CHECK (record_family = 'memory_fact'),
  requested_purpose STRING NOT NULL CHECK (length(requested_purpose) BETWEEN 1 AND 96 AND requested_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  sensitivity STRING NOT NULL CHECK (sensitivity IN ('public', 'restricted')),
  fact_status STRING NOT NULL CHECK (fact_status IN ('active', 'retracted')),
  content STRING NOT NULL,
  embedding VECTOR(1024) NOT NULL,
  embedding_space STRING NOT NULL CHECK (embedding_space IN ('zc.bedrock-titan-v2.1024', 'zc.synthetic-fixture.v2.1024')),
  source_ref STRING NOT NULL CHECK (source_ref ~ '^[0-9a-f]{48}$'),
  occurred_at TIMESTAMPTZ NOT NULL,
  CHECK (requested_purpose = server_purpose),
  CHECK (
    (fact_status = 'retracted' AND content = '')
    OR (fact_status = 'active' AND length(content) BETWEEN 1 AND 2048)
  ),
  PRIMARY KEY (tenant_id, server_purpose, fact_id, fact_revision),
  UNIQUE (tenant_id, server_purpose, fact_id, fact_revision, fact_status),
  FOREIGN KEY (tenant_id) REFERENCES continuity.tenants (tenant_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE VECTOR INDEX memory_facts_embedding_cosine
  ON continuity.memory_facts (tenant_id, server_purpose, embedding vector_cosine_ops);

CREATE TABLE continuity.disclosure_receipts (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (length(server_purpose) BETWEEN 1 AND 96 AND server_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  receipt_id STRING NOT NULL CHECK (receipt_id ~ '^[0-9a-f]{48}$'),
  record_schema_version STRING NOT NULL CHECK (record_schema_version = 'zc.internal.disclosure-receipt.v1'),
  record_family STRING NOT NULL CHECK (record_family = 'disclosure_receipt'),
  requested_purpose STRING NOT NULL CHECK (length(requested_purpose) BETWEEN 1 AND 96 AND requested_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  access_tier STRING NOT NULL CHECK (access_tier IN ('standard', 'privileged')),
  policy_version STRING NOT NULL CHECK (policy_version = 'zc.recall-policy.v1'),
  embedding_space STRING NOT NULL CHECK (embedding_space IN ('zc.bedrock-titan-v2.1024', 'zc.synthetic-fixture.v2.1024')),
  recalled_entries JSONB NOT NULL,
  withheld_entries JSONB NOT NULL,
  asked_at TIMESTAMPTZ NOT NULL,
  CHECK (requested_purpose = server_purpose),
  CHECK (json_typeof(recalled_entries) = 'array'),
  CHECK (json_typeof(withheld_entries) = 'array'),
  PRIMARY KEY (tenant_id, server_purpose, receipt_id),
  FOREIGN KEY (tenant_id) REFERENCES continuity.tenants (tenant_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.memory_propagations (
  tenant_id STRING NOT NULL CHECK (tenant_id ~ '^[0-9a-f]{48}$'),
  server_purpose STRING NOT NULL CHECK (length(server_purpose) BETWEEN 1 AND 96 AND server_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  fact_id STRING NOT NULL CHECK (fact_id ~ '^[0-9a-f]{48}$'),
  from_revision DECIMAL(20, 0) NOT NULL CHECK (from_revision BETWEEN 1 AND 18446744073709551615),
  to_revision DECIMAL(20, 0) NOT NULL CHECK (to_revision BETWEEN 0 AND 18446744073709551615),
  record_schema_version STRING NOT NULL CHECK (record_schema_version = 'zc.internal.memory-propagation.v1'),
  record_family STRING NOT NULL CHECK (record_family = 'memory_propagation'),
  requested_purpose STRING NOT NULL CHECK (length(requested_purpose) BETWEEN 1 AND 96 AND requested_purpose ~ '^[a-z][a-z0-9._:-]*$'),
  disposition STRING NOT NULL CHECK (disposition IN ('supersede', 'retract')),
  occurred_at TIMESTAMPTZ NOT NULL,
  successor_fact_revision DECIMAL(20, 0) AS (
    CASE WHEN to_revision = 0 THEN NULL ELSE to_revision END
  ) STORED,
  retracted_fact_revision DECIMAL(20, 0) AS (
    CASE WHEN disposition = 'retract' THEN from_revision ELSE NULL END
  ) STORED,
  retracted_fact_status STRING AS (
    CASE WHEN disposition = 'retract' THEN 'retracted' ELSE NULL END
  ) STORED,
  CHECK (requested_purpose = server_purpose),
  CHECK (
    (disposition = 'retract' AND to_revision = 0)
    OR (disposition = 'supersede' AND to_revision = from_revision + 1)
  ),
  CHECK (
    (to_revision = 0 AND successor_fact_revision IS NULL)
    OR (to_revision > 0 AND successor_fact_revision = to_revision)
  ),
  PRIMARY KEY (tenant_id, server_purpose, fact_id, from_revision),
  FOREIGN KEY (tenant_id) REFERENCES continuity.tenants (tenant_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (tenant_id, server_purpose, fact_id, from_revision)
    REFERENCES continuity.memory_facts (tenant_id, server_purpose, fact_id, fact_revision)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (tenant_id, server_purpose, fact_id, successor_fact_revision)
    REFERENCES continuity.memory_facts (tenant_id, server_purpose, fact_id, fact_revision)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- A retract propagation can only exist while its referenced fact revision is
  -- already in 'retracted' state (content erased by the memory_facts CHECK);
  -- ON UPDATE RESTRICT then freezes that revision in the retracted state.
  -- NULL computed components skip this FK for supersede rows.
  FOREIGN KEY (tenant_id, server_purpose, fact_id, retracted_fact_revision, retracted_fact_status)
    REFERENCES continuity.memory_facts (tenant_id, server_purpose, fact_id, fact_revision, fact_status)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

REVOKE ALL PRIVILEGES ON TABLE continuity.memory_facts FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.disclosure_receipts FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.memory_propagations FROM PUBLIC;
-- Reader sees receipts and ID-only propagations only. Plaintext memory_facts
-- (including restricted content and embeddings) stay executor-only so Managed
-- MCP / read-only paths cannot bypass the application disclosure gate.
GRANT SELECT ON TABLE continuity.disclosure_receipts TO zc_continuity_reader;
GRANT SELECT ON TABLE continuity.memory_propagations TO zc_continuity_reader;
GRANT SELECT, INSERT, UPDATE ON TABLE continuity.memory_facts TO zc_continuity_executor;
GRANT SELECT, INSERT ON TABLE continuity.disclosure_receipts TO zc_continuity_executor;
GRANT SELECT, INSERT ON TABLE continuity.memory_propagations TO zc_continuity_executor;

ALTER TABLE continuity.memory_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.memory_facts FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.disclosure_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.disclosure_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE continuity.memory_propagations ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.memory_propagations FORCE ROW LEVEL SECURITY;

CREATE POLICY memory_facts_executor_select_scope
  ON continuity.memory_facts
  FOR SELECT
  TO zc_continuity_executor
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY memory_facts_executor_write_scope
  ON continuity.memory_facts
  FOR ALL
  TO zc_continuity_executor
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
    AND requested_purpose = server_purpose
  );

CREATE POLICY disclosure_receipts_reader_scope
  ON continuity.disclosure_receipts
  FOR SELECT
  TO zc_continuity_reader
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY disclosure_receipts_executor_select_scope
  ON continuity.disclosure_receipts
  FOR SELECT
  TO zc_continuity_executor
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY disclosure_receipts_executor_insert_scope
  ON continuity.disclosure_receipts
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

CREATE POLICY memory_propagations_reader_scope
  ON continuity.memory_propagations
  FOR SELECT
  TO zc_continuity_reader
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY memory_propagations_executor_select_scope
  ON continuity.memory_propagations
  FOR SELECT
  TO zc_continuity_executor
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY memory_propagations_executor_insert_scope
  ON continuity.memory_propagations
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

COMMIT;
