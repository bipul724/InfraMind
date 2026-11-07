const requiredVariables = ['VITE_API_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const failures = [];

if (process.env.NODE_ENV !== undefined && process.env.NODE_ENV !== 'production') {
  failures.push('NODE_ENV must be production when set.');
}

for (const name of requiredVariables) {
  if (!process.env[name]?.trim()) failures.push(`${name} must be set and non-empty.`);
}

function publicHttpsUrl(name, value) {
  if (!value?.trim()) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    failures.push(`${name} must be a valid HTTPS URL.`);
    return null;
  }
  if (url.protocol !== 'https:' || !value.toLowerCase().startsWith(`${url.protocol}//`) || value !== value.trim() || value.includes('\\')) {
    failures.push(`${name} must be a valid HTTPS URL.`);
    return null;
  }
  if (url.username || url.password) {
    failures.push(`${name} must not contain credentials.`);
    return null;
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(hostname) || hostname.endsWith('.local')) {
    failures.push(`${name} must use a public host.`);
    return null;
  }
  return url;
}

const apiUrl = publicHttpsUrl('VITE_API_URL', process.env.VITE_API_URL);
const supabaseUrl = publicHttpsUrl('VITE_SUPABASE_URL', process.env.VITE_SUPABASE_URL);

// Check the raw URL because parsing normalizes dot paths and hides an empty query or trailing slash.
if (apiUrl && !/^[a-z][a-z\d+.-]*:\/\/[^/?#\\]+$/i.test(process.env.VITE_API_URL)) {
  failures.push('VITE_API_URL must be an origin without a path, query, fragment, or trailing slash.');
}

function isServiceRoleKey(value) {
  if (value.startsWith('sb_secret_')) return true;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload !== null && typeof payload === 'object' && payload.role === 'service_role';
  } catch {
    return false;
  }
}

if (process.env.VITE_SUPABASE_ANON_KEY && isServiceRoleKey(process.env.VITE_SUPABASE_ANON_KEY)) {
  failures.push('VITE_SUPABASE_ANON_KEY must be a public anon key, never a service-role or secret key.');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`VITE_API_URL: ${apiUrl.host}`);
  console.log(`VITE_SUPABASE_URL: ${supabaseUrl.host}`);
  console.log('VITE_SUPABASE_ANON_KEY: configured');
}
