/**
 * Error categorization for posting failures.
 * Maps raw error messages to actionable categories so the dashboard can show
 * meaningful breakdowns instead of opaque strings like "read ECONNRESET".
 */

export type ErrorCategory =
  | 'NETWORK_RESET'        // TCP connection reset mid-flight (ECONNRESET, browser closed)
  | 'NETWORK_TIMEOUT'      // Request took too long
  | 'AUTH_EXPIRED'         // Session cookie invalid / Instagram login required
  | 'CHECKPOINT'           // IG flagged account for verification
  | 'RATE_LIMIT'           // IG rate-limited the request
  | 'MEDIA_DOWNLOAD'       // ComfyUI/upload fetch failed
  | 'MEDIA_UPLOAD'         // File chooser / upload step failed
  | 'SELECTOR_NOT_FOUND'   // Instagram UI changed, selector didn't match
  | 'CAPTION_VERIFY'       // Caption didn't get inserted
  | 'PUBLISH_VERIFY'       // Post didn't appear in profile after share
  | 'BROWSER_LAUNCH'       // Playwright context creation failed
  | 'UNKNOWN';

export interface CategorizedError {
  category: ErrorCategory;
  humanReadable: string;
  suggestedAction: string;
  retryable: boolean;
}

const PATTERNS: Array<{ pattern: RegExp; result: Omit<CategorizedError, 'humanReadable'> & { humanReadable: (msg: string) => string } }> = [
  {
    pattern: /ECONNRESET|ECONNREFUSED|socket hang up|connection (was )?reset/i,
    result: {
      category: 'NETWORK_RESET',
      suggestedAction: 'Check network stability. May indicate IP rate-limit. Consider proxy rotation.',
      retryable: true,
      humanReadable: (m) => `Network connection reset by peer (${m.includes('ECONNRESET') ? 'TCP RST' : 'socket drop'})`,
    },
  },
  {
    pattern: /ETIMEDOUT|ESOCKETTIMEDOUT|aborted|timeout/i,
    result: {
      category: 'NETWORK_TIMEOUT',
      suggestedAction: 'Check if IG or ComfyUI is reachable. May be slow connection or service down.',
      retryable: true,
      humanReadable: (m) => `Request timed out`,
    },
  },
  {
    pattern: /Session expired|please re-login|logged_out|login page|NEEDS_RELOGIN/i,
    result: {
      category: 'AUTH_EXPIRED',
      suggestedAction: 'Re-login the account via Farm View. Cookies have expired.',
      retryable: false,
      humanReadable: () => `Instagram session expired — re-login required`,
    },
  },
  {
    pattern: /checkpoint|challenge|suspended|verify your account|confirm your account/i,
    result: {
      category: 'CHECKPOINT',
      suggestedAction: 'Account flagged by Instagram. Manual verification needed in IG app.',
      retryable: false,
      humanReadable: () => `Instagram checkpoint/challenge triggered`,
    },
  },
  {
    pattern: /rate.?limit|try again later|429|too many requests/i,
    result: {
      category: 'RATE_LIMIT',
      suggestedAction: 'Reduce posting frequency. Wait before retrying. Consider proxy rotation.',
      retryable: true,
      humanReadable: () => `Instagram rate-limited the request`,
    },
  },
  {
    pattern: /Download failed for|Timed out downloading media|Failed to download media|ENOTFOUND.*8188|ComfyUI/i,
    result: {
      category: 'MEDIA_DOWNLOAD',
      suggestedAction: 'Check ComfyUI is running on port 8188 and media file exists.',
      retryable: true,
      humanReadable: () => `Failed to download media from ComfyUI`,
    },
  },
  {
    pattern: /file chooser|setInputFiles|upload.*timeout|No valid media file/i,
    result: {
      category: 'MEDIA_UPLOAD',
      suggestedAction: 'Check media file format (jpg/png/webp/mp4) and size (max 50MB).',
      retryable: false,
      humanReadable: () => `Media upload to Instagram failed`,
    },
  },
  {
    pattern: /Could not find.*button|element.*not found|locator.*not found|waitForSelector.*timeout|Timeout.*waiting for/i,
    result: {
      category: 'SELECTOR_NOT_FOUND',
      suggestedAction: 'Instagram UI may have changed. Check if selectors need update.',
      retryable: true,
      humanReadable: (m) => `Instagram UI selector not found (${m.slice(0, 80)})`,
    },
  },
  {
    pattern: /CAPTION_VERIFY_FAILED|caption.*empty|empty before final Share/i,
    result: {
      category: 'CAPTION_VERIFY',
      suggestedAction: 'Caption was not inserted into the post. Check Instagram UI for caption field changes.',
      retryable: true,
      humanReadable: () => `Caption verification failed (text not inserted)`,
    },
  },
  {
    pattern: /FAILED_VERIFY|not visible.*profile|latest.*post.*not.*changed/i,
    result: {
      category: 'PUBLISH_VERIFY',
      suggestedAction: 'Post may have actually published but verification step failed. Check IG profile manually.',
      retryable: false,
      humanReadable: () => `Post publish verification failed (likely succeeded but unconfirmed)`,
    },
  },
  {
    pattern: /getContext|newPage|browser.*context.*closed|chromium.*crash|page.*closed/i,
    result: {
      category: 'BROWSER_LAUNCH',
      suggestedAction: 'Playwright browser context failed to launch. Check memory/disk.',
      retryable: true,
      humanReadable: () => `Browser context failed to initialize`,
    },
  },
];

export function categorizeError(rawMessage: string): CategorizedError {
  for (const { pattern, result } of PATTERNS) {
    if (pattern.test(rawMessage)) {
      return {
        category: result.category,
        humanReadable: result.humanReadable(rawMessage),
        suggestedAction: result.suggestedAction,
        retryable: result.retryable,
      };
    }
  }
  return {
    category: 'UNKNOWN',
    humanReadable: rawMessage.slice(0, 200),
    suggestedAction: 'Unrecognized error pattern. Manual investigation required.',
    retryable: true,
  };
}
