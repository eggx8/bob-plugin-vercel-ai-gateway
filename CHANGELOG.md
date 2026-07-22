# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 和 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.3.3] - 2026-07-22

### Fixed

- 使用 Bob 实际接受的 `{ result: translateResult }` 结构回传流式增量，修复思考内容和译文只在结束时显示

## [0.3.2] - 2026-07-22

### Changed

- 使用用户提供的黑色 Vercel 三角标并移除图标背景

## [0.3.1] - 2026-07-22

### Fixed

- 兼容 `reasoning_content` 流式思考增量，避免推理模型在译文生成前长时间无输出
- 禁用流式响应压缩和缓存，降低 SSE 数据被客户端缓冲的可能

## [0.3.0] - 2026-07-22

### Added

- 支持 Bob 原生服务验证按钮。

### Changed

- 默认模型改为 `poolside/laguna-s-2.1-free`。
- “Model”本地化为“模型”，插件摘要移除尾部中文句号。

## [0.2.0] - 2026-07-22

### Changed

- 深度思考改为“默认设置、启用思考、禁用思考”三态选项。
- 默认设置沿用模型行为，启用与禁用模式分别显式发送 reasoning 参数。

## [0.1.0] - 2026-07-22

### Added

- Vercel AI Gateway OpenAI-compatible Chat Completions 接入。
- 流式翻译与 Bob 原生思考过程展示。
- 流完整性检查，避免把解析损坏或中途截断的内容作为完整译文。
- API Key、模型和思考模式设置。
- Bob 官方完整语言代码支持。
- 自动测试、确定性打包、appcast 与 GitHub Release 工作流。
