const FORM_TOKEN = "shrcnuZjaUyRbygogaQkUORCfHd";
const FORM_URL = `https://icndkdfnybk8.feishu.cn/share/base/form/${FORM_TOKEN}`;
const SUBMIT_URL = "https://icndkdfnybk8.feishu.cn/space/api/bitable/share/content";
const PRODUCTION_ORIGIN = "https://immort-magic.github.io";

const FIELD = {
  guest: "fld7O6RVpz",
  suffix: "fldjXEIS7e",
  status: "fldN3hJ6Lp",
  note: "fldFmXZ8c8",
  inviteId: "fldzAkBnAn"
};

const SUFFIX_OPTIONS = {
  "先生": "optThzB9zI",
  "女士": "optfvuYzZH",
  "老师": "opt0LM6Kec",
  "不显示": "optvrpbdiy"
};

const STATUS_ATTENDING = "opttCVxoF9";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true }, 200, cors);
    }
    if (request.method !== "POST" || url.pathname !== "/rsvp") {
      return json({ ok: false, message: "接口不存在。" }, 404, cors);
    }
    if (!isAllowedOrigin(origin)) {
      return json({ ok: false, message: "请求来源不受信任。" }, 403, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, message: "登记信息格式不正确。" }, 400, cors);
    }

    const guest = cleanText(body.guest, 40);
    const suffix = normalizeSuffix(body.suffix);
    const inviteId = cleanText(body.inviteId, 80);
    const isCurrentInviteId = /^DF-[A-F0-9]{24}-\d{3}$/.test(inviteId);
    const isLegacyInviteId = /^DF[A-Z0-9]{8,24}\d{3}$/.test(inviteId);
    if (!guest || (!isCurrentInviteId && !isLegacyInviteId)) {
      return json({ ok: false, message: "专属邀请链接无效，请联系邀请方重新发送。" }, 400, cors);
    }

    const existing = await env.DB.prepare(
      "SELECT state FROM rsvp_submissions WHERE invite_id = ?1"
    ).bind(inviteId).first();
    if (existing) {
      return json({ ok: true, already: true }, 200, cors);
    }

    const now = new Date().toISOString();
    try {
      await env.DB.prepare(
        "INSERT INTO rsvp_submissions (invite_id, guest, suffix, state, created_at) VALUES (?1, ?2, ?3, 'pending', ?4)"
      ).bind(inviteId, guest, suffix, now).run();
    } catch (error) {
      const raced = await env.DB.prepare(
        "SELECT state FROM rsvp_submissions WHERE invite_id = ?1"
      ).bind(inviteId).first();
      if (raced) return json({ ok: true, already: true }, 200, cors);
      console.error("D1 reserve failed", error);
      return json({ ok: false, message: "登记服务暂时不可用，请稍后重试。" }, 503, cors);
    }

    try {
      await submitToFeishu({ guest, suffix, inviteId, submittedAt: now });
      await env.DB.prepare(
        "UPDATE rsvp_submissions SET state = 'success', completed_at = ?2 WHERE invite_id = ?1"
      ).bind(inviteId, new Date().toISOString()).run();
      return json({ ok: true, already: false }, 200, cors);
    } catch (error) {
      console.error("Feishu submit failed", error);
      await env.DB.prepare(
        "DELETE FROM rsvp_submissions WHERE invite_id = ?1 AND state = 'pending'"
      ).bind(inviteId).run();
      return json({ ok: false, message: "登记暂时失败，请稍后重新点击。" }, 502, cors);
    }
  }
};

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function normalizeSuffix(value) {
  const text = cleanText(value, 12);
  return Object.hasOwn(SUFFIX_OPTIONS, text) ? text : "不显示";
}

function isAllowedOrigin(origin) {
  return origin === PRODUCTION_ORIGIN || origin === "http://localhost:8000" || origin === "http://127.0.0.1:8000";
}

function corsHeaders(origin) {
  const allowed = isAllowedOrigin(origin) ? origin : PRODUCTION_ORIGIN;
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

async function submitToFeishu({ guest, suffix, inviteId, submittedAt }) {
  const cookies = await createAnonymousSession();
  const csrf = cookies.get("_csrf_token");
  const session = cookies.get("session");
  if (!csrf || !session) throw new Error("Feishu anonymous session is incomplete");

  const formData = {
    [FIELD.guest]: textField(guest),
    [FIELD.suffix]: { type: 3, value: SUFFIX_OPTIONS[suffix] },
    [FIELD.status]: { type: 3, value: STATUS_ATTENDING },
    [FIELD.note]: textField(`网页自动登记｜${formatChinaTime(submittedAt)}`),
    [FIELD.inviteId]: textField(inviteId)
  };

  const response = await fetch(SUBMIT_URL, {
    method: "POST",
    headers: {
      "accept": "application/json, text/plain, */*",
      "content-type": "application/json",
      "cookie": serializeCookies(cookies),
      "origin": "https://icndkdfnybk8.feishu.cn",
      "referer": FORM_URL,
      "x-auth-token": session,
      "x-csrftoken": csrf
    },
    body: JSON.stringify({
      shareToken: FORM_TOKEN,
      data: JSON.stringify(formData),
      preUploadEnable: false
    })
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.code !== 0) {
    throw new Error(`Feishu rejected submission: ${response.status} ${result?.code ?? "unknown"}`);
  }
}

function textField(text) {
  return { type: 1, value: [{ type: "text", text }] };
}

function formatChinaTime(iso) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(iso));
}

async function createAnonymousSession() {
  const cookies = new Map();
  let currentUrl = FORM_URL;

  for (let redirectCount = 0; redirectCount < 10; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      redirect: "manual",
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "cookie": serializeCookies(cookies),
        "user-agent": "Mozilla/5.0"
      }
    });
    applySetCookies(cookies, response.headers);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Feishu redirect is missing location");
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    if (!response.ok) throw new Error(`Feishu session page failed: ${response.status}`);
    return cookies;
  }

  throw new Error("Feishu anonymous session redirect limit exceeded");
}

function applySetCookies(jar, headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : splitSetCookieHeader(headers.get("set-cookie") || "");

  for (const value of values) {
    const first = value.split(";", 1)[0];
    const equals = first.indexOf("=");
    if (equals <= 0) continue;
    const name = first.slice(0, equals).trim();
    const cookieValue = first.slice(equals + 1).trim();
    if (/max-age=0/i.test(value) || !cookieValue) jar.delete(name);
    else jar.set(name, cookieValue);
  }
}

function splitSetCookieHeader(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
}

function serializeCookies(jar) {
  return Array.from(jar, ([name, value]) => `${name}=${value}`).join("; ");
}
