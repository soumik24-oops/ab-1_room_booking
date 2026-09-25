const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const MATH_REPO = process.env.MATH_REPO || "ab1-authorized-mathematics";
const PHYSICS_REPO = process.env.PHYSICS_REPO || "ab1-authorized-Physics";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

const CATEGORIES = ["Faculties", "PhD", "BS-MS", "Postdocs"];
const sessions = new Map();
const otpChallenges = new Map();
const requestRate = new Map();

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_REQUESTS = 5;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validInstitutionalEmail(email) {
  return /^[^@\s]+@iiserb\.ac\.in$/i.test(email);
}

function hashOtp(email, otp, salt) {
  return crypto
    .createHash("sha256")
    .update(`${email}:${otp}:${salt}`)
    .digest("hex");
}

function safeEqual(a, b) {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function setSessionCookie(res, sessionId) {
  res.cookie = undefined;
  const secure = process.env.NODE_ENV === "production" || process.env.RENDER === "true";
  res.setHeader(
    "Set-Cookie",
    `ab1_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" || process.env.RENDER === "true";
  res.setHeader(
    "Set-Cookie",
    `ab1_session=; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=0`
  );
}

function getSessionId(req) {
  const header = String(req.headers.cookie || "");
  const match = header.match(/(?:^|;\s*)ab1_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function cleanupExpired() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
  for (const [email, challenge] of otpChallenges) {
    if (challenge.expiresAt <= now) otpChallenges.delete(email);
  }
  for (const [key, item] of requestRate) {
    if (item.resetAt <= now) requestRate.delete(key);
  }
}

setInterval(cleanupExpired, 60 * 1000).unref();

async function githubFile(repo, filePath) {
  if (!GITHUB_TOKEN || !GITHUB_OWNER) {
    throw new Error("GitHub authorization source is not configured on the server.");
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(repo)}/contents/${filePath}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ab1-room-booking"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} for ${repo}/${filePath}`);
  }

  const data = await response.json();
  if (data.encoding !== "base64" || !data.content) {
    throw new Error(`Unexpected file format for ${repo}/${filePath}`);
  }

  return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map(s => s.trim());
  return lines.slice(1).map(line => {
    const values = line.split(",").map(s => s.trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}

async function findAuthorizedUser(email) {
  const normalized = normalizeEmail(email);
  if (!TEST_MODE && !validInstitutionalEmail(normalized)) return null;

  const repos = [
    { department: "Mathematics", repo: MATH_REPO },
    { department: "Physics", repo: PHYSICS_REPO }
  ];

  for (const item of repos) {
    for (const category of CATEGORIES) {
      try {
        const csv = await githubFile(item.repo, `${category}.csv`);
        const rows = parseCsv(csv);
        const match = rows.find(row =>
          normalizeEmail(row.email) === normalized &&
          String(row.status || "").toLowerCase() === "active"
        );
        if (match) {
          return {
            email: normalized,
            department: item.department,
            category,
            role: match.role || category,
            roll_number: match.roll_number || "",
            name: match.name || ""
          };
        }
      } catch (error) {
        // Keep checking the remaining authorization files.
        console.error(`Authorization source error: ${item.repo}/${category}.csv`, error.message);
      }
    }
  }
  return null;
}

async function sendOtpEmail(email, otp) {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured on the server.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [email],
      subject: "AB-1 Room Booking — Verification Code",
      text: `Your AB-1 Room Booking verification code is ${otp}.\n\nThis code expires in 10 minutes and can only be used once.\n\nIf you did not request this code, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">
        <h2>AB-1 Room Booking</h2>
        <p>Your verification code is:</p>
        <p style="font-size:30px;font-weight:700;letter-spacing:8px">${otp}</p>
        <p>This code expires in 10 minutes and can only be used once.</p>
        <p style="color:#687386">If you did not request this code, you can ignore this email.</p>
      </div>`
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.message || body?.name || `HTTP ${response.status}`;
    console.error(`[OTP] Resend rejected request: HTTP ${response.status}; detail=${detail}`);
    throw new Error(`Resend email failed: ${detail}`);
  }

  return body;
}

function rateLimitKey(req, email) {
  return `${getClientIp(req)}:${email}`;
}

function canRequestOtp(req, email) {
  const key = rateLimitKey(req, email);
  const now = Date.now();
  const existing = requestRate.get(key);
  if (!existing || existing.resetAt <= now) {
    requestRate.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (existing.count >= RATE_MAX_REQUESTS) return false;
  existing.count += 1;
  return true;
}

app.post("/api/access/request-code", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  console.log(`[OTP] request received; test_mode=${TEST_MODE}; email_domain=${email.includes("@") ? email.split("@").pop() : "invalid"}`);

  if (!TEST_MODE && !validInstitutionalEmail(email)) {
    console.log("[OTP] rejected: non-institutional email while TEST_MODE is false");
    return res.status(403).json({
      ok: false,
      message: "Use an @iiserb.ac.in institutional email address."
    });
  }
  if (TEST_MODE && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.log("[OTP] rejected: invalid email syntax");
    return res.status(400).json({
      ok: false,
      message: "Enter a valid email address."
    });
  }

  try {
    const user = await findAuthorizedUser(email);
    console.log(`[OTP] authorization lookup result: ${user ? "AUTHORIZED" : "NOT_AUTHORIZED"}`);
    if (!user) {
      return res.status(403).json({
        ok: false,
        message: "This account is not in the active Physics/Mathematics authorization lists."
      });
    }

    const existing = otpChallenges.get(email);
    if (existing && existing.resendAvailableAt > Date.now()) {
      const seconds = Math.ceil((existing.resendAvailableAt - Date.now()) / 1000);
      return res.status(429).json({
        ok: false,
        message: `Please wait ${seconds} seconds before requesting another code.`
      });
    }

    if (!canRequestOtp(req, email)) {
      return res.status(429).json({
        ok: false,
        message: "Too many verification-code requests. Please try again later."
      });
    }

    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const salt = crypto.randomBytes(16).toString("hex");

    console.log("[OTP] calling Resend API");
    await sendOtpEmail(email, otp);
    console.log("[OTP] Resend API accepted the email request");

    otpChallenges.set(email, {
      user,
      otpHash: hashOtp(email, otp, salt),
      salt,
      createdAt: Date.now(),
      expiresAt: Date.now() + OTP_TTL_MS,
      resendAvailableAt: Date.now() + OTP_RESEND_COOLDOWN_MS,
      attempts: 0
    });

    return res.json({ ok: true, message: "A verification code has been sent to your email." });
  } catch (error) {
    console.error("[OTP] request failed:", error.message);
    return res.status(503).json({
      ok: false,
      message: "We could not send the verification code. Please try again."
    });
  }
});

app.post("/api/access/verify-code", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.code || "").trim();

  if (!validInstitutionalEmail(email) || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ ok: false, message: "Enter the 6-digit verification code." });
  }

  const challenge = otpChallenges.get(email);
  if (!challenge) {
    return res.status(400).json({
      ok: false,
      message: "That code has expired or no longer exists. Request a new code."
    });
  }

  if (challenge.expiresAt <= Date.now()) {
    otpChallenges.delete(email);
    return res.status(400).json({
      ok: false,
      message: "That code has expired. Request a new code."
    });
  }

  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    otpChallenges.delete(email);
    return res.status(429).json({
      ok: false,
      message: "Too many incorrect attempts. Request a new code."
    });
  }

  challenge.attempts += 1;

  const suppliedHash = hashOtp(email, otp, challenge.salt);
  if (!safeEqual(suppliedHash, challenge.otpHash)) {
    return res.status(401).json({
      ok: false,
      message: `Incorrect verification code. ${OTP_MAX_ATTEMPTS - challenge.attempts} attempt(s) remaining.`
    });
  }

  otpChallenges.delete(email);

  const sessionId = crypto.randomBytes(32).toString("hex");
  sessions.set(sessionId, {
    user: challenge.user,
    createdAt: Date.now()
  });

  setSessionCookie(res, sessionId);

  return res.json({
    ok: true,
    user: challenge.user
  });
});

app.get("/api/session", (req, res) => {
  const sessionId = getSessionId(req);
  if (!sessionId) return res.status(401).json({ authenticated: false });

  const session = sessions.get(sessionId);
  if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    clearSessionCookie(res);
    return res.status(401).json({ authenticated: false });
  }

  return res.json({ authenticated: true, user: session.user });
});

app.post("/api/logout", (req, res) => {
  const sessionId = getSessionId(req);
  if (sessionId) sessions.delete(sessionId);
  clearSessionCookie(res);
  return res.json({ ok: true });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`AB-1 booking server running on port ${PORT}`);
});
