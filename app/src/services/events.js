import { query } from '../db/pool.js';

export async function emitTaskEvent({ taskId, actorId = null, eventType, fromStatus = null, toStatus = null, metadata = null }, client = null) {
  const sql = `
    INSERT INTO task_events (task_id, actor_id, event_type, from_status, to_status, metadata)
    VALUES ($1, $2, $3, $4, $5, $6)
  `;
  const params = [taskId, actorId, eventType, fromStatus, toStatus, metadata ? JSON.stringify(metadata) : null];
  if (client) {
    await client.query(sql, params);
  } else {
    await query(sql, params);
  }
}
