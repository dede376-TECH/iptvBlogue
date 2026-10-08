# SEA (paid search) test log

Purpose: validate demand and engagement for a keyword with a small paid test before investing
in a full SEO article. Use the `template: minimal` article variant as the landing page (no
sidebar, no related posts, no ads) and append UTM parameters:

`?utm_source=google&utm_medium=cpc&utm_campaign=<cluster>-test&utm_term=<keyword>`

Decision rules (adjust after the first few tests):

- **Scale in SEO** if avg time on page >= 60 s AND 50 % scroll rate >= 50 % AND CTR is at or
  above the account average.
- **Rewrite** if CTR is fine but engagement is poor (the intent or the page is wrong).
- **Drop** if CTR is poor after enough impressions (low real demand or wrong wording).

GA4 events used: `scroll_depth` (50 / 90), `time_on_page`, `engaged_time`, `click_internal`,
`click_outbound`. All require analytics consent; expect under-reporting and compare relatively.

| Date | Keyword | Cluster | Landing URL | Ad headline / description | Impr. | Clicks | CPC | CTR | Avg time (s) | 50 % scroll | 90 % scroll | Decision | Notes |
| ---- | ------- | ------- | ----------- | ------------------------- | ----- | ------ | --- | --- | ------------ | ----------- | ----------- | -------- | ----- |
|      |         |         |             |                           |       |        |     |     |              |             |             |          |       |
