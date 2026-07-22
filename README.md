# ▲ Vercel AI Gateway for Bob

[![CI](https://github.com/eggx8/bob-plugin-vercel-ai-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/eggx8/bob-plugin-vercel-ai-gateway/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)

通过 [Vercel AI Gateway](https://vercel.com/ai-gateway) 调用大模型进行翻译的 [Bob](https://bobtranslate.com/) 插件。实现保持精简：一个 Gateway 接口、三个配置项、全程流式输出。

> [!IMPORTANT]
> 这是社区维护的非官方集成，与 Vercel, Inc. 或 Bob 官方无隶属、赞助或背书关系。

## 功能

- 使用一个 AI Gateway API Key 调用 Vercel 支持的模型
- 流式显示译文
- 可选深度思考，并在 Bob 原生思考区域显示 reasoning
- 支持 Bob 原生配置验证
- 支持 Bob 1.20.0 官方定义的 390 种语言代码
- 不依赖 Node.js、浏览器 API 或第三方运行库

## 要求

- Bob 1.15.0 或更高版本
- [Vercel AI Gateway API Key](https://vercel.com/ai-gateway)

## 安装

从 [Releases](https://github.com/eggx8/bob-plugin-vercel-ai-gateway/releases) 下载最新版 `.bobplugin`，双击完成安装。

也可以直接下载仓库中的 [vercel-ai-gateway_0.3.3.bobplugin](bobplugin/vercel-ai-gateway_0.3.3.bobplugin)。

## 配置

在 Bob 的「设置 → 服务」中添加 `Vercel AI Gateway`，然后填写：

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| API Key | AI Gateway API Key，使用安全输入框保存 | 无 |
| 模型 | `provider/model` 格式的模型 ID | `poolside/laguna-s-2.1-free` |
| 深度思考 | 默认设置、启用思考或禁用思考 | 默认设置 |

可用模型以 [AI Gateway Model List](https://vercel.com/ai-gateway/models) 为准。不同模型对 reasoning 的支持不同；不兼容时请选择“禁用思考”或更换模型。

## 工作方式

插件直接请求：

```text
POST https://ai-gateway.vercel.sh/v1/chat/completions
```

请求遵循 OpenAI Chat Completions 格式。译文从 `delta.content` 流式读取；服务端返回的 `delta.reasoning` 或 `delta.reasoning_content` 会单独传给 Bob 的 `thinkInfo`，不会混入译文。每次增量都通过 Bob 的 `{ result: translateResult }` 流式回调结构更新界面。

`默认设置`不发送 reasoning 参数并沿用模型默认行为；`启用思考`显式发送 `reasoning.enabled: true`；`禁用思考`显式发送 `reasoning.enabled: false` 且不展示 reasoning。部分模型即使禁用输出，仍可能在服务端内部执行推理。

## 隐私与费用

- API Key 仅作为 Bearer Token 发送给 `ai-gateway.vercel.sh`，插件不会记录或转发密钥。
- 待翻译文本会发送给 Vercel AI Gateway 及其路由到的模型提供商。
- 模型调用可能产生费用，请在 Vercel 控制台查看用量并设置预算。

## 开发

插件没有运行依赖。开发、测试和打包统一使用 pnpm；Node.js 仅用于这些开发任务。

```bash
pnpm test
pnpm run package
```

刷新 Bob 官方语言表：

```bash
pnpm run update-languages
```

打包产物位于 `bobplugin/`。压缩包根层包含 Bob 运行所需文件及许可证声明，可直接安装。

## 发布

更新版本号、`CHANGELOG.md` 和 `appcast.json` 后重新打包并校验 SHA-256。推送 `v*` tag 后，GitHub Actions 会验证仓库并把已提交的 `.bobplugin` 上传到 Release。

公开仓库后应添加 GitHub topic `bobplugin`，以便 Bob 第三方插件列表收录。

## 许可证与商标

代码采用 [MIT License](LICENSE)。Vercel 名称和三角标不包含在 MIT 授权中；公开分发前应确认符合品牌规范并取得所需许可，详见 [NOTICE](NOTICE) 与 [Vercel Brand Guidelines](https://vercel.com/geist/brands)。
