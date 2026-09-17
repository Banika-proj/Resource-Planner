// Resource Planner API — Cloudflare Pages Functions + D1
// All routes are under /api/*. No authentication: anyone who can reach this
// URL can read and write data. Fine for a trusted internal team; do not use
// for anything sensitive without adding access control in front of this.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = params.path || [];
  const method = request.method;
  const db = env.DB;

  if (!db) {
    return json({ error: 'D1 database not bound. Add a [[d1_databases]] binding named DB in wrangler.toml (or in the Pages dashboard) and redeploy.' }, 500);
  }

  try {
    // GET /api/data — full hydration payload
    if (path[0] === 'data' && method === 'GET') {
      const members = await db.prepare('SELECT id, name FROM members ORDER BY name').all();
      const tasks = await db.prepare('SELECT id, member_id AS memberId, name, type FROM member_tasks').all();
      const logs = await db.prepare('SELECT id, member_id AS memberId, date, task_id AS taskId, task, type, minutes, avail FROM logs').all();
      const capRows = await db.prepare('SELECT key, minutes FROM capacity').all();
      const capacity = {};
      capRows.results.forEach(r => { capacity[r.key] = r.minutes; });
      return json({
        members: members.results,
        memberTasks: tasks.results,
        logs: logs.results,
        capacity,
      });
    }

    // POST /api/members  { name }
    if (path[0] === 'members' && method === 'POST') {
      const body = await request.json();
      const name = (body.name || '').trim();
      if (!name) return json({ error: 'Name is required' }, 400);
      const result = await db.prepare('INSERT INTO members (name) VALUES (?)').bind(name).run();
      return json({ id: result.meta.last_row_id, name });
    }

    // DELETE /api/members/:id — also removes that member's recurring tasks; logs are kept for history
    if (path[0] === 'members' && path[1] && method === 'DELETE') {
      const id = parseInt(path[1]);
      await db.prepare('DELETE FROM members WHERE id = ?').bind(id).run();
      await db.prepare('DELETE FROM member_tasks WHERE member_id = ?').bind(id).run();
      return json({ ok: true });
    }

    // POST /api/tasks  { memberId, name, type } — a recurring per-member task
    if (path[0] === 'tasks' && method === 'POST') {
      const body = await request.json();
      const memberId = parseInt(body.memberId);
      const name = (body.name || '').trim();
      const type = body.type || '';
      if (!memberId || !name) return json({ error: 'memberId and name are required' }, 400);
      const result = await db.prepare('INSERT INTO member_tasks (member_id, name, type) VALUES (?, ?, ?)')
        .bind(memberId, name, type).run();
      return json({ id: result.meta.last_row_id, memberId, name, type });
    }

    // DELETE /api/tasks/:id — removes the recurring task only; past logs keep their own snapshot
    if (path[0] === 'tasks' && path[1] && method === 'DELETE') {
      const id = parseInt(path[1]);
      await db.prepare('DELETE FROM member_tasks WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }

    // POST /api/logs/save  { memberId, date, avail, entries:[{taskId,task,type,minutes}] }
    // Replaces that member's entries for that date.
    if (path[0] === 'logs' && path[1] === 'save' && method === 'POST') {
      const body = await request.json();
      const memberId = parseInt(body.memberId);
      const date = body.date;
      const avail = body.avail || 'Full';
      const entries = Array.isArray(body.entries) ? body.entries : [];
      if (!memberId || !date) return json({ error: 'memberId and date are required' }, 400);

      await db.prepare('DELETE FROM logs WHERE member_id = ? AND date = ?').bind(memberId, date).run();

      for (const e of entries) {
        const minutes = parseInt(e.minutes) || 0;
        if (minutes <= 0) continue;
        await db.prepare(
          'INSERT INTO logs (member_id, date, task_id, task, type, minutes, avail) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(memberId, date, e.taskId ?? null, e.task || 'Unknown Task', e.type || 'Other', minutes, avail).run();
      }
      return json({ ok: true });
    }

    // PUT /api/capacity  { key, minutes }
    if (path[0] === 'capacity' && method === 'PUT') {
      const body = await request.json();
      const key = body.key;
      const minutes = parseInt(body.minutes) || 0;
      if (!['Full', 'Half', 'Leave'].includes(key)) return json({ error: 'Invalid capacity key' }, 400);
      await db.prepare(
        'INSERT INTO capacity (key, minutes) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET minutes = excluded.minutes'
      ).bind(key, minutes).run();
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    return json({ error: err.message || 'Server error' }, 500);
  }
}
