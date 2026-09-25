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
const PHYSICS_REPO = process.env.PHYSICS_REPO || "ab1-authorized-physics";

const CATEGORIES = ["Faculties", "PhD", "BS-MS", "Postdocs"];
const sessions = new Map();

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validInstitutionalEmail(email) {
  return /^[^@\s]+@iiserb\.ac\.in$/i.test(email);
}

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
  if (!validInstitutionalEmail(normalized)) return null;

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
        // A missing category file is treated as empty; configuration errors
        // are surfaced only if all sources fail.
      }
    }
  }
  return null;
}

app.post("/api/access/check", async (req, res) => {
  const email = normalizeEmail(req.body.email);

  if (!validInstitutionalEmail(email)) {
    return res.status(403).json({
      allowed: false,
      message: "Use an @iiserb.ac.in institutional email address."
    });
  }

  try {
    const user = await findAuthorizedUser(email);
    if (!user) {
      return res.status(403).json({
        allowed: false,
        message: "This account is not in the active Physics/Mathematics authorization lists."
      });
    }

    // Prototype identity step. Production should replace this with IISER SSO
    // or an email-ownership verification service before issuing a session.
    const sessionId = crypto.randomBytes(24).toString("hex");
    sessions.set(sessionId, { user, createdAt: Date.now() });

    return res.json({ allowed: true, user, sessionId });
  } catch (error) {
    console.error(error);
    return res.status(503).json({
      allowed: false,
      message: "Authorization service is temporarily unavailable."
    });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`AB-1 booking server running at http://localhost:${PORT}`);
});
