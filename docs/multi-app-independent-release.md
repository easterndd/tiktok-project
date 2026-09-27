# Multi-App Independent TikTok Release

## Platform basis

The supplied `TikTok小程序短剧媒资库接入文档.docx` describes client-key authentication, BytePlus VID registration, album version creation, review submission, album query, online-version selection, and listing. Its album authorization API is for one app's reviewed album to play in another app. This workflow does **not** call album authorization: each selected Mini App owns a separate TikTok album, version, review, and publish result.

## Prerequisites

- Each selected Mini App has its own database schema, TikTok Client Key and Secret, and an ACTIVE OWNER administrator with the same email as the operator.
- All selected apps use the configured BytePlus account, space, and region. Source episodes already have distinct BytePlus VIDs, and source cover URLs are public HTTPS URLs.
- A target with rewarded ads enabled has its own rewarded placement ID. The source app's placement ID is never copied to a target.

## Operator flow

1. In the source Mini App's admin, choose the source drama under **Multi-App Independent Release** and select the target apps. Include the source app if it should participate in the batch operation.
2. Click **Prepare targets**. Missing target drafts are created with the same BytePlus VIDs but without TikTok album or episode IDs. Cover and video registration jobs are queued in each target app. Existing target drafts are not overwritten if their source content differs.
3. Once each target's media count and cover are ready, click **Sync version**. Every target creates its own TikTok album/version.
4. Click **Submit review**. Each target submits its own version. Review statuses are reconciled by the worker about every 10 minutes while under review. Use **Reconcile** to query immediately.
5. For apps with a passed review, click **Set online version**, then **Publish**. Inspect each app's status and task errors independently. A failure in one app does not silently count as success for the others.

This workflow is staged, not an automatic publish-on-approval switch. It does not update an existing target drama when the source content changes after preparation; make a new editorial decision rather than overwriting an already-reviewed target. It does not migrate or merge existing independently created target albums.

## Deployment

Build and recreate `api`, `worker`, and `admin`. No database migration is required for this change. Do not omit the worker: it runs per-app platform jobs and periodic review reconciliation.
