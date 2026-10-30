export type Env = {
  DB: D1Database
  MEDIA: R2Bucket
  ASSETS: Fetcher
  SITE_URL: string
  SITE_NAME: string
  PAGE_CACHE_SECONDS: string
  BACKUP_KEEP_DAILY: string
  BACKUP_KEEP_MONTHLY: string
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
  ADMIN_EMAIL: string
  // Read counting (src/stats.ts). READS is the Analytics Engine dataset; the token, with
  // Account Analytics Read, lets the nightly job query it. Without the token the job does nothing.
  READS?: AnalyticsEngineDataset
  CF_ACCOUNT_ID: string
  AE_API_TOKEN?: string
  // Nightly backup (src/backup.ts). The token needs D1 export permission; without it the job does nothing.
  D1_DATABASE_ID: string
  D1_EXPORT_TOKEN?: string
  // Set only in .dev.vars; see src/admin/access.ts.
  ADMIN_DEV_BYPASS?: string
}
