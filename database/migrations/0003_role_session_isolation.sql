BEGIN;

CREATE ROLE zc_continuity_reader
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;

CREATE ROLE zc_continuity_executor
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;

REVOKE ALL PRIVILEGES ON SCHEMA continuity FROM PUBLIC;

REVOKE ALL PRIVILEGES ON TABLE continuity.tenants FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.payload_anchors FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.events FROM PUBLIC;

GRANT USAGE ON SCHEMA continuity TO zc_continuity_reader;

GRANT SELECT ON TABLE continuity.tenants TO zc_continuity_reader;
GRANT SELECT ON TABLE continuity.payload_anchors TO zc_continuity_reader;
GRANT SELECT ON TABLE continuity.events TO zc_continuity_reader;

ALTER TABLE continuity.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.tenants FORCE ROW LEVEL SECURITY;

ALTER TABLE continuity.payload_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.payload_anchors FORCE ROW LEVEL SECURITY;

ALTER TABLE continuity.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_reader_scope
  ON continuity.tenants
  FOR SELECT
  TO zc_continuity_reader
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
  );

CREATE POLICY payload_anchors_reader_scope
  ON continuity.payload_anchors
  FOR SELECT
  TO zc_continuity_reader
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY events_reader_scope
  ON continuity.events
  FOR SELECT
  TO zc_continuity_reader
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

COMMIT;
