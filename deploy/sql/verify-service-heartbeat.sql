SELECT EXISTS(
  SELECT 1
  FROM kcml.platform_worker_heartbeat
  WHERE service_name = :'service'
    AND status = 'READY'
    AND expires_at > clock_timestamp()
    AND release_id = :'release'
    AND source_sha = :'sha'
    AND deployment_epoch = :'epoch'::bigint
);
