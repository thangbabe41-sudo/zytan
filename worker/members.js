import { scryptSync, timingSafeEqual } from "node:crypto";

const memberCookieName = "__Host-ziko_session";
const memberSessionSeconds = 14 * 24 * 60 * 60;
const memberUsernamePattern = /^[a-z0-9_]{3,24}$/;
const memberTokenPattern = /^[a-f0-9]{64}$/;
const authWindow = 15 * 60 * 1000;
const dummySalt = "f146ad20a89efdf78c21246403b38ce9";

function memberCookie(request) {
  return (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(memberCookieName + "="))?.slice(memberCookieName.length + 1);
}

function sessionResponse(member, token = "", maxAge = memberSessionSeconds, status = 200) {
  const response = json({ member }, status);
  response.headers.set("Set-Cookie", memberCookieName + "=" + token +
    "; Path=/; Max-Age=" + maxAge + "; HttpOnly; Secure; SameSite=Lax");
  return response;
}

async function getMember(request, db) {
  const token = memberCookie(request);
  if (!memberTokenPattern.test(token)) return null;
  return db.prepare(
    "SELECT members.id, members.username FROM member_sessions JOIN members ON members.id=member_sessions.member_id " +
    "WHERE token_hash=? AND expires_at>?"
  ).bind(await hashCode(token), Date.now()).first();
}

function deriveMemberPassword(password, salt) {
  // OWASP's 32 MiB scrypt profile fits the Worker memory limit.
  return scryptSync(password, hexBytes(salt), 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
}

function createMemberPassword(password) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return "scrypt-v1:" + salt + ":" + toHex(deriveMemberPassword(password, salt));
}

function verifyMemberPassword(password, stored) {
  const parts = /^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(stored ?? "");
  const derived = deriveMemberPassword(password, parts?.[1] ?? dummySalt);
  return timingSafeEqual(derived, hexBytes(parts?.[2] ?? "0".repeat(64))) && Boolean(parts);
}

async function allowMemberAttempt(db, key, maximum, now) {
  const row = await db.prepare(
    "INSERT INTO member_auth_limits (key, attempts, expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET " +
    "attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END, " +
    "expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END " +
    "WHERE expires_at<=? OR attempts<? RETURNING attempts"
  ).bind(await hashCode(key), now + authWindow, now, now, now, maximum).first();
  return Boolean(row);
}

async function signInMember(request, db, member, passwordHash) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const old = memberCookie(request);
  const now = Date.now();
  const statements = [];
  if (passwordHash) statements.push(db.prepare("INSERT INTO members (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(member.id, member.username, passwordHash, now));
  if (memberTokenPattern.test(old)) statements.push(db.prepare("DELETE FROM member_sessions WHERE token_hash=?").bind(await hashCode(old)));
  statements.push(
    db.prepare("DELETE FROM member_sessions WHERE expires_at<=?").bind(now),
    db.prepare("INSERT INTO member_sessions (token_hash, member_id, expires_at) VALUES (?, ?, ?)")
      .bind(await hashCode(token), member.id, now + memberSessionSeconds * 1000)
  );
  await db.batch(statements);
  return sessionResponse(member, token, memberSessionSeconds, passwordHash ? 201 : 200);
}

async function memberAuth(request, db, data, registering) {
  const username = typeof data.username === "string" ? data.username.trim().toLowerCase() : "";
  const password = typeof data.password === "string" ? data.password : "";
  if (!memberUsernamePattern.test(username) || password.length < 8 || password.length > 128) {
    return registering ? error("Tên tài khoản cần 3–24 ký tự chữ, số hoặc dấu _. Mật khẩu cần 8–128 ký tự.", 400)
      : error("Tên tài khoản hoặc mật khẩu không đúng.", 401);
  }
  const now = Date.now();
  const ip = request.headers.get("cf-connecting-ip");
  if ((ip && !(await allowMemberAttempt(db, "ip:" + ip, 24, now))) ||
      !(await allowMemberAttempt(db, "username:" + username, 8, now))) {
    const response = error("Bạn thử quá nhiều lần. Vui lòng chờ 15 phút rồi thử lại.", 429);
    response.headers.set("Retry-After", "900");
    return response;
  }
  await db.prepare("DELETE FROM member_auth_limits WHERE expires_at<=?").bind(now).run();
  const existing = await db.prepare("SELECT id, username, password_hash FROM members WHERE username=?").bind(username).first();
  if (!registering) {
    if (!verifyMemberPassword(password, existing?.password_hash)) return error("Tên tài khoản hoặc mật khẩu không đúng.", 401);
    return signInMember(request, db, { id: existing.id, username: existing.username });
  }
  if (existing) return error("Tên tài khoản này đã được dùng.", 409);
  try {
    return await signInMember(request, db, { id: crypto.randomUUID(), username }, createMemberPassword(password));
  } catch (issue) {
    const duplicate = await db.prepare("SELECT id FROM members WHERE username=?").bind(username).first();
    if (duplicate) return error("Tên tài khoản này đã được dùng.", 409);
    throw issue;
  }
}

async function signOutMember(request, db) {
  const token = memberCookie(request);
  if (memberTokenPattern.test(token)) {
    await db.prepare("DELETE FROM member_sessions WHERE token_hash=?").bind(await hashCode(token)).run();
  }
  return sessionResponse(null, "", 0);
}

async function bankOwner(request, db, data) {
  if (data.memberId != null) {
    const member = await getMember(request, db);
    return member?.id === data.memberId ? memberBankOwner(member.id) : null;
  }
  return typeof data.wallet === "string" && walletPattern.test(data.wallet) ? hashCode(data.wallet) : null;
}
