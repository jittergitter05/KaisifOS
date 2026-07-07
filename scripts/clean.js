import fs from 'fs';

const targets = ['.next/cache', 'node_modules/.cache'];

targets.forEach((target) => {
  try {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[Clean] Successfully removed: ${target}`);
    }
  } catch (err) {
    console.warn(`[Clean] Failed to remove ${target}:`, err.message);
  }
});
