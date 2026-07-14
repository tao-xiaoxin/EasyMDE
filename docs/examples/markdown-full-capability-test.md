# Markdown 全量能力测试文档

> 用于测试标题、排版、表格、代码、数学公式、Mermaid 图表、HTML、脚注、任务列表等 Markdown 渲染能力。

---

## 1. 标题层级

# 一级标题 Heading 1

## 二级标题 Heading 2

### 三级标题 Heading 3

#### 四级标题 Heading 4

##### 五级标题 Heading 5

###### 六级标题 Heading 6

---

## 2. 文本样式

普通文本、**粗体文本**、*斜体文本*、***粗斜体文本***。

~~删除线文本~~、`行内代码`、<u>下划线文本</u>、<mark>高亮文本</mark>。

H<sub>2</sub>O、x<sup>2</sup>、© 2026、™、✓、⚠️、🚀。

支持 Emoji：😀 😎 🎉 🔥 💡 ✅ ❌ 📌 🧠 🤖

---

## 3. 链接与图片

[OpenAI 官网](https://openai.com)

自动链接：https://github.com

邮箱链接：[example@example.com](mailto:example@example.com)

![占位测试图片](https://placehold.co/1200x500/png?text=Markdown+Image+Test)

带标题的图片：

![风景占位图](https://placehold.co/800x400/png?text=Image+Preview "图片标题")

---

## 4. 引用块

> 这是一级引用。
>
> Markdown 是一种轻量级标记语言。

> 嵌套引用示例：
>
> > 第二层引用。
> >
> > > 第三层引用。

> [!NOTE]
> 这是一个提示块，部分平台如 GitHub 支持。

> [!TIP]
> 这是一个技巧提示。

> [!WARNING]
> 这是一个警告提示。

> [!IMPORTANT]
> 这是一个重要提示。

---

## 5. 无序、有序与任务列表

### 无序列表

* 前端开发
* 后端开发

  * Python
  * Node.js
  * Go
* 运维部署

  * Docker
  * Nginx
  * Kubernetes

### 有序列表

1. 创建项目
2. 安装依赖
3. 编写代码
4. 运行测试
5. 部署上线

### 任务列表

* [x] 初始化仓库
* [x] 配置 Git
* [x] 编写 README
* [ ] 完成单元测试
* [ ] 配置 CI/CD
* [ ] 发布正式版本

---

## 6. 分隔线

---

---

---

---

## 7. 表格

| 名称       |   类型  |  状态 |    评分 |
| :------- | :---: | --: | ----: |
| GPT-5.5  |  推理模型 |  稳定 | ⭐⭐⭐⭐⭐ |
| Claude   |  对话模型 |  稳定 |  ⭐⭐⭐⭐ |
| Gemini   | 多模态模型 | 测试中 |  ⭐⭐⭐⭐ |
| DeepSeek |  推理模型 |  稳定 |  ⭐⭐⭐⭐ |

### 对齐测试表格

| 左对齐    |  居中 |    右对齐 |
| :----- | :-: | -----: |
| Apple  | 100 | $99.99 |
| Banana | 200 | $12.50 |
| Orange | 300 |  $8.88 |

### 单元格内代码与换行

| 模块   | 命令              | 说明              |
| ---- | --------------- | --------------- |
| 安装依赖 | `npm install`   | 安装项目依赖          |
| 启动开发 | `npm run dev`   | 启动本地服务<br>支持热更新 |
| 构建产物 | `npm run build` | 生成生产环境静态文件      |

---

## 8. 行内代码与代码块

行内代码示例：`const hello = "world";`

### Bash

```bash
#!/usr/bin/env bash

set -euo pipefail

echo "Hello, Markdown!"
mkdir -p ./dist
npm install
npm run build
```

### Python

```python
from dataclasses import dataclass
from typing import List


@dataclass
class User:
    name: str
    age: int


def greet(users: List[User]) -> None:
    for user in users:
        print(f"Hello, {user.name}! You are {user.age} years old.")


if __name__ == "__main__":
    greet([
        User(name="Xiaoxin", age=18),
        User(name="Alice", age=22),
    ])
```

### JavaScript / TypeScript

```ts
interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

async function fetchUser(id: string): Promise<ApiResponse<{ id: string; name: string }>> {
  const response = await fetch(`/api/users/${id}`);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}
```

### JSON

```json
{
  "name": "markdown-test",
  "version": "1.0.0",
  "features": [
    "table",
    "math",
    "mermaid",
    "code-highlight"
  ],
  "enabled": true
}
```

### YAML

```yaml
name: markdown-test
version: 1.0.0

services:
  app:
    image: node:22-alpine
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
```

### SQL

```sql
SELECT
  u.id,
  u.username,
  COUNT(o.id) AS order_count,
  SUM(o.amount) AS total_amount
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.status = 'active'
GROUP BY u.id, u.username
ORDER BY total_amount DESC;
```

### Diff

```diff
- const port = 3000;
+ const port = process.env.PORT ?? 8080;

- console.log("Development mode");
+ console.log(`Server started at http://localhost:${port}`);
```

---

## 9. 数学公式

### 行内公式

爱因斯坦质能方程：$E = mc^2$

圆的面积：$S = pi r^2$

概率归一化：$sum_{i=1}^{n} p_i = 1$

### 独立公式

$$
int_a^b f(x),dx = F(b) - F(a)
$$

$$
frac{partial}{partial x} f(x, y)
===================================

lim_{Delta x to 0}
frac{f(x+Delta x, y)-f(x, y)}{Delta x}
$$

### 矩阵

$$
A =
begin{bmatrix}
1 & 2 & 3 
4 & 5 & 6 
7 & 8 & 9
end{bmatrix}
$$

### 方程组

$$
begin{cases}
x + y = 10 
2x - y = 5
end{cases}
$$

### 分段函数

$$
f(x) =
begin{cases}
x^2, & x geq 0 
-x^2, & x < 0
end{cases}
$$

### 常见统计公式

$$
mu = frac{1}{n}sum_{i=1}^{n}x_i
$$

$$
sigma = sqrt{frac{1}{n}sum_{i=1}^{n}(x_i-mu)^2}
$$

### 神经网络前向传播

$$
mathbf{h} = sigma(mathbf{W}mathbf{x} + mathbf{b})
$$

$$
hat{y} = text{softmax}(mathbf{W}_omathbf{h}+mathbf{b}_o)
$$

---

## 10. Mermaid 流程图

```mermaid
flowchart TD
    A[用户请求] --> B{是否命中缓存?}
    B -->|是| C[返回缓存结果]
    B -->|否| D[调用 API]
    D --> E{请求成功?}
    E -->|是| F[写入缓存]
    F --> G[返回结果]
    E -->|否| H[返回错误信息]
```

---

## 11. Mermaid 时序图

```mermaid
sequenceDiagram
    participant U as 用户
    participant W as Web 前端
    participant A as API 服务
    participant D as 数据库

    U->>W: 点击登录
    W->>A: POST /api/login
    A->>D: 查询用户信息
    D-->>A: 返回用户数据
    A-->>W: 返回 Token
    W-->>U: 登录成功
```

---

## 12. Mermaid 饼图

```mermaid
pie title 技术栈占比
    "Python" : 35
    "TypeScript" : 25
    "Go" : 15
    "Java" : 10
    "其他" : 15
```

---

## 13. Mermaid 甘特图

```mermaid
gantt
    title 项目开发计划
    dateFormat YYYY-MM-DD
    axisFormat %m-%d

    section 需求阶段
    需求分析           :done, req1, 2026-07-01, 3d
    原型设计           :done, req2, after req1, 2d

    section 开发阶段
    后端接口开发       :active, dev1, 2026-07-06, 5d
    前端页面开发       :dev2, 2026-07-08, 6d
    联调测试           :test1, after dev1, 3d

    section 发布阶段
    灰度发布           :release1, after test1, 2d
    正式上线           :milestone, release2, after release1, 0d
```

---

## 14. Mermaid 类图

```mermaid
classDiagram
    class User {
        +String id
        +String username
        +String email
        +login()
        +logout()
    }

    class Order {
        +String id
        +Float amount
        +String status
        +create()
        +cancel()
    }

    User "1" --> "*" Order : creates
```

---

## 15. Mermaid 状态图

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Review: 提交审核
    Review --> Approved: 审核通过
    Review --> Rejected: 审核驳回
    Rejected --> Draft: 修改内容
    Approved --> Published: 发布
    Published --> Archived: 归档
    Archived --> [*]
```

---

## 16. Mermaid ER 数据库关系图

```mermaid
erDiagram
    USER ||--o{ ORDER : places
    USER {
        string id PK
        string username
        string email
        datetime created_at
    }

    ORDER ||--|{ ORDER_ITEM : contains
    ORDER {
        string id PK
        string user_id FK
        decimal total_amount
        string status
    }

    ORDER_ITEM {
        string id PK
        string order_id FK
        string product_name
        int quantity
        decimal price
    }
```

---

## 17. Mermaid 思维导图

```mermaid
mindmap
  root((Markdown))
    文本排版
      标题
      粗体
      斜体
      删除线
    内容结构
      列表
      表格
      引用
      脚注
    技术内容
      代码块
      数学公式
      Mermaid 图表
    扩展能力
      HTML
      Emoji
      任务列表
```

---

## 18. Mermaid 时间线

```mermaid
timeline
    title 项目发展时间线
    2024 : 项目立项
         : 完成技术选型
    2025 : 发布第一个版本
         : 获得首批用户
    2026 : 接入 AI Agent
         : 支持多模态能力
```

---

## 19. 折叠内容

<details>
<summary>点击展开查看隐藏内容</summary>

这里是默认折叠的内容。

* 可以放列表
* 可以放代码
* 可以放说明文字

```bash
echo "隐藏区域中的代码"
```

</details>

---

## 20. HTML 标签测试

<div align="center">

### 居中标题

这是一段通过 HTML `div` 实现居中的文本。

</div>

<p align="right">
这是右对齐文本。
</p>

<kbd>⌘</kbd> + <kbd>K</kbd>

<details>
<summary>HTML details 测试</summary>

支持 **Markdown 粗体**、`代码` 与列表：

1. 第一项
2. 第二项

</details>

---

## 21. 脚注

Markdown 支持脚注功能。[^1]

这里还有第二个脚注。[^long-note]

[^1]: 这是一个简单脚注。

[^long-note]: 这是一个较长的脚注内容，可用于补充说明、引用来源或备注信息。

---

## 22. 引用式链接

这是一个 [GitHub][github-link] 链接。

这是一个 [OpenAI][openai-link] 链接。

[github-link]: https://github.com "GitHub"
[openai-link]: https://openai.com "OpenAI"

---

## 23. 转义字符

*这不是斜体*

**这不是粗体**

# 这不是标题

`这不是代码`

---

## 24. 综合示例：AI 服务监控面板描述

### 服务状态

| 服务           | 地址                        |   状态  |  响应时间 |
| ------------ | ------------------------- | :---: | ----: |
| API Gateway  | `https://api.example.com` |  ✅ 正常 |  82ms |
| Redis Cache  | `redis://127.0.0.1:6379`  |  ✅ 正常 |   4ms |
| PostgreSQL   | `postgres://db:5432`      |  ✅ 正常 |  12ms |
| Worker Queue | `amqp://rabbitmq:5672`    | ⚠️ 延迟 | 420ms |

### 核心指标

* QPS：`1,284`
* 错误率：`0.12%`
* P95 延迟：`238ms`
* CPU 使用率：`42%`
* 内存使用率：`61%`

```mermaid
xychart-beta
    title "近 7 天 API 请求量"
    x-axis ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    y-axis "请求数" 0 --> 16000
    line [8200, 10500, 9600, 13200, 14800, 7100, 6800]
    bar [7600, 9800, 8900, 12100, 13900, 6400, 6100]
```

### 错误率计算

$$
text{Error Rate}
=================

frac{text{Failed Requests}}{text{Total Requests}}
times 100%
$$

例如：

$$
frac{12}{10000} times 100% = 0.12%
$$

---

## 25. 最终测试清单

* [x] 标题
* [x] 文本格式
* [x] 图片与链接
* [x] 引用块
* [x] 列表与任务清单
* [x] 表格
* [x] 多语言代码块
* [x] 数学公式
* [x] Mermaid 图表
* [x] HTML 标签
* [x] 脚注
* [x] 折叠内容
* [x] Emoji 与特殊字符

> 测试完成。若某一部分没有正常显示，通常说明当前 Markdown 渲染器未启用对应扩展，例如 KaTeX、Mermaid、HTML 或 GitHub Flavored Markdown。
