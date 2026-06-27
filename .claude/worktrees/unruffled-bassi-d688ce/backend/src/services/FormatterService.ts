export class FormatterService {
  /**
   * Formats the content and ensures it respects platform-specific constraints.
   */
  public formatContent(platform: string, content: string): string {
    let formatted = content;
    
    switch (platform.toLowerCase()) {
      case 'twitter':
      case 'x':
        // Max 280 chars
        if (formatted.length > 280) {
          formatted = formatted.substring(0, 277) + '...';
        }
        break;
      case 'linkedin':
        // Max 3000 chars, no special formatting needed usually
        if (formatted.length > 3000) {
          formatted = formatted.substring(0, 2997) + '...';
        }
        break;
      case 'instagram':
        // Max 2200 chars, max 30 hashtags
        if (formatted.length > 2200) {
          formatted = formatted.substring(0, 2197) + '...';
        }
        // Could implement hashtag truncation here if needed
        break;
      case 'tiktok':
        // Max 2200 chars
        if (formatted.length > 2200) {
          formatted = formatted.substring(0, 2197) + '...';
        }
        break;
      default:
        break;
    }
    
    return formatted;
  }
}

export const formatterService = new FormatterService();
