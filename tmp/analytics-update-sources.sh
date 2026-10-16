set -eu
cd /opt/quickreels
cp /tmp/analytics-summary.service.ts apps/api/src/services/analytics-summary.service.ts
cp /tmp/analytics-worker.ts apps/api/src/jobs/tiktok-short-drama.worker.ts
