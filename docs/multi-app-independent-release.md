# Multi-App Independent TikTok Release

## Platform basis

The supplied `TikTok小程序短剧媒资库接入文档.docx` describes client-key authentication, BytePlus VID registration, album version creation, review submission, album query, online-version selection, and listing. Its album authorization API is for one app's reviewed album to play in another app. This workflow does **not** call album authorization: each selected Mini App owns a separate TikTok album, version, review, and publish result. The document does not guarantee that a VID already registered under one Mini App's media scope can be registered under another. TikTok has returned `video already exists with a different media scope` for that exact case; do not retry the same VID or treat reuse across client keys as supported without provider confirmation.

## Prerequisites

- Each selected Mini App has its own database schema, TikTok Client Key and Secret, and an ACTIVE OWNER administrator. The same email can be used across apps. For different emails, sign in as the target app's OWNER in the same browser tab, then switch back to the source app; the target session is verified for that app, role, status, and token version before any cross-app operation.
- All selected apps use the configured BytePlus account, space, and region. Source episodes already have distinct BytePlus VIDs, and source cover URLs are public HTTPS URLs.
- A target with rewarded ads enabled has its own rewarded placement ID. The source app's placement ID is never copied to a target.
- Independent URL uploads require public HTTPS download URLs for the original video files, without cookies or account passwords. Do not use an HLS/m3u8 playback URL or a cloud-drive HTML sharing page. URLs must remain valid while the worker submits them and TikTok downloads the file. Local uploads currently discard their temporary original file, so the system cannot automatically derive these URLs from the source VID. If only local MP4 files are available, first provide them through a public download location you control.

## Operator flow

1. In the source Mini App's admin, choose the source drama under **Multi-App Independent Release** and select the target apps. Include the source app if it should participate in the batch operation.
2. Click **Prepare targets**. "Not prepared" means that this workflow has not created its deterministic target draft; an unrelated drama already present in the target app is not automatically linked. Missing target drafts contain copied metadata and cover assets but no BytePlus VID, TikTok album ID, or episode IDs. Cover registration jobs are queued; source VIDs are no longer registered under target client keys.
3. Select only target apps, open **Independent Media Upload**, fill one original-file URL and click **Upload this episode**. The worker calls the documented TikTok `/shortdrama/video` URL upload API using the target app's credentials, then polls `job_id`. It binds only a returned VID different from the source VID. Each target must complete a single-episode test before a multi-episode batch can be queued. Confirm success and the target VID before uploading the other episodes. This produces additional media and can incur storage/transfer charges; it is not a zero-copy operation.
4. Once all target media and covers are ready, click **Sync version**, then **Submit review**. Every target creates and submits its own TikTok album/version. Review statuses are reconciled about every 10 minutes while under review; **Reconcile** queries immediately.
5. For apps with a passed review, click **Set online version**, then **Publish**. Inspect each app's status and task errors independently. A failure in one app does not silently count as success for the others.

Legacy scope-failed target drafts that still reference source VIDs can use the independent upload action before any TikTok album/version is created. It never overwrites the source album or an already-versioned target. Upload timeouts, interrupted submission without a saved job ID, or unresolved binding become `CONFLICT` and do not replay POST automatically. Preserve provider job/request IDs and verify the upload on TikTok before resolving these cases. Explicit provider upload failure can be retried intentionally with a fresh original-file URL. Once a provider job is saved, routine worker cycles only query it; they do not upload again.

The regular "Recent 50 platform jobs" table belongs to the currently selected Mini App. The **Cross-App Task Log** under the independent release panel combines selected apps' recent jobs, including platform business result, provider request ID, and errors. If a target is not authorized or prepared, its status row shows the reason and no provider job is created by a rejected action.

This workflow is staged, not an automatic publish-on-approval switch. It does not update an existing target drama when the source content changes after preparation; make a new editorial decision rather than overwriting an already-reviewed target. It does not migrate or merge existing independently created target albums.

## Deployment

Build and recreate `api`, `worker`, and `admin`. No database migration is required for this change. Do not omit the worker: it runs per-app platform jobs and periodic review reconciliation.
