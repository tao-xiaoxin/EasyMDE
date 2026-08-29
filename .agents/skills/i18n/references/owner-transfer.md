# EasyMDE i18n Owner Transfer

本文件是字符串 owner 转移、旧 Bootstrap 字段删除、迁移顺序和迁移证据的
唯一执行合同。它不重复当前 owner、catalog、handle、loader/main 或包路径
事实；那些事实只在 [current-contract.md](current-contract.md)。

## 适用边界

一次迁移必须是一个可独立验收的消息单元或 Feature。不得把整个后台、公开
前台或所有 React 文案作为一个无边界替换。未迁移的消息继续由原 owner
提供；迁移中的失败不得导致空文案、双重翻译或静默 source-English 成功。

开始前确认当前任务授权了该 owner 转移，并记录影响的运行面。后台与公开
前台分别建立清单，即使英文 source message 相同也不能合并记录。

## 迁移清单

每个消息实例或紧密耦合的消息组都要填写下面字段。清单可以放在聚焦 Issue
或 PR；它必须能让另一位工程师独立复核并定位旧字段和新 consumer。

```text
Feature / behavior:
Runtime surface:
Source message:
Gettext context:
Plural and interpolation:
Accessibility use:
Current owner:
Current Bootstrap object and field:
All legacy consumers:
Intended owner:
All new consumers:
Extraction source and check:
Catalog generation and check:
Classic script loading contract:
Activation condition:
Failure and recovery boundary:
Old-owner removal evidence:
Package evidence:
Non-English runtime evidence:
Unverified states:
```

`Current Bootstrap object and field` 必须通过
[current-contract.md](current-contract.md) 与 live source/consumer 核对，记录
真实 object、field、runtime surface 和所有 consumer。不要用模糊的“全局配置”
“React 文案”或推测的未来入口代替路径。

## 执行顺序

按以下顺序完成一个迁移单元，任何一步失败都停止接管：

1. Inventory：搜索源字符串、context、plural、placeholder、ARIA 用法、
   Bootstrap field、legacy consumer、Feature consumer 和所有相关测试。
2. Contract：写清语义、locale 格式化、方向、生命周期、错误/取消/恢复、
   source locale 行为，以及同一消息不能由两方同时输出的边界。
3. Target source：在目标 owner 附近加入字面量消息和 `translators:` 注释；
   复数用原始 count，显示值单独按 WordPress locale 格式化。
4. Extraction：让仓库自有 pipeline 找到目标源，确认 POT/PO 合并不丢失
   PHP-owned 消息，并为新增消息补齐维护 locale 翻译。
5. Catalog and load：生成目标 catalog，检查 domain、locale、plural、
   source set、Script Handle、entry、manifest、依赖和加载时机的对应关系。
6. Runtime gate：在可用的版本匹配 WordPress 环境中用维护的非英语 locale
   观察真实用户可见消息；静态文件、mock、注册返回值或编译成功不能代替
   这一步。不可执行时明确标为 `unverified`，不能宣布迁移完成。
7. Behavior gate：验证默认 locale、非默认 locale、长文案、复数、错误、
   pending、取消、重复激活、RTL、ARIA、focus 和 teardown。翻译失败必须
   进入可观察错误边界，而不是进入另一条隐式 fallback。
8. Remove old owner：只有前述证据齐全后，删除旧 Bootstrap field、旧
   consumer 和已经不再使用的 helper/import；保留同一运行面中仍未迁移的
   其他 field。
9. Negative search：搜索旧 field、旧 message source、重复 catalog 引用、
   第二个翻译调用和未声明的加载路径；确认新 owner 是唯一实际输出者。
10. Package gate：按 current contract 和发布文档检查 installable ZIP、
    source archive 边界、语言文件、构建产物和临时文件；记录实际命令和
    结果，再更新迁移清单。

## 删除证据

旧 owner 的删除不是“新 helper 已加入”。PR 必须提供可重放的证据：

- old Bootstrap object/field 从 PHP 组装 map 和 TypeScript 类型/读取点移除；
- old consumer、旧 message source、重复翻译调用和无效 import 已搜索确认；
- 未迁移字段仍能在默认 locale 和现有 legacy 页面工作；
- 目标 owner 的 source、提取、catalog、classic-script loading、行为和
  非英语可见运行时证据指向同一个消息实例；
- 失败、拒绝、取消、失效 locale、catalog 缺失和 teardown 不会重新启用
  已删除 owner，也不会报告虚假的成功；
- release 检查证明包中只有当前受管语言资产，且 source archive 没有被
  runtime allowlist 误当成同一产品；
- 不能执行的真实浏览器或发布重放必须列在 `Unverified states`，并说明
  需要什么环境和最小观察结果。

建议使用 source、built runtime、manifest、catalog、package listing 和
真实浏览器结果各自的摘要，不要把文章内容、用户数据、绝对路径、Cookie、
Nonce、token、凭据、私有 URL 或原始服务器错误放入 Issue、PR、fixture 或
日志。

## 迁移完成标准

只有以下条件全部成立才可把单元标记为 complete：

- 一条消息实例有且仅有一个 owner，context、plural 和 placeholder 不变；
- 目标 source 已被真实 extraction 覆盖，维护 locale catalog 已生成并通过
  当前检查；
- 目标 classic script 的注册、依赖、加载时机和 entry mapping 已验证；
- 默认 locale 不空白，维护的非英语 locale 有真实可见运行时证据，或明确
  仍为 `unverified` 并阻止完成声明；
- 旧 Bootstrap field 和 legacy consumer 已物理删除，未迁移消息没有被误删；
- RTL、ARIA、长文案、失败/恢复和重复生命周期行为通过受影响测试；
- installable ZIP 和 source archive 的语言资产边界通过；
- 诊断和公开证据只含稳定错误码、操作标识、Feature/owner 状态、耗时和
  已清理上下文。

若任一条件不满足，保持原 owner，报告具体阻塞点和下一条两分钟内可执行的
诊断动作；不要以 source English、inline fallback、浏览器 mock 或文件存在
替代缺失证据。
