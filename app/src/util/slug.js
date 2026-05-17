export function slugify(text, { maxLen = 40 } = {}) {
  const s = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return s || 'untitled';
}

export function branchNameForTask(task) {
  return `task/${task.id}-${slugify(task.title)}`;
}
