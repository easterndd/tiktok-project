# 手机短剧 / 小程序 UI 与操作逻辑调研

调研日期：2026-09-22
目标：为 TikTok Minis 短剧小程序确定更接近市场产品的首页、频道、播放和解锁交互。

## 先说结论

当前项目的方向已经具备基础条件，但仍然偏“Web 内容站”：首页把推荐、搜索、筛选和内容区都放在同一层，剧集卡片的信息密度偏低，播放器虽然已经支持沉浸式观看，但还没有完全形成“刷剧流”的连续体验。

市场上更成熟的短剧产品普遍采用以下链路：

```text
首页频道 / 推荐
  -> 点海报直接进入第一集
  -> 全屏竖屏播放器自动播放
  -> 上滑下一集 / 下滑上一集
  -> 锁定集在当前播放器内触发解锁
  -> 解锁完成后继续播放，不跳到独立广告页
  -> 选集抽屉、收藏、分享、倍速等作为播放器上的辅助操作
```

核心判断：你现在最应该优化的是“频道与内容流的组织方式”和“播放器内连续消费”，而不是继续增加更多首页装饰卡片。

## 1. ReelShort：发现页的结构

### 可观察到的页面模式

ReelShort 官方公开页面明确强调短剧、短集数、每日更新，并将内容按 `Trending now` 和 Romance / Drama / Thriller / Fantasy 等频道组织。首页内容是高密度竖版海报网格，每张海报带有 `TOP 1`、`HOT`、`NEW` 等状态标签和播放入口。

官方页面：[ReelShort – Short Drama Streaming App](https://reelshort.app/)

![ReelShort 海报与频道示例](https://v-mps.crazymaplestudios.com/images/7db3a940-63b6-11f1-96ad-b3be8c391a9d.jpg)

![ReelShort 热门内容示例](https://v-mps.crazymaplestudios.com/images/9e921580-657c-11f1-8b0c-95b1c4d640db.jpg)

### 对当前项目的启发

- 首页第一层应该是频道，而不是多个大区块连续堆叠。
- 频道名称建议固定为：`精选`、`热播`、`新剧`、`完结`，题材作为第二层横向筛选。
- 海报卡片应突出封面、剧名、状态标签和集数，不要把完整描述塞进每张卡片。
- `HOT`、`NEW`、`TOP` 这类内容状态比泛化的“推荐”更容易帮助用户决定点击。
- 首页点击剧集直接进播放器，不再经过详情页，是符合短剧消费习惯的路径。

## 2. DramaBox：连续观看和商业化链路

DramaBox 的 App Store 页面和公开产品描述显示，它强调短剧分类、个性化推荐、竖屏播放、收藏/播放列表以及免费内容与高级内容并存。

官方应用信息：[DramaBox - Stream Drama Shorts](https://apps.apple.com/us/app/dramabox-stream-drama-shorts/id6445905219)

![DramaBox 播放页参考 1](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/26/bf/ed/26bfed55-ce3f-9042-5413-f0a923ae8045/AS_U65b0_U7248_U82f1_U8bed-1242-2688-1.png/320x480bb.jpg)

![DramaBox 播放页参考 2](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/5d/47/20/5d47204f-886a-e1fa-8cb5-d5fce3fd24e1/AS_U65b0_U7248_U8bed-1242-2688-2.png/320x480bb.jpg)

![DramaBox 播放页参考 3](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/2d/c9/84/2dc9845c-5598-1ecc-e0bd-6e4592513c09/AS_U65b0_U7248_U8bed-1242-2688-3.png/320x480bb.jpg)

### 对当前项目的启发

- 解锁不是一个独立目的地，而是当前播放上下文中的一个状态。
- 激励广告完成前，播放器仍然停留在当前集；完成后才切换到目标集。
- 选集应该是底部抽屉或半屏面板，不能把用户带离播放页。
- 播放器需要明确区分：当前集、下一集、已解锁、需广告解锁、不可播放。
- 收藏、历史、继续观看应该围绕“剧目 + 当前集”记录，而不是只记录剧目。

## 3. ReelShort App Store 截图参考

App Store 返回的 ReelShort 截图可以作为竖屏播放器、封面比例和深色信息层的视觉参考。

应用信息：[ReelShort - Stream Drama & TV](https://apps.apple.com/us/app/reelshort-stream-drama-tv/id1636235979)

![ReelShort App Store 截图 1](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/0f/83/49/0f834929-eb26-8427-800b-2aabb3402393/en01.jpg/320x480bb.jpg)

![ReelShort App Store 截图 2](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/1c/af/11/1caf11cc-c426-9b35-26ec-9c7e6d715353/en02.jpg/320x480bb.jpg)

![ReelShort App Store 截图 3](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/89/4d/13/894d1328-cda0-dbbd-45c1-d570806e0c9e/en03.jpg/320x480bb.jpg)

## 4. 红果 / 抖音类产品的可借鉴模式

公开搜索结果和用户可见产品描述反复出现以下模式：竖屏刷剧、热播榜、新剧榜、追更榜、按题材组织内容、持续更新和推荐算法。由于搜索结果中混有大量非官方 SEO 站点，本节只提炼交互模式，不把这些站点当作官方事实来源。

可以借鉴的产品结构：

| 层级 | 推荐内容 | 交互 |
|---|---|---|
| 一级频道 | 热播、新剧、完结、追更 | 顶部横向 Tab，点击立即切换内容流 |
| 二级筛选 | 甜宠、都市、逆袭、悬疑、古装等 | 横向滚动胶囊，单选或清除 |
| 内容卡片 | 竖版封面、状态角标、剧名、集数 | 点击直接播放第一集 |
| 播放器 | 全屏竖屏、上下滑、自动连播 | 选集抽屉不离开播放器 |
| 付费/广告 | 解锁按钮、剩余广告提示、奖励确认 | 当前页内完成，回到原集上下文 |

## 5. GitHub 开源项目调研

以下项目是公开仓库，适合参考结构、状态管理和手势实现。它们不是本项目的直接依赖，也没有自动获得复制其代码的许可；使用前必须逐仓库确认 LICENSE。

### 5.1 `omrana5/shorts-video`

仓库：[github.com/omrana5/shorts-video](https://github.com/omrana5/shorts-video)

特点：React Native 竖向视频流，使用 `FlatList`、`pagingEnabled`、可见性回调和单一 active video 状态。

值得借鉴：

- 一屏一个视频，按屏幕高度计算列表项。
- `onViewableItemsChanged` 决定当前播放项，避免多个视频同时播放。
- 分页请求、去重和 AbortController，适合后续接入真实短剧 feed。
- 缓冲、失败重试、后台暂停和播放位置恢复都有清晰的状态边界。

代码文档：[README.md](https://github.com/omrana5/shorts-video/blob/main/README.md)

### 5.2 `Gokulkiran418/reels-react-native`

仓库：[github.com/Gokulkiran418/reels-react-native](https://github.com/Gokulkiran418/reels-react-native)

特点：Expo + React Native 的 Reels 风格应用，包含无限竖向滚动、自动播放、播放/静音、创作者信息和右侧操作栏。

值得借鉴：

- 播放页的动作栏层级：点赞、评论、分享和更多操作。
- 播放状态与用户登录状态分开管理。
- 用 `React.memo`、`useCallback` 等控制视频列表重渲染。

代码文档：[README.md](https://github.com/Gokulkiran418/reels-react-native/blob/main/README.md)

### 5.3 `RomilMovaliya/Reel-app`

仓库：[github.com/RomilMovaliya/Reel-app](https://github.com/RomilMovaliya/Reel-app)

特点：更小的 React Native + Expo 垂直短视频 UI 示例，适合快速理解页面拆分和导航结构。

值得借鉴：

- `screens`、`navigation`、`types` 分层清晰。
- 适合作为播放器交互原型参考，不建议直接作为生产视频架构。

### 5.4 `aamit98/Reelhub`

仓库：[github.com/aamit98/Reelhub](https://github.com/aamit98/Reelhub)

特点：Expo 全栈视频社区示例，包含上传、搜索、Trending、收藏、评论、用户资料和后端 API。

值得借鉴：

- 内容发现、搜索、收藏和用户中心的整体信息架构。
- 上传与播放分离，适合对照当前 admin-web 和 mini-web 的边界。

注意：这些仓库当前 GitHub 页面显示为低热度或无星项目，适合作为实现参考，不应直接当成经过大规模生产验证的方案。

## 6. 对当前项目的差距判断

### 已经具备

- 首页已有精选、热播、新剧频道切换。
- 首页卡片已改为竖版海报网格。
- 点击剧集可直接进入播放页。
- 播放器已支持全屏沉浸式布局。
- 播放器已有上下滑切换集数、自动下一集和选集抽屉的基础实现。
- 锁定集的激励广告流程已经改为在当前播放上下文中处理。

### 仍然需要完善

1. **首页频道数据语义不完整**：当前 `TRENDING` 和 `NEW_RELEASES` 仍主要依赖后端 block 配置，缺少明确的排序规则和“完结”状态。
2. **精选频道重复内容**：当前 `data.feed.items`、热门和更多内容可能重复，需要统一去重和排序。
3. **卡片缺少状态角标**：建议增加 `HOT`、`NEW`、`TOP`、`更新至 N 集`，使用户能快速判断内容。
4. **播放器操作层级还不够像短剧 App**：需要增加右侧轻量操作栏、当前集/总集数提示、下一集预告和更明确的解锁状态。
5. **真实 TikTok Mini 手势仍需真机验证**：浏览器中只能验证 DOM 和路由；TikTok 容器可能拦截触摸事件，必须在 Preview/真机确认上滑、下滑和广告回调。
6. **广告解锁需要防重复和异常恢复**：广告取消、失败、超时、回调重复时要保证只触发一次解锁和一次跳集。
7. **数据状态需要服务端闭环**：继续观看、解锁、收藏、播放完成、下一集推荐都应该有统一的 episode-level 事件记录。

## 7. 建议的最终 UI 方案

### 首页

```text
顶部：品牌 / 搜索入口 / 用户入口
一级 Tab：精选 | 热播 | 新剧 | 完结
二级题材：全部 | 甜宠 | 都市 | 逆袭 | 悬疑 | 古装 ...
内容：3 列竖版海报，卡片只保留封面、角标、剧名、集数
精选页：最多一个主推荐位 + 继续观看 + 内容流
其它频道：直接内容流，不重复展示大 Hero
```

### 播放页

```text
全屏竖屏视频
顶部：返回、剧名、更多
右侧：点赞、收藏、分享、选集
底部：当前集标题、集数、进度
手势：上滑下一集，下滑上一集
锁定集：播放器内弹出解锁层，广告完成后回到目标集
集末：显示下一集预告，短延迟自动播放
```

### 视觉建议

- 深色背景 + 高对比浅色文字，避免大面积渐变装饰。
- 封面优先，文字不超过两行；移动端优先保证点击目标和内容密度。
- 所有图标使用同一套线性图标，单个触控目标至少 44px。
- 频道切换使用稳定的分段控件，避免圆角胶囊过多导致视觉层级混乱。
- 播放器底部和顶部遵守安全区，广告/解锁弹层使用 40%~60% scrim。

## 8. 推荐实施顺序

1. 后端补齐频道语义：`HOT`、`NEW_RELEASES`、`COMPLETED`、`CONTINUE_WATCHING`，并明确排序字段。
2. 首页统一成频道数据流，去掉重复的 `More to watch`，增加状态角标。
3. 播放页补齐右侧操作栏、下一集预告和集数状态视觉。
4. 将解锁流程封装成单一状态机：`idle -> showing_ad -> rewarded -> switching -> playing / failed`。
5. 在 TikTok Mini 真机验证触摸、广告回调、页面恢复和后台前台切换。
6. 最后再做动画、预加载和性能优化，避免在交互模型未确定前堆视觉效果。

## 9. 来源与使用边界

- ReelShort 官方页面：<https://reelshort.app/>
- ReelShort App Store：<https://apps.apple.com/us/app/reelshort-stream-drama-tv/id1636235979>
- DramaBox App Store：<https://apps.apple.com/us/app/dramabox-stream-drama-shorts/id6445905219>
- GitHub `omrana5/shorts-video`：<https://github.com/omrana5/shorts-video>
- GitHub `Gokulkiran418/reels-react-native`：<https://github.com/Gokulkiran418/reels-react-native>
- GitHub `RomilMovaliya/Reel-app`：<https://github.com/RomilMovaliya/Reel-app>
- GitHub `aamit98/Reelhub`：<https://github.com/aamit98/Reelhub>

竞品截图仅用于产品研究和交互分析，不应直接打包进生产环境；开源仓库代码、图片和依赖必须在使用前单独核对许可证和版权。
