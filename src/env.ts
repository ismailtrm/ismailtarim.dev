export type Env = {
  DB: D1Database
  MEDIA: R2Bucket
  ASSETS: Fetcher
  SITE_URL: string
  SITE_NAME: string
  PAGE_CACHE_SECONDS: string
  BACKUP_KEEP_DAILY: string
  BACKUP_KEEP_MONTHLY: string
}
