'use strict';

const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

const CRON_PATTERN = /^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/;

/**
 * Convert a cron expression to a human-readable string.
 */
function getHumanSchedule(cronExpr) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return cronExpr;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every minute
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every minute';
  }

  // Every N minutes
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = minute.slice(2);
    return n === '1' ? 'Every minute' : `Every ${n} minutes`;
  }

  // Every N hours
  if (minute !== '*' && hour.startsWith('*/') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = hour.slice(2);
    return n === '1' ? `Every hour at :${minute.padStart(2, '0')}` : `Every ${n} hours at :${minute.padStart(2, '0')}`;
  }

  // Hourly at specific minute
  if (minute !== '*' && !minute.includes('/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every hour at :${minute.padStart(2, '0')}`;
  }

  // Daily at specific time
  if (minute !== '*' && hour !== '*' && !hour.includes('/') && !hour.includes(',') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    const ampm = h >= 12 ? 'pm' : 'am';
    const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const displayMin = m === 0 ? '' : `:${String(m).padStart(2, '0')}`;
    return `Daily at ${displayHour}${displayMin}${ampm}`;
  }

  // Weekly on specific day
  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*' && !dayOfWeek.includes(',')) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayNum = parseInt(dayOfWeek, 10);
    const dayName = days[dayNum] || dayOfWeek;
    const h = parseInt(hour, 10);
    const ampm = h >= 12 ? 'pm' : 'am';
    const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Weekly on ${dayName} at ${displayHour}${ampm}`;
  }

  // Monthly
  if (minute !== '*' && hour !== '*' && dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    const h = parseInt(hour, 10);
    const ampm = h >= 12 ? 'pm' : 'am';
    const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Monthly on day ${dayOfMonth} at ${displayHour}${ampm}`;
  }

  return cronExpr;
}

/**
 * Parse crontab output into structured job objects.
 */
function parseCrontab(content) {
  const lines = content.split('\n');
  const jobs = [];
  let pendingDescription = null;
  let id = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and environment variable assignments
    if (!trimmed || trimmed.includes('=') && !trimmed.startsWith('#')) {
      pendingDescription = null;
      continue;
    }

    // Check if it's a comment that describes the next cron job
    if (trimmed.startsWith('#')) {
      const afterHash = trimmed.slice(1).trim();

      // Check if this is a commented-out cron line (disabled job)
      const disabledMatch = afterHash.match(CRON_PATTERN);
      if (disabledMatch) {
        jobs.push({
          id: id++,
          schedule: disabledMatch[1],
          command: disabledMatch[2],
          enabled: false,
          description: pendingDescription || '',
        });
        pendingDescription = null;
        continue;
      }

      // It's a description comment for the next line
      pendingDescription = afterHash;
      continue;
    }

    // Active cron line
    const match = trimmed.match(CRON_PATTERN);
    if (match) {
      jobs.push({
        id: id++,
        schedule: match[1],
        command: match[2],
        enabled: true,
        description: pendingDescription || '',
      });
      pendingDescription = null;
    }
  }

  return jobs;
}

/**
 * List all cron jobs for the current user.
 */
function listCronJobs() {
  return new Promise((resolve, reject) => {
    exec('crontab -l', (error, stdout, stderr) => {
      if (error) {
        // "no crontab for user" is not a real error
        if (stderr && stderr.includes('no crontab')) {
          resolve([]);
          return;
        }
        resolve([]);
        return;
      }

      const jobs = parseCrontab(stdout);
      resolve(jobs);
    });
  });
}

/**
 * Toggle a cron job on or off by its ID.
 */
function toggleCronJob(targetId, enabled) {
  return new Promise((resolve, reject) => {
    exec('crontab -l', (error, stdout) => {
      if (error) {
        reject(new Error('Failed to read crontab'));
        return;
      }

      const lines = stdout.split('\n');
      const result = [];
      let pendingDescription = null;
      let currentId = 0;

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) {
          result.push(line);
          pendingDescription = null;
          continue;
        }

        if (trimmed.startsWith('#')) {
          const afterHash = trimmed.slice(1).trim();
          const disabledMatch = afterHash.match(CRON_PATTERN);

          if (disabledMatch) {
            if (currentId === targetId) {
              if (enabled) {
                // Uncomment the line to enable
                result.push(afterHash);
              } else {
                result.push(line);
              }
            } else {
              result.push(line);
            }
            currentId++;
            pendingDescription = null;
            continue;
          }

          pendingDescription = afterHash;
          result.push(line);
          continue;
        }

        const match = trimmed.match(CRON_PATTERN);
        if (match) {
          if (currentId === targetId) {
            if (!enabled) {
              // Comment out the line to disable
              result.push(`# ${trimmed}`);
            } else {
              result.push(line);
            }
          } else {
            result.push(line);
          }
          currentId++;
          pendingDescription = null;
          continue;
        }

        result.push(line);
      }

      const newContent = result.join('\n');
      // Use printf to avoid echo interpretation issues
      const escaped = newContent.replace(/'/g, "'\\''");
      exec(`printf '%s' '${escaped}' | crontab -`, (err) => {
        if (err) {
          reject(new Error(`Failed to update crontab: ${err.message}`));
          return;
        }
        resolve(true);
      });
    });
  });
}

/**
 * Try to read log output for a cron job.
 * Checks common log locations.
 */
async function getCronLog(jobId) {
  const logLocations = [
    '/var/log/syslog',
    '/var/log/cron',
    '/var/log/cron.log',
    `${process.env.HOME}/.local/share/harkva/cron-${jobId}.log`,
  ];

  for (const logPath of logLocations) {
    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.split('\n');
      const last50 = lines.slice(-50).join('\n');
      return last50;
    } catch (_) {
      continue;
    }
  }

  return '';
}

module.exports = {
  listCronJobs,
  toggleCronJob,
  getCronLog,
  getHumanSchedule,
};
