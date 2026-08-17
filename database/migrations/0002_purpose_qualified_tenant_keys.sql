BEGIN;

ALTER TABLE continuity.events
  DROP CONSTRAINT events_payload_tenant_id_payload_ref_payload_revision_payload_requested_purpose_payload_server_purpose_fkey;

ALTER TABLE continuity.events
  DROP CONSTRAINT events_pkey;

ALTER TABLE continuity.payload_anchors
  DROP CONSTRAINT payload_anchors_pkey;

ALTER TABLE continuity.payload_anchors
  DROP CONSTRAINT payload_anchors_tenant_id_payload_ref_payload_revision_requested_purpose_server_purpose_key;

ALTER TABLE continuity.payload_anchors
  ADD CONSTRAINT payload_anchors_purpose_pkey
  PRIMARY KEY (tenant_id, server_purpose, payload_ref, payload_revision);

ALTER TABLE continuity.payload_anchors
  ADD CONSTRAINT payload_anchors_purpose_requested_key
  UNIQUE (tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose);

ALTER TABLE continuity.events
  ADD CONSTRAINT events_purpose_pkey
  PRIMARY KEY (tenant_id, server_purpose, event_id, event_revision);

ALTER TABLE continuity.events
  ADD CONSTRAINT events_payload_purpose_fkey
  FOREIGN KEY (
    payload_tenant_id,
    payload_server_purpose,
    payload_ref,
    payload_revision,
    payload_requested_purpose
  ) REFERENCES continuity.payload_anchors (
    tenant_id,
    server_purpose,
    payload_ref,
    payload_revision,
    requested_purpose
  ) MATCH FULL ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
