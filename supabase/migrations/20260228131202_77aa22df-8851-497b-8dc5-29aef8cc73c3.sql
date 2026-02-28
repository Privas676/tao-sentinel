-- Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule sync-tmc-minutely every 5 minutes
SELECT cron.schedule(
  'sync-tmc-every-5min',
  '*/5 * * * *',
  $$
  SELECT extensions.http(
    (
      'POST',
      net._urlencode(current_setting('app.settings.service_url') || '/functions/v1/sync-tmc-minutely'),
      ARRAY[
        ('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'))::extensions.http_header
      ],
      'application/json',
      '{}'
    )::extensions.http_request
  );
  $$
);