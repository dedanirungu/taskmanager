// User-facing labels for the task status enum.  The DB column stays as
// the original identifier so existing migrations / queries don't change.
const LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  submitted: 'Submitted',
  awaiting_review: 'Awaiting review',
  merged: 'Done',
  closed: 'Closed',
};

export function statusLabel(status) {
  return LABELS[status] || status;
}
