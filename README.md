# HR 数据分析工作台 · 交付包

「2026 人力行政部 · 数据分析工作台」完整工程文件。部署后即是一个带**访问密码 + 模块级权限**的静态数据看板。

---

## 一、项目结构

```
hr-analytics-workbench/
├── index.html                      # 前端页面（人员总览 / 招聘分析 / 绩效考核 / 数据质量 / 权限设置）
├── middleware.js                   # Edge 中间件：访问密码校验 + 模块级权限 + 源码路径封堵
├── cloud-functions/
│   └── api/
│       └── acl.js                  # 云函数 /api/acl：模块可见性配置的读写（EdgeOne Blob 存储）
├── package.json                    # 依赖声明（@edgeone/pages-blob）
├── package-lock.json
└── README.md                       # 本文件
```

- 技术栈：**纯静态前端**（无构建步骤，`index.html` 直接可服务）+ **Edge 中间件** + **1 个云函数**。
- 前端唯一外部依赖是 CDN 上的 ECharts（`cdn.jsdelivr.net`），无需本地打包。
- 无数据库、无外部服务依赖。

---

## 二、部署方式（EdgeOne Makers）

本项目按 **EdgeOne Makers（腾讯云 EdgeOne Pages）** 的目录约定组织，平台会自动识别并打包：

| 文件 / 目录 | 平台识别为 |
|---|---|
| 根目录 `middleware.js` | Edge 中间件，匹配全部路径（`/:path*`） |
| `cloud-functions/**` | 云函数，按文件路径映射路由（`cloud-functions/api/acl.js` → `/api/acl`） |
| 根目录 `index.html`、其它静态文件 | 静态资源 |

**方式 A：CLI 部署**

```bash
npm i -g edgeone@latest
edgeone login --site china          # 登录腾讯云（中国站）
cd hr-analytics-workbench
edgeone makers deploy -n <项目名>   # 首次会自动创建并关联项目
```

**方式 B：控制台部署**

在 EdgeOne Makers 控制台新建项目，把本目录整体上传（或关联 Git 仓库）即可；平台会自动执行上面的识别与打包。

**方式 C：绑定自定义域名**

项目部署后，在控制台的「域名管理」里添加自定义域名，然后按控制台给出的提示在 DNS 服务商处添加解析记录即可。

---

## 三、访问密码

密码配置在 `middleware.js` 顶部的 `ACCOUNTS` 数组里，**用 Base64 编码**存放：

```js
const ACCOUNTS = [
  { pwdB64: '...', role: 'admin', name: '管理密码' },
  { pwdB64: '...', role: 'staff', name: '员工密码' },
];
```

- `admin` = 管理密码 → 全部模块可见，并可进入「权限设置」页
- `staff` = 员工密码 → 只能看到管理员在「权限设置」页勾选放行的模块

> ⚠️ **部署前请先改成你自己的密码。** 生成 Base64 值：
>
> ```bash
> printf '你的新密码' | base64
> ```
>
> 把输出填进对应 `pwdB64` 即可。改完需要重新部署才生效。

---

## 四、运行时行为说明

1. **未通过密码验证**：任何路径都只返回登录页，原页面内容不下发。
2. **模块级权限**：管理员在「权限设置」页勾选后保存，配置写入云端存储（EdgeOne Blob，首次调用自动创建命名空间），**即时生效、无需重新部署**。员工刷新页面即可看到新的可见范围。
3. **源码路径封堵**：`/middleware.js`、`/cloud-functions/**`、`/package.json` 等一律返回 404，避免密码与实现细节被直接下载。
4. **全员踢下线**：改 `middleware.js` 里的 `SIG` 常量（会话密钥）并重新部署，所有已登录浏览器立即失效、需重新输密码。
5. **退出登录**：访问 `/__hrlogout` 即清除会话。
6. **兜底策略**：云端配置读不到时回退到 `DEFAULT_STAFF`（宁可少放行，不可错放行），保证站点永远打得开。

---

## 五、本版本范围

包含 4 个分析模块：**人员总览、招聘分析、绩效考核、数据质量**（外加仅管理员可见的「权限设置」）。

数据通过前端内置的静态数据渲染，如需接入实时数据源，可在 `index.html` 里替换对应数据段，或新增受保护接口（做法见 `middleware.js` 顶部注释）。

---

## 六、本地预览（可选）

```bash
cd hr-analytics-workbench
npx serve .        # 或任意静态服务器
```

注意：本地纯静态服务器**不会执行 `middleware.js`**（Edge 中间件只在 EdgeOne 运行时生效），因此本地预览会看到未经密码校验的页面，仅用于检查前端显示效果。
