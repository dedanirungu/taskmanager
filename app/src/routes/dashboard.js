import { query } from '../db/pool.js';
import { requireAdmin } from '../middleware/auth.js';

export default async function dashboardRoutes(app) {
  app.addHook('preHandler', requireAdmin);

  app.get('/api/admin/dashboard', async () => {
    const [
      statusCounts,
      perProject,
      activeClaims,
      durations,
      openConflicts,
      recentEvents,
    ] = await Promise.all([
      query(`SELECT status, COUNT(*)::int AS n FROM tasks GROUP BY status`),
      query(`
        SELECT p.id, p.name, p.slug,
               COUNT(t.id) FILTER (WHERE t.status = 'open')             ::int AS open,
               COUNT(t.id) FILTER (WHERE t.status = 'in_progress')      ::int AS in_progress,
               COUNT(t.id) FILTER (WHERE t.status = 'submitted')        ::int AS submitted,
               COUNT(t.id) FILTER (WHERE t.status = 'awaiting_review')  ::int AS awaiting_review,
               COUNT(t.id) FILTER (WHERE t.status = 'merged')           ::int AS merged
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id
        GROUP BY p.id, p.name, p.slug
        ORDER BY p.name
      `),
      query(`
        SELECT t.id, t.title, t.branch_name, t.claimed_at,
               p.name AS project_name,
               u.username AS assignee
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        JOIN users u ON u.id = t.assigned_to
        WHERE t.status = 'in_progress'
        ORDER BY t.claimed_at ASC
      `),
      query(`
        SELECT
          ROUND(AVG(EXTRACT(EPOCH FROM (submitted_at - claimed_at))))::int AS avg_claim_to_submit_seconds,
          ROUND(AVG(EXTRACT(EPOCH FROM (merged_at - submitted_at))))::int  AS avg_submit_to_merge_seconds,
          COUNT(*) FILTER (WHERE submitted_at IS NOT NULL AND claimed_at IS NOT NULL)::int AS submitted_count
        FROM tasks
        WHERE merged_at IS NOT NULL
      `),
      query(`
        SELECT a.id, a.branch_a, a.branch_b, a.conflicting_files, a.alerted_at,
               p.name AS project_name
        FROM conflict_alerts a
        JOIN projects p ON p.id = a.project_id
        WHERE a.resolved_at IS NULL
        ORDER BY a.alerted_at DESC
      `),
      query(`
        SELECT e.id, e.event_type, e.from_status, e.to_status, e.created_at,
               t.id AS task_id, t.title AS task_title,
               u.username AS actor,
               p.name AS project_name
        FROM task_events e
        JOIN tasks t ON t.id = e.task_id
        JOIN projects p ON p.id = t.project_id
        LEFT JOIN users u ON u.id = e.actor_id
        ORDER BY e.created_at DESC
        LIMIT 25
      `),
    ]);

    return {
      status_counts: Object.fromEntries(statusCounts.rows.map((r) => [r.status, r.n])),
      per_project: perProject.rows,
      active_claims: activeClaims.rows,
      durations: durations.rows[0] || {},
      open_conflicts: openConflicts.rows,
      recent_events: recentEvents.rows,
    };
  });

  app.get('/api/admin/conflicts', async (req) => {
    const includeResolved = req.query?.resolved === '1';
    const { rows } = await query(
      `SELECT a.id, a.branch_a, a.branch_b, a.conflicting_files, a.alerted_at, a.resolved_at,
              p.id AS project_id, p.name AS project_name, p.slug AS project_slug, p.github_repo
       FROM conflict_alerts a
       JOIN projects p ON p.id = a.project_id
       ${includeResolved ? '' : 'WHERE a.resolved_at IS NULL'}
       ORDER BY a.alerted_at DESC
       LIMIT 200`,
    );
    return { conflicts: rows };
  });
}
