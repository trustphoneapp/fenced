-- Forward-only, additive read grants required by CockroachDB foreign-key semantics.
--
-- CockroachDB validates a foreign key inside the query plan of the writing statement, so a role
-- that INSERTs into a child table must also hold SELECT on the referenced parent. PostgreSQL runs
-- the same check with the table owner's rights, which is why 0008 defined the write grants without
-- these reads and still passed static review. Live execution fails with 42501:
--   INSERT continuity.hackathon_sessions ->
--     user zc_continuity_session_issuer does not have SELECT privilege on relation tenants
--
-- Least privilege is preserved: SELECT only, and only on the two parent relations the hackathon
-- write path actually references. The E2 gaps on continuity.events and continuity.payload_anchors
-- are deliberately NOT granted here, because the hackathon path never writes those children and
-- those parents hold encrypted payload material.
GRANT SELECT ON TABLE continuity.tenants TO zc_continuity_session_issuer;
GRANT SELECT ON TABLE continuity.hackathon_provider_usage TO zc_continuity_session_issuer;
GRANT SELECT ON TABLE continuity.hackathon_provider_usage TO zc_continuity_reservation_writer;
