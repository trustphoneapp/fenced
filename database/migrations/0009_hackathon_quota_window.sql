BEGIN;

CREATE OR REPLACE VIEW continuity.hackathon_usage_summary_v1 AS SELECT
  count(session.tenant_id) FILTER (
    WHERE session.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
  )::INT8 AS public_sessions,
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
REVOKE ALL PRIVILEGES ON continuity.hackathon_usage_summary_v1 FROM PUBLIC;
GRANT SELECT ON continuity.hackathon_usage_summary_v1
  TO zc_continuity_session_issuer, zc_continuity_reservation_writer;

COMMIT;
