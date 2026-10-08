// Edge Middleware —— HR 数据分析工作台：访问密码 + 模块级权限
//
// ============ 怎么改（只看这一段就够） ============
// 1) 改密码：修改下面 ACCOUNTS 里的 pwd（不需要再改别的地方）。
//      admin = 管理密码 → 全部模块可见（含受限模块）
//      staff = 员工密码 → 按「云端模块可见性配置」放行
// 2) 各模块对员工是否可见：由管理员打开页面「权限设置」页勾选后点保存，
//      配置存放在 EdgeOne Blob（见 cloud-functions/api/acl.js），保存后即时生效，
//      不需要重新部署。本文件只负责读取该配置并据此放行 / 拒绝。
// 3) 如需新增「受限模块」（只对部分账号开放的敏感数据）：在 PATH_MODULE 里写
//      「受限接口路径 → 模块 key」，并把数据放进 SECURE_MODULES（或独立受保护接口）。
//      铁律：敏感数据只能放在权限层，绝对不要写回 index.html，
//      否则员工打开页面源码就能看到。
// 4) 前端取数：fetch('/__hrsecure/xxx')，无权限时返回 403，页面显示锁定提示。
// ⚠️ 云端配置读不到时用 DEFAULT_STAFF 兜底（敏感模块一律关闭），
//    绝不因为接口故障而放开权限。
// =================================================

const ACCOUNTS = [
  { pwdB64: 'd2Ric2hy',      role: 'admin', name: '管理密码' },
  { pwdB64: 'd2RiczIwMjY=',  role: 'staff', name: '员工密码' },
];

// 受限接口 → 模块 key（该 key 在云端配置里对应「员工是否可见」）
// 当前版本没有受限模块，保持为空；新增示例：{ '/__hrsecure/xxx': 'xxx' }
const PATH_MODULE = {};

// 可对员工开关的模块 key（顺序即权限设置页的展示顺序）
const TOGGLE_KEYS = ['overview', 'recruit', 'perf', 'quality'];

// 权限设置页展示用的模块元数据（perm 固定仅管理员，不参与开关）
const MODULE_META = [
  { key: 'overview', label: '人员总览', note: '常规分析' },
  { key: 'recruit', label: '招聘分析', note: '含各队组留存明细' },
  { key: 'perf', label: '绩效考核', note: '含搭建销售 / 设计师当月明细表' },
  { key: 'quality', label: '数据质量', note: '常规分析' },
  { key: 'perm', label: '权限设置', note: '固定仅管理员可进入，不可开放给员工', fixed: true }
];

// 云端配置读不到时的兜底：敏感模块一律关闭（fail-safe）
const DEFAULT_STAFF = {
  overview: true,
  recruit: true,
  perf: true,
  quality: true
};

// 各模块可见性配置接口（cloud-functions/api/acl.js）
const ACL_ENDPOINT = '/api/acl';

// 读取云端配置。读不到就回退 DEFAULT_STAFF —— 宁可少放行，不可错放行。
async function getAcl(origin) {
  const fallback = { staff: Object.assign({}, DEFAULT_STAFF), updated: null, source: 'fallback' };
  try {
    const r = await fetch(origin + ACL_ENDPOINT, { headers: { 'x-hr-acl-read': '1' } });
    if (!r.ok) return fallback;
    const j = await r.json();
    const src = (j && j.config) || {};
    const s = src.staff || {};
    const staff = Object.assign({}, DEFAULT_STAFF);
    TOGGLE_KEYS.forEach(function (k) {
      if (typeof s[k] === 'boolean') staff[k] = s[k];
    });
    return { staff: staff, updated: src.updated || null, source: j.source || 'cloud' };
  } catch (e) {
    return fallback;
  }
}

// 禁止直接访问的源码 / 平台路径（防止密码与受限数据被下载）
const BLOCKED_PATH = /^\/(middleware\.(js|ts)|\.edgeone|edge-functions|node-functions|cloud-functions|functions|secure\/|package(-lock)?\.json|npm-shrinkwrap\.json)/;

// 会话密钥：换掉它 = 立刻让所有已登录的浏览器失效（全员重新登录）
// 2026-09-29 已轮换一次（群发链接后需要把人踢下线重登）
const SIG = 'aa07f902e18b';
const SESSION_TOKEN = { admin: 'hr_wb_adm_' + SIG, staff: 'hr_wb_stf_' + SIG };

function permInfo(acl) {
  const roleLabel = { admin: '管理（全量数据）', staff: '员工（按管理员配置）' };
  const staffCfg = (acl && acl.staff) || DEFAULT_STAFF;
  return {
    accounts: ACCOUNTS.map(function (a) {
      return { name: a.name, role: a.role, roleLabel: roleLabel[a.role] || a.role, pwd: b64decode(a.pwdB64) };
    }),
    modules: MODULE_META.map(function (m) {
      return {
        key: m.key,
        name: m.label,
        note: m.note,
        fixed: !!m.fixed,
        staff: m.fixed ? false : !!staffCfg[m.key],
        admin: true
      };
    }),
    updated: (acl && acl.updated) || null,
    source: (acl && acl.source) || 'unknown',
    endpoint: ACL_ENDPOINT
  };
}

// ============ 受限模块数据（当前为空：本版本不含敏感明细） ============
// 如需新增：把「接口路径 → 数据对象」写进来，并在上面 PATH_MODULE 里注册对应 key。
const SECURE_MODULES = {};
// ========================================================

function b64decode(s) {
  try {
    return atob(s);
  } catch (e) {
    return '';
  }
}

function accountByPwd(pwd) {
  if (!pwd) return null;
  for (let i = 0; i < ACCOUNTS.length; i++) {
    if (pwd === b64decode(ACCOUNTS[i].pwdB64)) return ACCOUNTS[i];
  }
  return null;
}

function roleOf(cookie) {
  if (!cookie) return null;
  if (cookie.indexOf(SESSION_TOKEN.admin) !== -1) return 'admin';
  if (cookie.indexOf(SESSION_TOKEN.staff) !== -1) return 'staff';
  return null;
}

function loginPage(msg) {
  const err = msg ? '<div class="err">' + msg + '</div>' : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HR 数据分析工作台 · 身份验证</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f7fb;
       font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2d3d}
  .box{width:360px;max-width:92vw;background:#fff;border-radius:14px;padding:32px 28px;
       box-shadow:0 10px 34px rgba(31,45,61,.10);border:1px solid #e6ecf3}
  .lock{font-size:30px;text-align:center;margin-bottom:10px}
  h1{font-size:17px;text-align:center;font-weight:600;margin-bottom:6px}
  .sub{font-size:12.5px;color:#7b8a9e;text-align:center;line-height:1.6;margin-bottom:22px}
  label{display:block;font-size:12.5px;color:#55657a;margin-bottom:6px}
  input{width:100%;height:42px;border:1px solid #d8e0ea;border-radius:9px;padding:0 12px;font-size:14px;
        outline:none;transition:.18s;background:#fbfcfe}
  input:focus{border-color:#2f6bff;background:#fff;box-shadow:0 0 0 3px rgba(47,107,255,.12)}
  button{width:100%;height:42px;margin-top:16px;border:0;border-radius:9px;background:#2f6bff;color:#fff;
         font-size:14.5px;font-weight:600;cursor:pointer;transition:.18s}
  button:hover{background:#2559db}
  .err{margin-top:14px;background:#fef2f1;border:1px solid #ffd6d2;color:#c0392b;font-size:12.5px;
       padding:9px 12px;border-radius:8px;text-align:center}
  .foot{margin-top:20px;font-size:11.5px;color:#9aa8ba;text-align:center;line-height:1.7}
</style>
</head>
<body>
  <form class="box" method="POST" action="/__hrlogin">
    <div class="lock">&#128274;</div>
    <h1>2026 人力行政部 · 数据分析工作台</h1>
    <div class="sub">本页含真实员工数据<br>请输入访问密码后查看</div>
    <label for="pwd">访问密码</label>
    <input id="pwd" name="pwd" type="password" autocomplete="current-password" placeholder="请输入访问密码" autofocus>
    <button type="submit">进入工作台</button>
    ${err}
    <div class="foot">验证通过后 30 天内免重复输入<br>如需开通权限请联系 HR 数据管理员</div>
  </form>
</body>
</html>`;
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, private, max-age=0',
    },
  });
}

export async function middleware(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const cookie = request.headers.get('Cookie') || '';
  const role = roleOf(cookie);

  // ① 源码 / 平台路径一律 404（防下载 middleware.js 拿到密码与受限数据）
  if (BLOCKED_PATH.test(path)) {
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  // ② 后端接口（云函数 /api/*）：注入并覆盖角色头 —— 外部伪造 x-hr-role 无效
  if (path.indexOf('/api/') === 0) {
    if (path === ACL_ENDPOINT && request.method !== 'GET' && role !== 'admin') {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403);
    }
    return next({ headers: { 'x-hr-role': role || 'none' } });
  }

  // ③ 当前账号权限（供页面显示权限标识 + 决定 tab 是否显示）
  if (path === '/__hrwhoami') {
    if (!role) return jsonResponse({ error: 'unauthorized' }, 403);
    const acl = await getAcl(url.origin);
    const modules = { perm: role === 'admin' ? 'allow' : 'deny' };
    TOGGLE_KEYS.forEach(function (k) {
      modules[k] = (role === 'admin' || acl.staff[k]) ? 'allow' : 'deny';
    });
    return jsonResponse(
      {
        role: role,
        roleLabel: role === 'admin' ? '管理权限 · 全量数据' : '员工权限 · 按管理员配置',
        modules: modules,
        aclUpdated: acl.updated,
        aclSource: acl.source,
      },
      200
    );
  }

  // ④ 受限模块接口：按「云端模块可见性配置」放行，未授权返回 403（数据不下发）
  //    当前 PATH_MODULE 为空 → 本分支不会命中，保留作为扩展点。
  if (Object.prototype.hasOwnProperty.call(PATH_MODULE, path)) {
    const modKey = PATH_MODULE[path];
    let allowed = false;
    if (role === 'admin') {
      allowed = true;
    } else if (role === 'staff') {
      const acl = await getAcl(url.origin);
      allowed = !!acl.staff[modKey];
    }
    if (!allowed) {
      return jsonResponse({ error: 'forbidden', module: modKey, needRole: ['admin'] }, 403);
    }
    return jsonResponse(SECURE_MODULES[path] || {}, 200);
  }

  // ④b 权限一览：固定仅管理员（含密码，绝不下发给员工）
  if (path === '/__hrsecure/perm-info') {
    if (role !== 'admin') return jsonResponse({ error: 'forbidden', module: 'perm' }, 403);
    return jsonResponse(permInfo(await getAcl(url.origin)), 200);
  }

  // ⑤ 登录提交
  if (path === '/__hrlogin') {
    let pwd = url.searchParams.get('pwd');
    if (pwd === null || pwd === '') {
      if (request.method === 'POST') {
        try {
          const body = await request.text();
          const m = /(?:^|&)pwd=([^&]*)/.exec(body || '');
          pwd = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
        } catch (e) {
          pwd = '';
        }
      } else {
        pwd = '';
      }
    }
    const acc = accountByPwd(pwd);
    if (acc) {
      const maxAge = 2592000;
      return new Response(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>验证成功</title></head>' +
          '<body style="font-family:sans-serif;padding:40px;color:#1f2d3d">验证成功，正在进入…' +
          '<script>location.replace("/");</script></body></html>',
        {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Set-Cookie':
              'hr_auth=' + SESSION_TOKEN[acc.role] + '; Path=/; Max-Age=' + maxAge + '; HttpOnly; SameSite=Lax',
            'Cache-Control': 'no-store, private',
          },
        }
      );
    }
    return htmlResponse(loginPage(pwd === '' ? '密码不能为空' : '密码错误，请重新输入'));
  }

  // ⑥ 退出 / 切换账号：清 cookie 回登录页
  if (path === '/__hrlogout') {
    return new Response(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
        '<script>location.replace("/");</script></body></html>',
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Set-Cookie': 'hr_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
          'Cache-Control': 'no-store, private',
        },
      }
    );
  }

  // ⑦ 已通过校验 → 放行（并附带只读角色 cookie，便于前端展示当前权限）
  if (role) {
    return next();
  }

  // ⑧ 未验证 → 只给登录页，不泄露任何原页面内容
  return htmlResponse(loginPage(''));
}
