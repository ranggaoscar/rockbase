export interface PostJobData {
  postId: string;
  accountId: string;
  campaignId?: string;
  campaignActionId?: string;
  postType?: 'reel';
  content: string;
  mediaLocalPath?: string;
  mediaUrls: string[];
  spinIndex: number;
}

export interface SocialPostingJob {
  postId: string;
  image_url: string;
  caption: string;
  account_ids: string[];
  scheduled_time?: string;
}

