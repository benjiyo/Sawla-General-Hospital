const express = require("express");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const fetch = require("node-fetch");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

const app = express();
const PORT = process.env.PORT || 3000;

// Simple admin credentials - set via environment variable ADMIN_USER and ADMIN_PASS
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "changeme";

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-please-change",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  }),
);

app.use(require("cors")({ origin: true, credentials: true }));

// Serve static files from project root so html/, css/, images/ are reachable
app.use(express.static(path.join(__dirname)));

// Ensure news images dir exists
const newsImgDir = path.join(__dirname, "images", "news");
if (!fs.existsSync(newsImgDir)) fs.mkdirSync(newsImgDir, { recursive: true });

// Multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, newsImgDir);
  },
  filename: function (req, file, cb) {
    const safe = file.originalname.replace(/[^a-z0-9.\-]/gi, "-");
    cb(null, Date.now() + "-" + safe);
  },
});
const upload = multer({ storage });

function ensureWriter(req, res, next) {
  if (req.session && req.session.isWriter) return next();
  return res.status(401).json({ success: false, error: "Unauthorized" });
}

// Database pool (optional) - configured via env: DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT
let dbPool = null;
function getDbPool() {
  if (dbPool) return dbPool;
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASS;
  const database = process.env.DB_NAME;
  const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined;
  if (!host || !user || !password || !database) return null;
  dbPool = mysql.createPool({
    host,
    user,
    password,
    database,
    port,
    waitForConnections: true,
    connectionLimit: 5,
  });
  return dbPool;
}

async function archiveNewsItems(items) {
  if (!items || !items.length) return;
  const pool = getDbPool();
  if (pool) {
    try {
      const insertSql = `INSERT INTO hospital_news (title, slug, summary, content, category, author, publish_date, featured_image, meta_title, meta_description, meta_keywords, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;
      for (const it of items) {
        const slug = (it.title || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        const publish_date = it.date ? it.date : null;
        await pool.query(insertSql, [
          it.title || null,
          slug || null,
          it.excerpt || null,
          it.content || null,
          it.category || null,
          it.author || null,
          publish_date,
          it.image || null,
          it.meta_title || null,
          it.meta_description || null,
          it.meta_keywords || null,
          "published",
        ]);
      }
      return;
    } catch (e) {
      console.error("Failed to archive news to DB:", e);
      // fall through to file fallback
    }
  }

  // Fallback: append to data/news-archive.json
  try {
    const archiveFile = path.join(__dirname, "data", "news-archive.json");
    const existing = fs.existsSync(archiveFile)
      ? JSON.parse(fs.readFileSync(archiveFile, "utf8"))
      : [];
    for (const it of items) existing.unshift(it);
    fs.writeFileSync(archiveFile, JSON.stringify(existing, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to write news archive file:", e);
  }
}

// Login
app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res
      .status(400)
      .json({ success: false, error: "Missing credentials" });

  // Simple check - compare to env ADMIN_PASS (plaintext). For production use hashed secrets.
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isWriter = true;
    req.session.username = username;
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: "Invalid credentials" });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// Public: return news.json
app.get("/api/news", (req, res) => {
  // Return only the latest 3 news items for the public page
  const p = path.join(__dirname, "data", "news.json");
  try {
    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw) || [];
    return res.json(data.slice(0, 3));
  } catch (e) {
    return res.json([]);
  }
});

// Protected: accept new news items (multipart/form-data)
app.post("/api/news", ensureWriter, upload.single("image"), (req, res) => {
  const { title, date, excerpt } = req.body;
  if (!title || !date || !excerpt) {
    return res.status(400).json({ success: false, error: "Missing fields" });
  }

  let imagePath = null;
  if (req.file) {
    // Expose as server-root absolute path (client will normalize)
    imagePath = "/images/news/" + req.file.filename;
  }

  const newsItem = {
    id: Date.now(),
    title,
    date,
    excerpt,
    image: imagePath,
    link: "#",
  };

  const dataFile = path.join(__dirname, "data", "news.json");
  try {
    const existing = fs.existsSync(dataFile)
      ? JSON.parse(fs.readFileSync(dataFile, "utf8"))
      : [];
    // Prepend new item
    existing.unshift(newsItem);
    // If more than 3 items keep only latest 3 on the public page and archive the rest
    let removed = [];
    if (existing.length > 3) {
      removed = existing.slice(3);
      existing.splice(3); // keep first 3
    }
    fs.writeFileSync(dataFile, JSON.stringify(existing, null, 2), "utf8");

    // Archive removed items to DB or archive file (best-effort, async)
    if (removed.length) {
      // normalize fields expected by archive function
      const normalize = (it) => ({
        id: it.id || Date.now(),
        title: it.title || null,
        date: it.date || null,
        excerpt: it.excerpt || it.summary || null,
        image: it.image || null,
      });
      archiveNewsItems(removed.map(normalize)).catch((e) => console.error(e));
    }

    return res.json({ success: true, item: newsItem });
  } catch (e) {
    console.error("Failed to save news:", e);
    return res
      .status(500)
      .json({ success: false, error: "Unable to save news" });
  }
});

// Accept appointment requests (public)
// Helper: create mail transporter from env. If not configured, returns null.
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !port || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: Number(port),
    secure: String(port) === "465",
    auth: { user, pass },
  });
}

// Support SendGrid via API key (optional)
function getTransporterFlexible() {
  // Prefer explicit SMTP if provided
  const smtp = getTransporter();
  if (smtp) return smtp;

  // If SENDGRID_API_KEY is provided use SendGrid SMTP
  const sgKey = process.env.SENDGRID_API_KEY;
  if (sgKey) {
    return nodemailer.createTransport({
      host: "smtp.sendgrid.net",
      port: 587,
      secure: false,
      auth: { user: "apikey", pass: sgKey },
    });
  }

  return null;
}

async function verifyRecaptcha(token, remoteip) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return { success: true };
  try {
    const r = await fetch(
      `https://www.google.com/recaptcha/api/siteverify?secret=${encodeURIComponent(
        secret,
      )}&response=${encodeURIComponent(token)}&remoteip=${encodeURIComponent(
        remoteip || "",
      )}`,
      { method: "POST" },
    );
    const j = await r.json();
    return j;
  } catch (e) {
    return { success: false, error: "recaptcha-failed" };
  }
}

// Simple stateless arithmetic captcha: server issues a short-lived token (a,b,exp) signed with HMAC
function createCaptcha() {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  const exp = Date.now() + 5 * 60 * 1000; // 5 minutes
  const payload = JSON.stringify({ a, b, exp });
  const secret =
    process.env.CAPTCHA_SECRET ||
    process.env.SESSION_SECRET ||
    "dev-captcha-secret";
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const token = Buffer.from(payload).toString("base64url") + "." + sig;
  return { a, b, token };
}

function verifyCaptcha(token, answer) {
  if (!token) return false;
  try {
    const parts = String(token).split(".");
    if (parts.length !== 2) return false;
    const payload = Buffer.from(parts[0], "base64url").toString("utf8");
    const sig = parts[1];
    const secret =
      process.env.CAPTCHA_SECRET ||
      process.env.SESSION_SECRET ||
      "dev-captcha-secret";
    const expected = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");
    if (sig !== expected) return false;
    const obj = JSON.parse(payload);
    if (Date.now() > obj.exp) return false;
    const expectedAnswer = Number(obj.a) + Number(obj.b);
    return Number(answer) === expectedAnswer;
  } catch (e) {
    return false;
  }
}

// Captcha endpoint
app.get("/api/captcha", (req, res) => {
  const c = createCaptcha();
  res.json(c);
});

// Admin: list archived news (from DB if configured, otherwise archive file)
app.get("/api/news/archive", ensureWriter, async (req, res) => {
  // Support paging and basic filtering/search
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const pageSize = Math.max(
    1,
    Math.min(100, parseInt(req.query.pageSize || "10", 10)),
  );
  const q = req.query.q ? String(req.query.q).trim() : null;
  const from = req.query.from ? String(req.query.from).trim() : null; // yyyy-mm-dd
  const to = req.query.to ? String(req.query.to).trim() : null;
  const category = req.query.category
    ? String(req.query.category).trim()
    : null;

  const pool = getDbPool();
  if (pool) {
    try {
      const where = [];
      const params = [];
      if (q) {
        where.push("(title LIKE ? OR summary LIKE ? OR content LIKE ?)");
        const like = `%${q}%`;
        params.push(like, like, like);
      }
      if (category) {
        where.push("category = ?");
        params.push(category);
      }
      if (from) {
        where.push("publish_date >= ?");
        params.push(from);
      }
      if (to) {
        where.push("publish_date <= ?");
        params.push(to);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      // total count
      const countSql = `SELECT COUNT(*) AS cnt FROM hospital_news ${whereSql}`;
      const [[countRow]] = await pool.query(countSql, params);
      const total = countRow ? Number(countRow.cnt || 0) : 0;

      const offset = (page - 1) * pageSize;
      const sql = `SELECT id, title, slug, summary, content, category, author, publish_date, featured_image AS image, meta_title, meta_description, meta_keywords, status, created_at, updated_at FROM hospital_news ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      const qparams = params.slice();
      qparams.push(pageSize, offset);
      const [rows] = await pool.query(sql, qparams);
      return res.json({ items: rows || [], total, page, pageSize });
    } catch (e) {
      console.error("Failed to read archived news from DB:", e);
      // fallthrough to file fallback
    }
  }

  // Fallback to archive file (filter in-memory)
  try {
    const archiveFile = path.join(__dirname, "data", "news-archive.json");
    let existing = fs.existsSync(archiveFile)
      ? JSON.parse(fs.readFileSync(archiveFile, "utf8"))
      : [];
    // normalize fields
    existing = existing.map((it) => ({
      id: it.id,
      title: it.title || it.summary || "",
      summary: it.excerpt || it.summary || "",
      content: it.content || "",
      category: it.category || null,
      publish_date: it.date || it.publish_date || null,
      image: it.image || null,
      created_at: it.createdAt || null,
    }));

    // filtering
    if (q) {
      const qLower = q.toLowerCase();
      existing = existing.filter(
        (it) =>
          (it.title || "").toLowerCase().includes(qLower) ||
          (it.summary || "").toLowerCase().includes(qLower) ||
          (it.content || "").toLowerCase().includes(qLower),
      );
    }
    if (category) {
      existing = existing.filter(
        (it) => String(it.category) === String(category),
      );
    }
    if (from) {
      existing = existing.filter(
        (it) => it.publish_date && String(it.publish_date) >= from,
      );
    }
    if (to) {
      existing = existing.filter(
        (it) => it.publish_date && String(it.publish_date) <= to,
      );
    }

    const total = existing.length;
    const offset = (page - 1) * pageSize;
    const items = existing.slice(offset, offset + pageSize);
    return res.json({ items, total, page, pageSize });
  } catch (e) {
    console.error("Failed to read news archive file:", e);
    return res
      .status(500)
      .json({ success: false, error: "Unable to read archive" });
  }
});

// Admin: restore an archived news item back to the active news (data/news.json)
app.post("/api/news/archive/restore", ensureWriter, async (req, res) => {
  const id = req.body && (req.body.id || req.body.itemId);
  if (!id) return res.status(400).json({ success: false, error: "Missing id" });

  let item = null;
  const pool = getDbPool();
  if (pool) {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM hospital_news WHERE id = ? LIMIT 1",
        [id],
      );
      if (rows && rows.length) {
        const r = rows[0];
        item = {
          id: r.id,
          title: r.title,
          date: r.publish_date
            ? r.publish_date instanceof Date
              ? r.publish_date.toISOString().slice(0, 10)
              : String(r.publish_date)
            : null,
          excerpt: r.summary || r.meta_description || null,
          image: r.featured_image || null,
          content: r.content || null,
        };
        // delete from DB after reading
        await pool.query("DELETE FROM hospital_news WHERE id = ?", [id]);
      }
    } catch (e) {
      console.error("Failed to fetch/delete archived news from DB:", e);
    }
  }

  // Fallback: read from archive file
  if (!item) {
    try {
      const archiveFile = path.join(__dirname, "data", "news-archive.json");
      let existing = fs.existsSync(archiveFile)
        ? JSON.parse(fs.readFileSync(archiveFile, "utf8"))
        : [];
      const idx = existing.findIndex((x) => String(x.id) === String(id));
      if (idx !== -1) {
        item = existing[idx];
        existing.splice(idx, 1);
        fs.writeFileSync(
          archiveFile,
          JSON.stringify(existing, null, 2),
          "utf8",
        );
      }
    } catch (e) {
      console.error("Failed to read/modify archive file:", e);
    }
  }

  if (!item)
    return res
      .status(404)
      .json({ success: false, error: "Archived item not found" });

  // Insert restored item at top of data/news.json and manage overflow (archive older items)
  try {
    const dataFile = path.join(__dirname, "data", "news.json");
    const existing = fs.existsSync(dataFile)
      ? JSON.parse(fs.readFileSync(dataFile, "utf8"))
      : [];
    const newsItem = {
      id: item.id || Date.now(),
      title: item.title || null,
      date:
        item.date || item.publish_date || new Date().toISOString().slice(0, 10),
      excerpt: item.excerpt || item.summary || null,
      image: item.image || null,
      link: item.link || "#",
    };
    existing.unshift(newsItem);

    // If more than 3, archive the overflow
    let removed = [];
    if (existing.length > 3) {
      removed = existing.slice(3);
      existing.splice(3);
    }
    fs.writeFileSync(dataFile, JSON.stringify(existing, null, 2), "utf8");
    if (removed.length)
      archiveNewsItems(removed).catch((e) => console.error(e));

    return res.json({ success: true, item: newsItem });
  } catch (e) {
    console.error("Failed to restore archived item:", e);
    return res
      .status(500)
      .json({ success: false, error: "Unable to restore item" });
  }
});

app.post(
  "/api/appointments",
  // server-side validation chain
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("phone").trim().notEmpty().withMessage("Phone is required"),
  body("date").trim().notEmpty().withMessage("Date is required"),
  body("department").trim().notEmpty().withMessage("Department is required"),
  async (req, res) => {
    // Honeypot check
    if (req.body.hp) {
      return res.status(400).json({ success: false, error: "Spam detected" });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    // CAPTCHA / recaptcha verification
    const recaptchaToken = req.body["g-recaptcha-response"];
    if (process.env.RECAPTCHA_SECRET) {
      const rc = await verifyRecaptcha(recaptchaToken, req.ip);
      if (!rc.success) {
        return res
          .status(400)
          .json({ success: false, error: "recaptcha failed" });
      }
    } else {
      // If no Google reCAPTCHA is configured, require our simple arithmetic captcha
      const captchaToken = req.body.captchaToken;
      const captchaAnswer = req.body.captcha;
      if (
        !captchaToken ||
        !captchaAnswer ||
        !verifyCaptcha(captchaToken, captchaAnswer)
      ) {
        return res
          .status(400)
          .json({ success: false, error: "captcha failed" });
      }
    }

    const { name, phone, email, date, department, doctor, message } =
      req.body || {};
    const appointment = {
      id: Date.now(),
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: email ? String(email).trim() : null,
      date: String(date).trim(),
      department: String(department).trim(),
      doctor: doctor ? String(doctor).trim() : null,
      message: message ? String(message).trim() : null,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    const dataFile = path.join(__dirname, "data", "appointments.json");
    try {
      const existing = fs.existsSync(dataFile)
        ? JSON.parse(fs.readFileSync(dataFile, "utf8"))
        : [];
      existing.unshift(appointment);
      fs.writeFileSync(dataFile, JSON.stringify(existing, null, 2), "utf8");

      // send confirmation to patient and notification to admin (best-effort)
      const transporter = getTransporterFlexible();
      const adminEmail = process.env.ADMIN_EMAIL;
      if (transporter) {
        // patient confirmation
        if (appointment.email) {
          try {
            await transporter.sendMail({
              from:
                process.env.EMAIL_FROM || adminEmail || "no-reply@localhost",
              to: appointment.email,
              subject: `Appointment request received - ${appointment.date}`,
              text: `Dear ${
                appointment.name
              },\n\nWe received your appointment request for ${
                appointment.date
              } with ${
                appointment.doctor || appointment.department
              }. We will contact you to confirm the appointment.\n\nRegards,\nSawla General Hospital`,
            });
          } catch (e) {
            console.error("Failed to send patient confirmation:", e);
          }
        }
        // admin notification
        if (adminEmail) {
          try {
            await transporter.sendMail({
              from: process.env.EMAIL_FROM || adminEmail,
              to: adminEmail,
              subject: `New appointment request from ${appointment.name}`,
              text: `New appointment request:\n\nName: ${
                appointment.name
              }\nPhone: ${appointment.phone}\nEmail: ${
                appointment.email || "-"
              }\nDate: ${appointment.date}\nDepartment: ${
                appointment.department
              }\nDoctor: ${appointment.doctor || "-"}\nMessage: ${
                appointment.message || "-"
              }\n`,
            });
          } catch (e) {
            console.error("Failed to send admin notification:", e);
          }
        }
      } else {
        // If no transporter configured, log email to console for manual sending
        console.log(
          "Appointment saved; no SMTP configured. Appointment:",
          appointment,
        );
      }

      return res.json({ success: true, appointment });
    } catch (e) {
      console.error("Failed to save appointment:", e);
      return res
        .status(500)
        .json({ success: false, error: "Unable to save appointment" });
    }
  },
);

// Protected: list appointments (for admin)
app.get("/api/appointments", ensureWriter, (req, res) => {
  const dataFile = path.join(__dirname, "data", "appointments.json");
  try {
    const existing = fs.existsSync(dataFile)
      ? JSON.parse(fs.readFileSync(dataFile, "utf8"))
      : [];
    return res.json(existing);
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, error: "Unable to read appointments" });
  }
});

// Protected: update appointment status and optionally notify patient
app.post("/api/appointments/:id/status", ensureWriter, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!id || !status)
    return res
      .status(400)
      .json({ success: false, error: "Missing id or status" });
  const dataFile = path.join(__dirname, "data", "appointments.json");
  try {
    const existing = fs.existsSync(dataFile)
      ? JSON.parse(fs.readFileSync(dataFile, "utf8"))
      : [];
    const idx = existing.findIndex((a) => a.id === id);
    if (idx === -1)
      return res.status(404).json({ success: false, error: "Not found" });
    existing[idx].status = status;
    existing[idx].updatedAt = new Date().toISOString();
    fs.writeFileSync(dataFile, JSON.stringify(existing, null, 2), "utf8");

    // send notification to patient if email present
    const transporter = getTransporterFlexible();
    const adminEmail = process.env.ADMIN_EMAIL;
    const appt = existing[idx];
    if (transporter && appt.email) {
      try {
        transporter
          .sendMail({
            from: process.env.EMAIL_FROM || adminEmail || "no-reply@localhost",
            to: appt.email,
            subject: `Your appointment status: ${status}`,
            text: `Dear ${appt.name},\n\nYour appointment on ${appt.date} is now: ${status}.\n\nRegards,\nSawla General Hospital`,
          })
          .catch((e) => console.error("sendMail failed", e));
      } catch (e) {
        console.error("Failed to notify patient", e);
      }
    }

    return res.json({ success: true, appointment: existing[idx] });
  } catch (e) {
    console.error("Failed to update appointment", e);
    return res
      .status(500)
      .json({ success: false, error: "Unable to update appointment" });
  }
});

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
  console.log(
    `Login with username=${ADMIN_USER} and password=${ADMIN_PASS} (change via environment variables).`,
  );
});
