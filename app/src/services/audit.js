import { query } from '../db/pool.js';

export async function audit({ actorId = null, action, target = null, payload = null }) {
  try {
    await query(
      `INSERT INTO audit_log (actor_id, action, target, payload)
       VALUES ($1, $2, $3, $4)`,
      [actorId, action, target, payload ? JSON.stringify(payload) : null],
    );
  } catch (err) {
    // Audit must not break the request path.
    console.error('[audit] failed to record event', { action, target, err: err.message });
  }
}
