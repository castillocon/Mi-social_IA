// Secrets y variables solo de desarrollo; las vars de wrangler.jsonc las genera `npm run cf-typegen`.
interface AppSecrets {
  TOKEN_ENC_KEY: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_CONFIG_ID?: string;
  ANTHROPIC_API_KEY?: string;
  DEV_BYPASS_ACCESS?: string;
  DEV_USER_EMAIL?: string;
}
interface Env extends AppSecrets {}
declare namespace Cloudflare {
  interface Env extends AppSecrets {}
}
