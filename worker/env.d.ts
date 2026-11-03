// Secrets are not in wrangler.jsonc, so `wrangler types` doesn't know about them.
declare namespace Cloudflare {
  interface Env {
    /** Optional AskPanchang API key (wrangler secret / .dev.vars). */
    ASKPANCHANG_API_KEY?: string;
    /** Cloudflare Access application audience; set as a secret in production only. */
    ACCESS_AUD?: string;
  }
}

declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('./index');
  }
}

// `Env` (global) and `Cloudflare.Env` are separate interfaces in the generated types.
interface Env {
  ASKPANCHANG_API_KEY?: string;
  /** Cloudflare Access application audience; set as a secret in production only. */
  ACCESS_AUD?: string;
}
